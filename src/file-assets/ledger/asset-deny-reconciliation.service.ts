import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import axios from 'axios';
import { In, MoreThan, Repository } from 'typeorm';

import {
  chunksOf,
  eachLimited,
  LEDGER_CHUNK_SIZE,
  LEDGER_CONCURRENCY,
  LedgerKey,
  LedgerReconciliation,
  noTimings,
  timed,
} from 'src/shared/ledger/ledger.utility';
import { ImageUploadsService } from 'src/shared/utilities/image-uploads.service';

import { FileAssetEntity } from '../entities/file-asset.entity';
import { FileAssetPlacementState } from '../enums/file-asset-placement-state.enum';
import { FileAssetState } from '../enums/file-asset-state.enum';
import { FileAssetStorage } from '../enums/file-asset-storage.enum';
import { AssetWithdrawalService } from '../services/asset-withdrawal.service';
import { FileAssetPlacementService } from '../services/file-asset-placement.service';
import { FileAssetService } from '../services/file-asset.service';
import {
  AssetDenyLedgerService,
  DENIED_FILE_ASSET_STATES,
} from './asset-deny-ledger.service';

/** Why an asset the database had lost the deny of was denied again. */
export const ASSET_DENY_REPLAYED_REASON =
  'Brought back from the asset-deny ledger after a restore.';

/** The code a refusal brought back from the ledger is recorded with. */
export const ASSET_DENY_REPLAYED_CODE = 'RESTORED_FROM_LEDGER';

/** The placements a denied asset can no longer fill. */
const OPEN_PLACEMENT_STATES: readonly FileAssetPlacementState[] = [
  FileAssetPlacementState.PENDING,
  FileAssetPlacementState.ACTIVE,
  FileAssetPlacementState.HELD,
];

/** What the check did about one marker the database lacked. */
type DenyOutcome =
  | 'withdrawn'
  | 'denied'
  | 'purged'
  | 'alreadyPurged'
  | 'nothingDelivered'
  | 'purgeFailed';

/**
 * Checks the asset-deny ledger against the database, at boot (FC-042).
 *
 * The ledger is read by its keys, and the database a chunk at a time. For
 * each asset whose latest marker the database does not reflect:
 *
 * - **Still served** (`AVAILABLE` or `UNVERIFIED`): withdrawn as a site
 *   admin's withdrawal would be — its slot emptied, the row `REVOKED`, and
 *   the Cloudflare delete tried again.
 * - **Not yet served** (being received, scanned or published): its slot is
 *   emptied and it is refused, when the marker says it was refused, or
 *   discarded otherwise. A marker saying `REVOKED` cannot be followed from
 *   those states, so it fails closed to `DELETED` rather than leaving an
 *   asset that could still be published.
 * - **Unknown to the database**, as one uploaded after the backup was taken:
 *   the delivered object the marker names, if any, is deleted — a missing
 *   object counts as deleted — and the marker is written again with when,
 *   so a later boot does not delete it again.
 *
 * Every denied asset with no marker gets one, so the ledger is complete
 * after the first boot that runs this.
 */
@Injectable()
export class AssetDenyReconciliationService {
  private readonly _logger = new Logger(AssetDenyReconciliationService.name);

  /**
   * Creates an instance of AssetDenyReconciliationService.
   *
   * @param _assets - Repository of file assets.
   * @param _ledger - The asset-deny ledger.
   * @param _fileAssets - Moves an asset into a denied state.
   * @param _placements - Empties the slot a denied asset was in.
   * @param _withdrawal - Takes a served picture down.
   * @param _images - Deletes delivered objects from Cloudflare.
   */
  constructor(
    @InjectRepository(FileAssetEntity)
    private readonly _assets: Repository<FileAssetEntity>,
    private readonly _ledger: AssetDenyLedgerService,
    private readonly _fileAssets: FileAssetService,
    private readonly _placements: FileAssetPlacementService,
    private readonly _withdrawal: AssetWithdrawalService,
    private readonly _images: ImageUploadsService,
  ) {}

  /**
   * Compares the ledger with the database, brings back every deny the
   * database lacks and writes a marker for every deny the ledger lacks.
   *
   * @returns What the check came to.
   */
  async reconcile(): Promise<LedgerReconciliation> {
    const timings = noTimings();
    const keys = await timed(timings, 'list', () => this._ledger.listKeys());
    // Oldest first, so each asset's latest marker is the one that stays.
    const latest = new Map(keys.map(key => [key.id, key]));
    const { lacking, unmarked } = await timed(timings, 'compare', async () => {
      const denied = await this.deniedAssets();
      const deniedIds = new Set(denied.map(asset => asset.id));
      const found = new Map(
        (
          await this.assetsById(
            [...latest.keys()].filter(id => !deniedIds.has(id)),
          )
        ).map(asset => [asset.id, asset]),
      );

      return {
        lacking: [...latest.values()]
          .filter(key => !deniedIds.has(key.id))
          .map(key => ({ key, asset: found.get(key.id) ?? null })),
        unmarked: denied.filter(asset => !latest.has(asset.id)),
      };
    });
    const counts: Record<DenyOutcome, number> = {
      withdrawn: 0,
      denied: 0,
      purged: 0,
      alreadyPurged: 0,
      nothingDelivered: 0,
      purgeFailed: 0,
    };

    await timed(timings, 'replay', async () => {
      if (lacking.length === 0) {
        return;
      }

      // Nest has not initialised anything yet: the Cloudflare secrets are
      // fetched here, once, for the withdrawals and deletes below.
      await this._images.ready();

      for (const { key, asset } of lacking) {
        counts[
          asset === null
            ? await this.purge(key)
            : await this.deny(asset, key.kind as FileAssetState)
        ]++;
      }
    });

    const backfilled = await timed(timings, 'backfill', async () => {
      await eachLimited(unmarked, LEDGER_CONCURRENCY, asset =>
        this._ledger.write({
          assetId: asset.id,
          state: asset.state,
          deliveryReference: asset.deliveryReference,
          storage: asset.storage,
          createdAt: (asset.withdrawnAt ?? asset.updatedAt).toISOString(),
        }),
      );

      return unmarked.length;
    });
    const replayed = counts.withdrawn + counts.denied + counts.purged;

    this._logger.log(
      `[reconcile] Asset-deny ledger checked - Markers: ${keys.length}, ` +
        `Withdrawn: ${counts.withdrawn}, Denied: ${counts.denied}, ` +
        `Purged: ${counts.purged}, PurgeFailed: ${counts.purgeFailed}, ` +
        `Backfilled: ${backfilled}`,
    );

    return {
      markers: keys.length,
      replayed,
      backfilled,
      detail: counts,
      timings,
    };
  }

