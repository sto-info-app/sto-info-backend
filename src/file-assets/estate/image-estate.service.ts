import { createHash } from 'crypto';

import { InjectQueue } from '@nestjs/bullmq';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { DataSource, EntityManager, In, IsNull, MoreThan, Not } from 'typeorm';

import { SiteAdminActionKind } from 'src/audit/site-admin/site-admin-action.enum';
import { recordSiteAdminAction } from 'src/audit/site-admin/site-admin-action.utility';
import { ImageUploadsService } from 'src/shared/utilities/image-uploads.service';
import { readImageContent } from 'src/storytime/images/storytime-image-content.utility';

import { SHOWABLE_IMAGE_STATES } from '../delivery/image-url-signing.interceptor';
import { FileAssetPlacementEntity } from '../entities/file-asset-placement.entity';
import { FileAssetEntity } from '../entities/file-asset.entity';
import { FileAssetPlacementState } from '../enums/file-asset-placement-state.enum';
import { FileAssetStorage } from '../enums/file-asset-storage.enum';
import {
  ImageEstateRunCounts,
  ImageEstateRunEntity,
} from './image-estate-run.entity';
import {
  ImageEstateReference,
  ImageEstateStepEntity,
} from './image-estate-step.entity';
import {
  IMAGE_ESTATE_BATCH_JOB,
  IMAGE_ESTATE_BATCH_SIZE,
  IMAGE_ESTATE_QUEUE,
} from './image-estate.constants';
import {
  ImageEstateRunKind,
  ImageEstateRunState,
  ImageEstateStepState,
} from './image-estate.enums';
import { rowsOf } from './image-estate.utility';
import {
  IMAGE_REFERENCE_COLUMNS,
  ImageReferenceColumn,
  isGeneratedImageId,
} from './image-references';

/** The storages a published picture is served from. */
const PUBLIC_STORAGES = [
  FileAssetStorage.PUBLIC_IMAGES,
  FileAssetStorage.LEGACY_PUBLIC_R2,
];

/** The site admin action each kind of run is logged as. */
const STARTED_ACTIONS: Record<ImageEstateRunKind, SiteAdminActionKind> = {
  [ImageEstateRunKind.COPY]: SiteAdminActionKind.IMAGE_COPY_STARTED,
  [ImageEstateRunKind.UNDO]: SiteAdminActionKind.IMAGE_UNDO_STARTED,
  [ImageEstateRunKind.RETIRE]: SiteAdminActionKind.IMAGE_RETIRE_STARTED,
};

/** Where the image estate stands, for Scan Diagnostics. */
export interface ImageEstateStatus {
  /** Whether addresses are signed, which a copy needs. */
  readonly signingEnabled: boolean;
  /** The open run, or the last one. */
  readonly run: ImageEstateRunEntity | null;
  /** Every picture's copy, by where it is. */
  readonly steps: Partial<Record<ImageEstateStepState, number>>;
  /** Published pictures still public, waiting for a copy. */
  readonly remaining: number;
}

/**
 * Moves the image estate to private delivery (FC-040).
 *
 * Steve's decisions of 29 September 2026. Every published picture becomes a
 * private Cloudflare Images object, reachable only by an address the API
 * signs. Cloudflare will not make a custom-ID image private, which every
 * picture before FC-040 is, so each is copied to a private one under a
 * generated ID and every row pointing at it is repointed; a picture that
 * already has a generated ID is made private in place. A legacy R2 portrait
 * is copied into Cloudflare Images the same way.
 *
 * A site admin runs it from Scan Diagnostics, one run at a time, each
 * paused and resumed at will and logged with a reason:
 *
 * - **Copy** first registers, as `UNVERIFIED`, any reference the registry
 *   does not know, then copies each picture. It deletes nothing.
 * - **Undo** puts every copy not yet retired back as it was and deletes the
 *   private copy. It never puts back a picture that may no longer be shown.
 * - **Retire** deletes the old public copies. After that a picture's copy
 *   cannot be undone, and its old address no longer works.
 *
 * Every run is checkpointed: its cursor is the last row handled and each
 * picture's step records what it changed, so a pause, a crash or a retry
 * resumes where it stopped and nothing is done twice.
 */
