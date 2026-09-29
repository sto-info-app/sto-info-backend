import { InjectQueue } from '@nestjs/bullmq';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';

import { ImageUploadsService } from 'src/shared/utilities/image-uploads.service';

import { SHOWABLE_IMAGE_STATES } from '../delivery/image-url-signing.interceptor';
import { FileAssetStorage } from '../enums/file-asset-storage.enum';
import {
  IMAGE_ESTATE_QUEUE,
  IMAGE_INVENTORY_JOB,
  IMAGE_INVENTORY_SAMPLE,
} from './image-estate.constants';
import {
  ImageEstateStepState,
  ImageInventoryRunState,
} from './image-estate.enums';
import { rowsOf } from './image-estate.utility';
import { ImageInventoryRunEntity } from './image-inventory-run.entity';
import { IMAGE_REFERENCE_COLUMNS } from './image-references';

/** One column's references, counted. */
export interface ImageReferenceCount {
  readonly table: string;
  readonly column: string;
  /** Rows holding a picture. */
  readonly rows: number;
  /** Of those, how many the registry knows. */
  readonly registered: number;
  /** Of those, how many hold a legacy R2 key. */
  readonly r2: number;
}

/** One group of the registry's published pictures. */
export interface ImageRegistryCount {
  readonly kind: string;
  readonly state: string;
  readonly storage: string;
  readonly deliveryPrivate: boolean;
  readonly count: number;
}

/** What Cloudflare holds for this environment, against the registry. */
export interface ImageCloudflareCount {
  /** Images recorded against this environment. */
  readonly listed: number;
  readonly private: number;
  readonly public: number;
  /** Images of this environment nothing points at. */
  readonly orphans: number;
  readonly orphanIds: string[];
  /** Old public copies waiting to be retired. */
  readonly awaitingRetirement: number;
  /** Showable pictures the registry has and Cloudflare does not. */
  readonly missing: number;
  readonly missingAssetIds: string[];
  /** Images of other environments, or the site's own artwork. */
  readonly elsewhere: number;
}

/** A reconciliation's findings. */
export interface ImageInventoryReport {
  readonly references: ImageReferenceCount[];
  readonly registry: ImageRegistryCount[];
  readonly steps: Partial<Record<ImageEstateStepState, number>>;
  /** Null when Cloudflare's listing could not be read. */
  readonly cloudflare: ImageCloudflareCount | null;
}

/**
 * The image estate's inventory (FC-040).
 *
 * Steve's decision of 29 September 2026: reconcile, and report. Every
 * feature column that holds a picture is counted, with how many of its
 * references the registry knows; the registry's published pictures are
 * counted by kind, state, storage and whether they are private; and
 * Cloudflare's listing for this environment is compared with both, naming
 * orphans (nothing points at them) and missing pictures (the registry says
 * they are shown, Cloudflare does not have them). Nothing is deleted: a
 * deleted object cannot be rolled back.
 */
@Injectable()
export class ImageInventoryService {
  private readonly _logger = new Logger(ImageInventoryService.name);

  /**
   * Creates an instance of ImageInventoryService.
   *
   * @param _dataSource - The database.
   * @param _images - Cloudflare Images.
   * @param _queue - Where it runs.
   */
  constructor(
    @InjectDataSource() private readonly _dataSource: DataSource,
    private readonly _images: ImageUploadsService,
    @InjectQueue(IMAGE_ESTATE_QUEUE) private readonly _queue: Queue,
  ) {}

  /**
   * The latest inventory.
   *
   * @returns It, or null before the first.
   */
  async latest(): Promise<ImageInventoryRunEntity | null> {
    const [latest] = await this._dataSource.manager.find(
      ImageInventoryRunEntity,
      { order: { createdAt: 'DESC' }, take: 1 },
    );

    return latest ?? null;
  }

  /**
   * Starts an inventory.
   *
   * @param adminUserId - The site admin.
   * @returns The inventory, running.
   * @throws ConflictException when one is running already.
   */
  async start(adminUserId: string): Promise<ImageInventoryRunEntity> {
    const manager = this._dataSource.manager;

    if (
      await manager.exists(ImageInventoryRunEntity, {
        where: { state: ImageInventoryRunState.RUNNING },
      })
    ) {
      throw new ConflictException('An inventory is running already.');
    }

    const run = await manager.save(
      ImageInventoryRunEntity,
      manager.create(ImageInventoryRunEntity, {
        state: ImageInventoryRunState.RUNNING,
        startedByUserId: adminUserId,
      }),
    );

    await this._queue.add(
      IMAGE_INVENTORY_JOB,
      { inventoryId: run.id },
      { removeOnComplete: true, removeOnFail: true },
    );

    return run;
  }