  /**
   * Denies again an asset the database still has in a state that is not
   * denied.
   *
   * @param asset - The asset, as the database has it.
   * @param state - The denied state its latest marker records.
   * @returns What was done.
   */
  private async deny(
    asset: FileAssetEntity,
    state: FileAssetState,
  ): Promise<DenyOutcome> {
    const placement = await this._placements.findByAssetId(asset.id);

    if (placement !== null && OPEN_PLACEMENT_STATES.includes(placement.state)) {
      await this._placements.settle(
        placement,
        FileAssetPlacementState.WITHDRAWN,
      );
    }

    if (
      asset.state === FileAssetState.AVAILABLE ||
      asset.state === FileAssetState.UNVERIFIED
    ) {
      if (asset.deliveryReference === null) {
        await this._fileAssets.revoke(asset.id, ASSET_DENY_REPLAYED_REASON);
      } else {
        await this._withdrawal.withdrawByReference(
          asset.deliveryReference,
          ASSET_DENY_REPLAYED_REASON,
        );
      }

      this._logger.warn(
        `[deny] Served asset withdrawn from the ledger - AssetId: ${asset.id}`,
      );

      return 'withdrawn';
    }

    if (state === FileAssetState.REJECTED) {
      await this._fileAssets.reject(asset.id, ASSET_DENY_REPLAYED_CODE);
    } else {
      await this._fileAssets.discard(asset.id, ASSET_DENY_REPLAYED_REASON);
    }

    this._logger.warn(
      `[deny] Asset denied from the ledger - AssetId: ${asset.id}, ` +
        `From: ${asset.state}`,
    );

    return 'denied';
  }

  /**
   * Deletes the delivered object of an asset the database does not have,
   * reporting rather than throwing: the database cannot serve it, and a
   * Cloudflare that cannot be reached now is asked again at the next boot.
   *
   * @param key - Its latest marker's key.
   * @returns What was done.
   */
  private async purge(key: LedgerKey): Promise<DenyOutcome> {
    const marker = await this._ledger.read(key.key);

    if (marker.purgedAt !== undefined) {
      return 'alreadyPurged';
    }

    if (marker.deliveryReference === null) {
      return 'nothingDelivered';
    }

    try {
      if (marker.storage === FileAssetStorage.LEGACY_PUBLIC_R2) {
        await this._images.deleteR2Object(marker.deliveryReference);
      } else {
        await this._images.deleteImageFromCloudflareImages(
          marker.deliveryReference,
        );
      }
    } catch (error: unknown) {
      if (!axios.isAxiosError(error) || error.response?.status !== 404) {
        this._logger.error(
          `[purge] Delivered object not deleted - AssetId: ${marker.assetId}, ` +
            `Reason: ${error instanceof Error ? error.message : 'unknown'}`,
        );

        return 'purgeFailed';
      }
    }

    await this._ledger.write({ ...marker, purgedAt: new Date().toISOString() });
    this._logger.warn(
      `[purge] Delivered object of an unknown asset deleted - ` +
        `AssetId: ${marker.assetId}`,
    );

    return 'purged';
  }

  /**
   * Every denied asset, read a chunk at a time.
   *
   * @returns Each, with what a marker holds.
   */
  private async deniedAssets(): Promise<FileAssetEntity[]> {
    const all: FileAssetEntity[] = [];
    let page: FileAssetEntity[];

    do {
      const after = all.length === 0 ? null : all[all.length - 1].id;

      page = await this._assets.find({
        where: {
          state: In([...DENIED_FILE_ASSET_STATES]),
          ...(after === null ? {} : { id: MoreThan(after) }),
        },
        select: {
          id: true,
          state: true,
          storage: true,
          deliveryReference: true,
          withdrawnAt: true,
          updatedAt: true,
        },
        order: { id: 'ASC' },
        take: LEDGER_CHUNK_SIZE,
      });
      all.push(...page);
    } while (page.length === LEDGER_CHUNK_SIZE);

    return all;
  }

  /**
   * The assets with some IDs, read a chunk at a time.
   *
   * @param ids - The IDs.
   * @returns Those the database has.
   */
  private async assetsById(ids: readonly string[]): Promise<FileAssetEntity[]> {
    const found: FileAssetEntity[] = [];

    for (const chunk of chunksOf(ids, LEDGER_CHUNK_SIZE)) {
      found.push(
        ...(await this._assets.find({
          where: { id: In(chunk) },
          select: {
            id: true,
            state: true,
            storage: true,
            deliveryReference: true,
          },
        })),
      );
    }

    return found;
  }
}