@Injectable()
export class ImageEstateService {
  private readonly _logger = new Logger(ImageEstateService.name);

  /**
   * Creates an instance of ImageEstateService.
   *
   * @param _dataSource - The database.
   * @param _images - Cloudflare Images and the public R2 bucket.
   * @param _queue - Where the batches run.
   */
  constructor(
    @InjectDataSource() private readonly _dataSource: DataSource,
    private readonly _images: ImageUploadsService,
    @InjectQueue(IMAGE_ESTATE_QUEUE) private readonly _queue: Queue,
  ) {}

  /**
   * Where the estate stands.
   *
   * @returns The status.
   */
  async status(): Promise<ImageEstateStatus> {
    const manager = this._dataSource.manager;
    const [run] = await manager.find(ImageEstateRunEntity, {
      order: { createdAt: 'DESC' },
      take: 1,
    });
    const steps = rowsOf<{ state: ImageEstateStepState; count: number }>(
      await manager.query(
        `SELECT "state", count(*)::int AS "count" FROM "sto_info_app"."image_estate_step" GROUP BY "state"`,
      ),
    );

    return {
      signingEnabled: this._images.publishesPrivate,
      run: run ?? null,
      steps: Object.fromEntries(steps.map(each => [each.state, each.count])),
      remaining: await this.remaining(manager),
    };
  }

  /**
   * Starts a run.
   *
   * @param kind - What it does.
   * @param adminUserId - The site admin.
   * @param reason - Why, for the site admin log.
   * @returns The run.
   * @throws ConflictException when a run is open, a copy is asked for with
   *   no signing key, or there is nothing for an undo or retirement to do.
   */
  async start(
    kind: ImageEstateRunKind,
    adminUserId: string,
    reason: string,
  ): Promise<ImageEstateRunEntity> {
    if (kind === ImageEstateRunKind.COPY && !this._images.publishesPrivate) {
      throw new ConflictException(
        'Set cloudflareImagesSigningKey before copying: without it no picture can be private.',
      );
    }

    if (
      kind !== ImageEstateRunKind.COPY &&
      !(await this._dataSource.manager.exists(ImageEstateStepEntity, {
        where: { state: ImageEstateStepState.COPIED },
      }))
    ) {
      throw new ConflictException('No copied picture is waiting for that.');
    }

    const run = await this._dataSource.transaction(async manager => {
      if (await this.openRun(manager)) {
        throw new ConflictException('Another run is open. Finish it first.');
      }

      const created = await manager.save(
        ImageEstateRunEntity,
        manager.create(ImageEstateRunEntity, {
          kind,
          state: ImageEstateRunState.RUNNING,
          startedByUserId: adminUserId,
          cursor: null,
          counts: {},
        }),
      );

      await recordSiteAdminAction(manager, {
        action: STARTED_ACTIONS[kind],
        actorUserId: adminUserId,
        subject: { kind: 'IMAGE_ESTATE_RUN', id: created.id },
        reason,
      });

      return created;
    });

    await this.enqueue(run.id);

    return run;
  }

  /**
   * Pauses the open run after the batch under way.
   *
   * @param adminUserId - The site admin.
   * @param reason - Why.
   * @returns The run.
   * @throws ConflictException when none is running.
   */
  async pause(
    adminUserId: string,
    reason: string,
  ): Promise<ImageEstateRunEntity> {
    return this.move(
      ImageEstateRunState.RUNNING,
      ImageEstateRunState.PAUSED,
      SiteAdminActionKind.IMAGE_RUN_PAUSED,
      adminUserId,
      reason,
    );
  }

  /**
   * Resumes a paused or failed run where it stopped.
   *
   * @param adminUserId - The site admin.
   * @param reason - Why.
   * @returns The run.
   * @throws ConflictException when none is paused or failed.
   */
  async resume(
    adminUserId: string,
    reason: string,
  ): Promise<ImageEstateRunEntity> {
    const run = await this.move(
      [ImageEstateRunState.PAUSED, ImageEstateRunState.FAILED],
      ImageEstateRunState.RUNNING,
      SiteAdminActionKind.IMAGE_RUN_RESUMED,
      adminUserId,
      reason,
    );

    await this.enqueue(run.id);

    return run;
  }