  /**
   * Takes an inventory.
   *
   * @param inventoryId - The inventory.
   */
  async run(inventoryId: string): Promise<void> {
    const references = await this.countReferences();
    const registry = rowsOf<ImageRegistryCount>(
      await this._dataSource.query(
        `SELECT "kind"::text AS "kind", "state"::text AS "state", "storage"::text AS "storage", "deliveryPrivate", count(*)::int AS "count"
         FROM "sto_info_app"."file_asset"
         WHERE "storage" IN ('PUBLIC_IMAGES', 'LEGACY_PUBLIC_R2')
         GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4`,
      ),
    );
    const steps = Object.fromEntries(
      rowsOf<{ state: string; count: number }>(
        await this._dataSource.query(
          `SELECT "state"::text AS "state", count(*)::int AS "count" FROM "sto_info_app"."image_estate_step" GROUP BY 1`,
        ),
      ).map(each => [each.state, each.count]),
    );
    let cloudflare: ImageCloudflareCount | null = null;
    let error: string | null = null;

    try {
      cloudflare = await this.reconcileCloudflare();
    } catch (failure: unknown) {
      error = (
        failure instanceof Error ? failure.message : String(failure)
      ).slice(0, 500);
      this._logger.error(
        `[run] Cloudflare's listing could not be read - InventoryId: ${inventoryId}`,
      );
    }

    await this._dataSource.manager.update(
      ImageInventoryRunEntity,
      { id: inventoryId },
      {
        state:
          error === null
            ? ImageInventoryRunState.DONE
            : ImageInventoryRunState.FAILED,
        report: { references, registry, steps, cloudflare } as never,
        error,
        finishedAt: new Date(),
      },
    );
  }

  /**
   * Counts every column's references.
   *
   * @returns One count a column.
   */
  private async countReferences(): Promise<ImageReferenceCount[]> {
    const counts: ImageReferenceCount[] = [];

    for (const column of IMAGE_REFERENCE_COLUMNS) {
      const [count] = rowsOf<{ rows: number; registered: number; r2: number }>(
        await this._dataSource.query(`
          SELECT count(*)::int AS "rows",
                 count(*) FILTER (WHERE EXISTS (
                   SELECT 1 FROM "sto_info_app"."file_asset" known
                   WHERE known."deliveryReference" = row."${column.column}"
                 ))::int AS "registered",
                 count(*) FILTER (WHERE POSITION('/' IN row."${column.column}") > 0)::int AS "r2"
          FROM "sto_info_app"."${column.table}" row
          WHERE row."${column.column}" IS NOT NULL`),
      );

      counts.push({ table: column.table, column: column.column, ...count });
    }

    return counts;
  }

  /**
   * Compares Cloudflare's listing with the registry.
   *
   * @returns The comparison.
   */
  private async reconcileCloudflare(): Promise<ImageCloudflareCount> {
    const environment = this._images.environment;
    const account = new Set<string>();
    const mine: { id: string; private: boolean }[] = [];
    let token: string | null = null;

    do {
      const page = await this._images.listImages(token);

      for (const image of page.images) {
        account.add(image.id);

        if (
          image.meta.env === environment ||
          image.id.startsWith(`${environment}-`)
        ) {
          mine.push({ id: image.id, private: image.requireSignedURLs });
        }
      }

      token = page.continuationToken;
    } while (token !== null);

    const known = new Set(
      rowsOf<{ reference: string }>(
        await this._dataSource.query(
          `SELECT "deliveryReference" AS "reference" FROM "sto_info_app"."file_asset" WHERE "deliveryReference" IS NOT NULL`,
        ),
      ).map(row => row.reference),
    );
    const oldCopies = new Set(
      rowsOf<{ reference: string }>(
        await this._dataSource.query(
          `SELECT "fromReference" AS "reference" FROM "sto_info_app"."image_estate_step" WHERE "state" = 'COPIED'`,
        ),
      ).map(row => row.reference),
    );
    const orphans = mine
      .filter(image => !known.has(image.id) && !oldCopies.has(image.id))
      .map(image => image.id);
    const showable = rowsOf<{ id: string; reference: string }>(
      await this._dataSource.query(
        `SELECT "id", "deliveryReference" AS "reference" FROM "sto_info_app"."file_asset"
         WHERE "storage" = $1 AND "state"::text = ANY($2) AND "deliveryReference" IS NOT NULL`,
        [FileAssetStorage.PUBLIC_IMAGES, [...SHOWABLE_IMAGE_STATES]],
      ),
    );
    const missing = showable
      .filter(asset => !account.has(asset.reference))
      .map(asset => asset.id);

    return {
      listed: mine.length,
      private: mine.filter(image => image.private).length,
      public: mine.filter(image => !image.private).length,
      orphans: orphans.length,
      orphanIds: orphans.slice(0, IMAGE_INVENTORY_SAMPLE),
      awaitingRetirement: mine.filter(image => oldCopies.has(image.id)).length,
      missing: missing.length,
      missingAssetIds: missing.slice(0, IMAGE_INVENTORY_SAMPLE),
      elsewhere: account.size - mine.length,
    };
  }
}
