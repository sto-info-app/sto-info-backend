import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import {
  readWorkerHeartbeats,
  WorkerBlockage,
  workerBlockage,
} from 'src/file-scanning/services/worker-heartbeat.utility';
import { OperationsAlertKind } from 'src/operations/alerts/operations-alert.enum';

import {
  STALE_PLACEMENT_HOURS,
  STALE_PLACEMENT_SWEEP_LIMIT,
} from '../constants/file-asset-publication.constants';
import { FileAssetPlacementEntity } from '../entities/file-asset-placement.entity';
import { FileAssetPlacementState } from '../enums/file-asset-placement-state.enum';
import { FileAssetState } from '../enums/file-asset-state.enum';
import { PublicationPauseService } from '../publication/publication-pause.service';
import { FileAssetPlacementService } from './file-asset-placement.service';
import { FileAssetService } from './file-asset.service';
import { QuarantineStorageService } from './quarantine-storage.service';

/**
 * Why a sweep gave up on nothing (FC-042): the pipeline is stopped now, or
 * started again less than a day ago.
 */
export type StaleUploadSweepHold =
  WorkerBlockage | 'PUBLICATION_PAUSED' | 'RECENTLY_RESUMED';

/** What one sweep did. */
export interface StaleUploadSweepReport {
  /** How many placements were given up on. */
  readonly abandoned: number;
  /** How many quarantined objects could not be removed. */
  readonly undeleted: number;
  /** Why it gave up on nothing, when it held back; otherwise null. */
  readonly heldBy: StaleUploadSweepHold | null;
}

/**
 * The alerts whose problems stop uploads being scanned or published. One
 * still open, or cleared less than a day ago, holds the sweep back.
 */
const STOPPING_ALERTS: readonly OperationsAlertKind[] = [
  OperationsAlertKind.WORKER_SILENT,
  OperationsAlertKind.WORKER_PAUSED,
  OperationsAlertKind.QUEUES_UNREACHABLE,
];

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
 * **Nothing is given up on while the pipeline is stopped** (FC-042, Steve's
 * decision of 30 September 2026). The day counts from the later of the
 * upload and the moment things started again, so the sweep holds back
 * entirely while:
 *
 * - the scan worker is silent or paused now, by the same definitions as
 *   those alerts without their grace periods — and a heartbeat that cannot
 *   be read counts as silent;
 * - publication is paused now;
 * - a `WORKER_SILENT`, `WORKER_PAUSED` or `QUEUES_UNREACHABLE` alert is
 *   open, or cleared less than a day ago: its `clearedAt` is when that
 *   problem ended; or
 * - publication was resumed less than a day ago, by the switch's
 *   `resumedAt`.
 *
 * A stop too short to open an alert — under two minutes silent, ten paused
 * — is not counted, and does not need to be against a day.
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
   * @param _dataSource - The database, for the worker's heartbeat and the
   *   operations alerts.
   * @param _publication - The publication pause.
   */
  constructor(
    private readonly _placements: FileAssetPlacementService,
    private readonly _fileAssets: FileAssetService,
    private readonly _quarantine: QuarantineStorageService,
    @InjectDataSource() private readonly _dataSource: DataSource,
    private readonly _publication: PublicationPauseService,
  ) {}

  /**
   * Abandons every upload that has been pending too long, unless the
   * pipeline is stopped or started again less than a day ago.
   *
   * @returns How many were abandoned, how many left bytes behind, and why
   *   it held back when it did.
   */
  async sweep(): Promise<StaleUploadSweepReport> {
    const before = new Date(
      Date.now() - STALE_PLACEMENT_HOURS * 60 * 60 * 1_000,
    );
    const heldBy = await this.holdOf(before);

    if (heldBy !== null) {
      this._logger.warn(
        `[sweep] Stale uploads kept; the pipeline was stopped - ` +
          `Reason: ${heldBy}`,
      );

      return { abandoned: 0, undeleted: 0, heldBy };
    }

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

    return { abandoned: stale.length, undeleted, heldBy: null };
  }

  /**
   * Why the sweep must hold back, if it must.
   *
   * @param before - A day ago: anything that started again since then is
   *   too recent.
   * @returns The reason, or null when the sweep may go ahead.
   */
  private async holdOf(before: Date): Promise<StaleUploadSweepHold | null> {
    const publication = await this._publication.state(true);

    if (publication.paused) {
      return 'PUBLICATION_PAUSED';
    }

    let workers = null;

    try {
      workers = await readWorkerHeartbeats(this._dataSource);
    } catch (error) {
      this._logger.warn(
        `[holdOf] Worker heartbeat unreadable; counted as silent - Error: ` +
          (error instanceof Error ? error.name : typeof error),
      );
    }

    const blockage = workerBlockage(workers);

    if (blockage !== null) {
      return blockage;
    }

    const [{ recent }] = (await this._dataSource.query(
      `SELECT EXISTS (SELECT 1 FROM "sto_info_app"."operations_alert" ` +
        `WHERE "kind"::text = ANY($1) AND ("clearedAt" IS NULL OR "clearedAt" > $2)) AS "recent"`,
      [STOPPING_ALERTS, before],
    )) as Array<{ recent: boolean }>;
    const resumedRecently =
      publication.resumedAt !== null && publication.resumedAt > before;

    return recent || resumedRecently ? 'RECENTLY_RESUMED' : null;
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