  /**
   * Runs one batch of a run, and queues the next.
   *
   * @param runId - The run.
   */
  async processBatch(runId: string): Promise<void> {
    const run = await this._dataSource.manager.findOne(ImageEstateRunEntity, {
      where: { id: runId },
    });

    if (run === null || run.state !== ImageEstateRunState.RUNNING) {
      return;
    }

    let handled: number;

    try {
      handled =
        run.kind === ImageEstateRunKind.COPY
          ? await this.copyBatch(run)
          : run.kind === ImageEstateRunKind.UNDO
            ? await this.undoBatch(run)
            : await this.retireBatch(run);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this._logger.error(`[processBatch] Run failed - RunId: ${run.id}`);
      await this._dataSource.manager.update(
        ImageEstateRunEntity,
        { id: run.id, state: ImageEstateRunState.RUNNING },
        {
          state: ImageEstateRunState.FAILED,
          lastError: message.slice(0, 500),
          counts: run.counts,
          cursor: run.cursor,
        },
      );

      return;
    }

    const done = handled < IMAGE_ESTATE_BATCH_SIZE;
    const moved = await this._dataSource.manager.update(
      ImageEstateRunEntity,
      { id: run.id, state: ImageEstateRunState.RUNNING },
      {
        counts: run.counts,
        cursor: run.cursor,
        ...(done
          ? { state: ImageEstateRunState.DONE, finishedAt: new Date() }
          : {}),
      },
    );

    // A pause landed while this batch ran: keep its progress, and stop.
    if (!moved.affected) {
      await this._dataSource.manager.update(
        ImageEstateRunEntity,
        { id: run.id },
        { counts: run.counts, cursor: run.cursor },
      );

      return;
    }

    if (!done) {
      await this.enqueue(run.id);
    }
  }

  /**
   * Retires a picture's old public copy when the picture itself is
   * withdrawn, so a withdrawal before retirement leaves nothing behind.
   *
   * @param assetId - The asset withdrawn.
   */
  async retireFor(assetId: string): Promise<void> {
    const step = await this._dataSource.manager.findOne(ImageEstateStepEntity, {
      where: { assetId, state: ImageEstateStepState.COPIED },
    });

    if (step !== null) {
      await this.retireOne(step, { retired: 0, failed: 0 });
    }
  }

  // ----- Copy -----

  /**
   * Copies a batch: registers unknown references first, then copies the
   * next pictures after the cursor.
   *
   * @param run - The run, whose cursor and counts move.
   * @returns How many pictures it handled.
   */
  private async copyBatch(run: ImageEstateRunEntity): Promise<number> {
    if (run.counts.registered === undefined) {
      run.counts = { ...run.counts, registered: await this.registerUnknown() };
    }

    await this.clearInterrupted();

    const assets = await this._dataSource.manager.find(FileAssetEntity, {
      where: {
        storage: In(PUBLIC_STORAGES),
        state: In([...SHOWABLE_IMAGE_STATES]),
        deliveryPrivate: false,
        deliveryReference: Not(IsNull()),
        ...(run.cursor === null ? {} : { id: MoreThan(run.cursor) }),
      },
      order: { id: 'ASC' },
      take: IMAGE_ESTATE_BATCH_SIZE,
    });

    for (const asset of assets) {
      await this.copyOne(run, asset);
      run.cursor = asset.id;
    }

    return assets.length;
  }

