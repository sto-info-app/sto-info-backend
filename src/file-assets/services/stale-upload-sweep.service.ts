import { Injectable, Logger } from '@nestjs/common';

import {
  STALE_PLACEMENT_HOURS,
  STALE_PLACEMENT_SWEEP_LIMIT,
} from '../constants/file-asset-publication.constants';
import { FileAssetPlacementEntity } from '../entities/file-asset-placement.entity';
import { FileAssetPlacementState } from '../enums/file-asset-placement-state.enum';
import { FileAssetState } from '../enums/file-asset-state.enum';
import { FileAssetPlacementService } from './file-asset-placement.service';
import { FileAssetService } from './file-asset.service';
import { QuarantineStorageService } from './quarantine-storage.service';

/** What one sweep did. */
export interface StaleUploadSweepReport {
  /** How many placements were given up on. */
  readonly abandoned: number;
  /** How many quarantined objects could not be removed. */
  readonly undeleted: number;
}

/**
 * Gives up on uploads nothing ever came back for.
 *
 * Three things leave a placement pending for ever, and none of them is
 * exotic: a worker that was never deployed, a queue that lost a message, and
 * a person who closed the tab during an outage that then ended. Each leaves
 * an object in quarantine that nothing will publish and a slot that reports
 * "still being checked" to anybody who looks.
 *
 * The threshold is a day, which is far longer than any scan and far longer
 * than the pauses ADR-0020 makes ordinary. A `freshclam` outage stops the
 * queue for minutes or hours and the uploads caught by it publish when the
 * scanner comes back; only something that has genuinely been forgotten is
 * still pending the next night.
 *
 * **The bytes go first, and the row is settled whether or not they did.**
 * An object that cannot be deleted is logged and counted, and the placement
 * is abandoned anyway: leaving it pending would mean reporting an upload as
 * in progress for ever because a bucket was briefly unavailable. What that
 * leaves behind is an orphan in a private bucket with no route out of it,
 * which the next sweep does not find and W10's inventory does.
 */
@Injectable()
export class StaleUploadSweepService {
  private readonly _logger = new Logger(StaleUploadSweepService.name);

  /**
   * Creates an instance of StaleUploadSweepService.
   *
   * @param _placements - Which picture is in which slot.
   * @param _fileAssets - The asset registry.
   * @param _quarantine - The private bucket.
   */
  constructor(
    private readonly _placements: FileAssetPlacementService,
    private readonly _fileAssets: FileAssetService,
    private readonly _quarantine: QuarantineStorageService,
  ) {}

  /**
   * Abandons every upload that has been pending too long.
   *
   * @returns How many were abandoned, and how many left bytes behind.
   */
  async sweep(): Promise<StaleUploadSweepReport> {
    const before = new Date(
      Date.now() - STALE_PLACEMENT_HOURS * 60 * 60 * 1_000,
    );

    const stale = await this._placements.findStalePending(
      before,
      STALE_PLACEMENT_SWEEP_LIMIT,
    );

    let undeleted = 0;

    for (const placement of stale) {
      if (!(await this.abandon(placement))) {
        undeleted += 1;
      }
    }

    if (stale.length > 0) {
      this._logger.warn(
        `[sweep] Abandoned uploads nothing came back for - ` +
          `Count: ${stale.length}, Undeleted: ${undeleted}, ` +
          `OlderThan: ${before.toISOString()}`,
      );
    }

    return { abandoned: stale.length, undeleted };
  }

  /**
   * Gives up on one upload.
   *
   * @param placement - The pending placement.
   * @returns True when the quarantined bytes are gone.
   */
  private async abandon(placement: FileAssetPlacementEntity): Promise<boolean> {
    const asset = await this._fileAssets.findById(placement.assetId);
    let deleted = true;

    if (asset !== null && asset.objectKey !== null) {
      deleted = await this.drop(asset.id, asset.objectKey);
    }

    if (asset !== null && asset.state !== FileAssetState.DELETED) {
      await this._fileAssets.discard(
        asset.id,
        'Abandoned: no verdict within the sweep window',
      );
    }

    await this._placements.settle(placement, FileAssetPlacementState.ABANDONED);

    return deleted;
  }

  /**
   * Removes an object from quarantine, reporting rather than throwing.
   *
   * @param assetId - The asset, for the log line.
   * @param objectKey - The key to remove.
   * @returns True when the object is gone.
   */
  private async drop(assetId: string, objectKey: string): Promise<boolean> {
    try {
      await this._quarantine.remove(objectKey);

      return true;
    } catch (error: unknown) {
      this._logger.error(
        `[drop] Could not remove abandoned bytes - AssetId: ${assetId}, ` +
          `Reason: ${error instanceof Error ? error.message : 'unknown'}`,
      );

      return false;
    }
  }
}