  /**
   * Registers, as `UNVERIFIED`, every picture a feature row holds that the
   * registry does not know. FC-040 AC1: never presumed clean.
   *
   * @returns How many it registered.
   */
  private async registerUnknown(): Promise<number> {
    let registered = 0;

    for (const column of IMAGE_REFERENCE_COLUMNS) {
      const rows = rowsOf<{ id: string }>(
        await this._dataSource.query(`
          INSERT INTO "sto_info_app"."file_asset"
            ("kind", "state", "audience", "storage", "ownerUserId", "objectKey", "deliveryReference")
          SELECT DISTINCT ON (row."${column.column}")
            '${column.kind}', 'UNVERIFIED', 'PUBLIC',
            (CASE WHEN POSITION('/' IN row."${column.column}") > 0
                  THEN 'LEGACY_PUBLIC_R2' ELSE 'PUBLIC_IMAGES' END)::"sto_info_app"."file_asset_storage_enum",
            ${column.ownerSql}, row."${column.column}", row."${column.column}"
          FROM "sto_info_app"."${column.table}" row ${column.joins ?? ''}
          WHERE row."${column.column}" IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM "sto_info_app"."file_asset" known
              WHERE known."deliveryReference" = row."${column.column}"
            )
          ON CONFLICT DO NOTHING
          RETURNING "id"`),
      );

      registered += rows.length;
    }

    if (registered > 0) {
      this._logger.log(
        `[registerUnknown] Registered unknown pictures - Count: ${registered}`,
      );
    }

    return registered;
  }

  /**
   * Clears copies a crash interrupted: a pending step changed no row, so its
   * private copy, if it was made, is deleted and the step with it, and the
   * picture is copied again.
   */
  private async clearInterrupted(): Promise<void> {
    const pending = await this._dataSource.manager.find(ImageEstateStepEntity, {
      where: { state: ImageEstateStepState.PENDING },
    });

    for (const step of pending) {
      await this.dropCopy(step);
      await this._dataSource.manager.delete(ImageEstateStepEntity, {
        id: step.id,
      });
    }
  }

  /**
   * Copies one picture to a private one and repoints its rows.
   *
   * @param run - The run.
   * @param asset - The picture.
   */
  private async copyOne(
    run: ImageEstateRunEntity,
    asset: FileAssetEntity,
  ): Promise<void> {
    const from = asset.deliveryReference as string;
    const inPlace =
      asset.storage === FileAssetStorage.PUBLIC_IMAGES &&
      isGeneratedImageId(from);
    const step = await this._dataSource.manager.save(
      ImageEstateStepEntity,
      this._dataSource.manager.create(ImageEstateStepEntity, {
        runId: run.id,
        assetId: asset.id,
        state: ImageEstateStepState.PENDING,
        fromReference: from,
        fromStorage: asset.storage,
      }),
    );

    try {
      const bytes =
        asset.storage === FileAssetStorage.LEGACY_PUBLIC_R2
          ? await this._images.readR2Object(from)
          : await this._images.readImage(from);
      const content = readImageContent(bytes);

      step.sha256 = createHash('sha256').update(bytes).digest('hex');
      step.byteSize = bytes.length;
      step.detectedContentType =
        content === null ? null : `image/${content.format}`;

      if (inPlace) {
        await this._images.setImageRequiresSignature(from, true);
        step.toReference = from;
      } else {
        step.toReference = await this._images.publishImageToCloudflareImages({
          userId: null,
          buffer: bytes,
          filename: null,
          contentType: step.detectedContentType,
          entityType: asset.kind,
          entityId: asset.id,
          private: true,
        });
      }

      // Recorded before the rows move, so a crash leaves a copy to clear.
      await this._dataSource.manager.save(ImageEstateStepEntity, step);
      await this._dataSource.transaction(manager =>
        this.repoint(manager, asset, step),
      );
      run.counts = this.add(run.counts, 'copied');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this._logger.warn(
        `[copyOne] Picture not copied - AssetId: ${asset.id}, Reason: ${message}`,
      );
      await this.dropCopy(step);
      await this._dataSource.manager.update(
        ImageEstateStepEntity,
        { id: step.id },
        { state: ImageEstateStepState.FAILED, error: message.slice(0, 500) },
      );
      run.counts = this.add(run.counts, 'failed');
    }
  }

  /**
   * Points every row, and the registry, at the private copy, and gives each
   * row a placement if it had none.
   *
   * @param manager - The transaction.
   * @param asset - The picture.
   * @param step - Its copy.
   * @throws Error when the picture changed since it was read, which rolls
   *   the whole copy back.
   */
  private async repoint(
    manager: EntityManager,
    asset: FileAssetEntity,
    step: ImageEstateStepEntity,
  ): Promise<void> {
    const from = step.fromReference;
    const to = step.toReference as string;
    const moved = await manager.update(
      FileAssetEntity,
      { id: asset.id, deliveryReference: from, deliveryPrivate: false },
      {
        deliveryReference: to,
        deliveryPrivate: true,
        storage: FileAssetStorage.PUBLIC_IMAGES,
      },
    );

    if (!moved.affected) {
      throw new Error('The picture changed while it was being copied.');
    }

    const references: ImageEstateReference[] = [];
    const placementIds: string[] = [];

    for (const column of IMAGE_REFERENCE_COLUMNS) {
      const rows =
        from === to
          ? rowsOf<{ rowId: string }>(
              await manager.query(
                `SELECT row."${column.rowId}"::text AS "rowId" FROM "sto_info_app"."${column.table}" row WHERE row."${column.column}" = $1`,
                [to],
              ),
            )
          : rowsOf<{ rowId: string }>(
              await manager.query(
                `UPDATE "sto_info_app"."${column.table}" row SET "${column.column}" = $1 WHERE row."${column.column}" = $2 RETURNING row."${column.rowId}"::text AS "rowId"`,
                [to, from],
              ),
            );

      if (rows.length === 0) {
        continue;
      }

      if (from !== to) {
        references.push(
          ...rows.map(row => ({
            table: column.table,
            column: column.column,
            rowId: row.rowId,
          })),
        );
      }

      placementIds.push(
        ...(await this.placeRows(
          manager,
          column,
          asset.id,
          rows.map(row => row.rowId),
        )),
      );
    }

    await manager.update(
      ImageEstateStepEntity,
      { id: step.id },
      {
        state: ImageEstateStepState.COPIED,
        toReference: to,
        sha256: step.sha256,
        byteSize: step.byteSize,
        detectedContentType: step.detectedContentType,
        references,
        placementIds,
        copiedAt: new Date(),
      },
    );
  }

  /**
   * Gives each row pointing at a picture a placement, when its slot has
   * none, so the registry says which record each picture is for.
   *
   * @param manager - The transaction.
   * @param column - The column.
   * @param assetId - The picture.
   * @param rowIds - The rows.
   * @returns The placements made.
   */
  private async placeRows(
    manager: EntityManager,
    column: ImageReferenceColumn,
    assetId: string,
    rowIds: string[],
  ): Promise<string[]> {
    const subjects = rowsOf<{ subjectId: string | null }>(
      await manager.query(
        `SELECT ${column.subjectIdSql} AS "subjectId" FROM "sto_info_app"."${column.table}" row ${column.joins ?? ''} WHERE row."${column.rowId}"::text = ANY($1)`,
        [rowIds],
      ),
    );
    const made: string[] = [];

    for (const { subjectId } of subjects) {
      if (subjectId === null) {
        continue;
      }

      const active = await manager.exists(FileAssetPlacementEntity, {
        where: {
          subject: column.subject,
          subjectId,
          slot: column.slot,
          state: FileAssetPlacementState.ACTIVE,
        },
      });

      if (active) {
        continue;
      }

      const inserted = await manager.insert(FileAssetPlacementEntity, {
        assetId,
        state: FileAssetPlacementState.ACTIVE,
        subject: column.subject,
        subjectId,
        slot: column.slot,
        detail: null,
        settledAt: new Date(),
      });

      made.push((inserted.identifiers[0] as { id: string }).id);
    }

    return made;
  }

  // ----- Undo -----

  /**
   * Undoes a batch of copies not yet retired.
   *
   * @param run - The run.
   * @returns How many copies it handled.
   */
  private async undoBatch(run: ImageEstateRunEntity): Promise<number> {
    const steps = await this.nextCopied(run);

    for (const step of steps) {
      await this.undoOne(run, step);
      run.cursor = step.id;
    }

    return steps.length;
  }

  /**
   * Puts one picture back as it was before its copy. A picture that may no
   * longer be shown is left alone: undo never brings back what a withdrawal
   * took down.
   *
   * @param run - The run.
   * @param step - The copy.
   */
  private async undoOne(
    run: ImageEstateRunEntity,
    step: ImageEstateStepEntity,
  ): Promise<void> {
    try {
      const putBack = await this._dataSource.transaction(async manager => {
        const moved = await manager.update(
          FileAssetEntity,
          {
            id: step.assetId,
            deliveryReference: step.toReference as string,
            state: In([...SHOWABLE_IMAGE_STATES]),
          },
          {
            deliveryReference: step.fromReference,
            deliveryPrivate: false,
            storage: step.fromStorage,
          },
        );

        if (!moved.affected) {
          return false;
        }

        for (const reference of step.references) {
          const column = IMAGE_REFERENCE_COLUMNS.find(
            each =>
              each.table === reference.table &&
              each.column === reference.column,
          ) as ImageReferenceColumn;

          await manager.query(
            `UPDATE "sto_info_app"."${column.table}" SET "${column.column}" = $1 WHERE "${column.rowId}"::text = $2 AND "${column.column}" = $3`,
            [step.fromReference, reference.rowId, step.toReference],
          );
        }

        if (step.placementIds.length > 0) {
          await manager.delete(FileAssetPlacementEntity, {
            id: In(step.placementIds),
            assetId: step.assetId,
          });
        }

        await manager.update(
          ImageEstateStepEntity,
          { id: step.id, state: ImageEstateStepState.COPIED },
          { state: ImageEstateStepState.UNDONE, undoneAt: new Date() },
        );

        return true;
      });

      if (!putBack) {
        return;
      }

      if (step.toReference === step.fromReference) {
        await this._images.setImageRequiresSignature(step.fromReference, false);
      } else {
        await this.dropCopy(step);
      }

      run.counts = this.add(run.counts, 'undone');
    } catch (error: unknown) {
      this._logger.warn(
        `[undoOne] Copy not undone - StepId: ${step.id}, ` +
          `Reason: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      run.counts = this.add(run.counts, 'failed');
    }
  }

  // ----- Retire -----

  /**
   * Retires a batch of old public copies.
   *
   * @param run - The run.
   * @returns How many copies it handled.
   */
  private async retireBatch(run: ImageEstateRunEntity): Promise<number> {
    const steps = await this.nextCopied(run);

    for (const step of steps) {
      run.counts = await this.retireOne(step, run.counts);
      run.cursor = step.id;
    }

    return steps.length;
  }

  /**
   * Deletes one picture's old public copy. A copy made in place has none.
   *
   * @param step - The copy.
   * @param counts - The run's counts.
   * @returns The counts, moved on.
   */
  private async retireOne(
    step: ImageEstateStepEntity,
    counts: ImageEstateRunCounts,
  ): Promise<ImageEstateRunCounts> {
    try {
      if (step.toReference !== step.fromReference) {
        await this.deleteObject(step.fromReference, step.fromStorage);
      }

      await this._dataSource.manager.update(
        ImageEstateStepEntity,
        { id: step.id, state: ImageEstateStepState.COPIED },
        {
          state: ImageEstateStepState.RETIRED,
          retiredAt: new Date(),
          error: null,
        },
      );

      return this.add(counts, 'retired');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this._logger.warn(
        `[retireOne] Old copy not deleted - StepId: ${step.id}, Reason: ${message}`,
      );
      await this._dataSource.manager.update(
        ImageEstateStepEntity,
        { id: step.id },
        { error: message.slice(0, 500) },
      );

      return this.add(counts, 'failed');
    }
  }

  // ----- Helpers -----

  /**
   * The next copies after a run's cursor that are neither undone nor
   * retired.
   *
   * @param run - The run.
   * @returns Up to a batch of them, in order.
   */
  private nextCopied(
    run: ImageEstateRunEntity,
  ): Promise<ImageEstateStepEntity[]> {
    return this._dataSource.manager.find(ImageEstateStepEntity, {
      where: {
        state: ImageEstateStepState.COPIED,
        ...(run.cursor === null ? {} : { id: MoreThan(run.cursor) }),
      },
      order: { id: 'ASC' },
      take: IMAGE_ESTATE_BATCH_SIZE,
    });
  }

  /**
   * Deletes a private copy that will not be used, reporting rather than
   * throwing: an unused copy is invisible, and the inventory counts it.
   *
   * @param step - The copy.
   */
  private async dropCopy(step: ImageEstateStepEntity): Promise<void> {
    if (step.toReference === null || step.toReference === step.fromReference) {
      return;
    }

    try {
      await this._images.deleteImageFromCloudflareImages(step.toReference);
    } catch {
      this._logger.warn(
        `[dropCopy] Unused private copy left - StepId: ${step.id}`,
      );
    }
  }

  /**
   * Deletes a public object, an image or an R2 object. One already gone
   * counts as deleted.
   *
   * @param reference - Its ID or key.
   * @param storage - Where it is.
   */
  private async deleteObject(
    reference: string,
    storage: FileAssetStorage,
  ): Promise<void> {
    if (storage === FileAssetStorage.LEGACY_PUBLIC_R2) {
      await this._images.deleteR2Object(reference);

      return;
    }

    try {
      await this._images.deleteImageFromCloudflareImages(reference);
    } catch (error: unknown) {
      if (
        (error as { response?: { status?: number } }).response?.status !== 404
      ) {
        throw error;
      }
    }
  }

  /**
   * How many published pictures are still public.
   *
   * @param manager - The database.
   * @returns The count.
   */
  private remaining(manager: EntityManager): Promise<number> {
    return manager.count(FileAssetEntity, {
      where: {
        storage: In(PUBLIC_STORAGES),
        state: In([...SHOWABLE_IMAGE_STATES]),
        deliveryPrivate: false,
        deliveryReference: Not(IsNull()),
      },
    });
  }

  /**
   * Whether a run is open.
   *
   * @param manager - The transaction.
   * @returns True when one is.
   */
  private openRun(manager: EntityManager): Promise<boolean> {
    return manager.exists(ImageEstateRunEntity, {
      where: { state: Not(ImageEstateRunState.DONE) },
    });
  }

  /**
   * Moves the open run from one state to another, logged.
   *
   * @param from - Where it must be.
   * @param to - Where it goes.
   * @param action - How the site admin log calls it.
   * @param adminUserId - The site admin.
   * @param reason - Why.
   * @returns The run.
   * @throws ConflictException when no run is where it must be.
   */
  private async move(
    from: ImageEstateRunState | ImageEstateRunState[],
    to: ImageEstateRunState,
    action: SiteAdminActionKind,
    adminUserId: string,
    reason: string,
  ): Promise<ImageEstateRunEntity> {
    return this._dataSource.transaction(async manager => {
      const run = await manager.findOne(ImageEstateRunEntity, {
        where: { state: Array.isArray(from) ? In(from) : from },
      });

      if (run === null) {
        throw new ConflictException('No run is waiting for that.');
      }

      await manager.update(
        ImageEstateRunEntity,
        { id: run.id },
        { state: to, lastError: null },
      );
      await recordSiteAdminAction(manager, {
        action,
        actorUserId: adminUserId,
        subject: { kind: 'IMAGE_ESTATE_RUN', id: run.id },
        reason,
      });

      return { ...run, state: to, lastError: null };
    });
  }

  /**
   * Queues a run's next batch.
   *
   * @param runId - The run.
   */
  private async enqueue(runId: string): Promise<void> {
    await this._queue.add(
      IMAGE_ESTATE_BATCH_JOB,
      { runId },
      { removeOnComplete: true, removeOnFail: true },
    );
  }

  /**
   * Counts one more of something.
   *
   * @param counts - The counts.
   * @param key - What.
   * @returns The counts, moved on.
   */
  private add(
    counts: ImageEstateRunCounts,
    key: keyof ImageEstateRunCounts,
  ): ImageEstateRunCounts {
    return { ...counts, [key]: (counts[key] ?? 0) + 1 };
  }
}
