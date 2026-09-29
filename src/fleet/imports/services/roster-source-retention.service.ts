import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, In, LessThanOrEqual, Not } from 'typeorm';

import { FileAssetPlacementEntity } from 'src/file-assets/entities/file-asset-placement.entity';
import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetKind } from 'src/file-assets/enums/file-asset-kind.enum';
import { FileAssetPlacementState } from 'src/file-assets/enums/file-asset-placement-state.enum';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { FileAssetStorage } from 'src/file-assets/enums/file-asset-storage.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { QuarantineStorageService } from 'src/file-assets/services/quarantine-storage.service';

import { RosterReplayQueueService } from '../../projection/services/roster-replay-queue.service';
import { RetentionOutcome } from '../../retention/retention-run.service';
import { RETENTION_BATCH_SIZE } from '../../retention/retention.constants';
import { RosterImportActionEntity } from '../entities/roster-import-action.entity';
import { RosterImportSourceEntity } from '../entities/roster-import-source.entity';
import { RosterImportActionKind } from '../enums/roster-import-action-kind.enum';

/** What the registry says of a file a verified erasure deleted (FC-038). */
export const ROSTER_SOURCE_ERASED_REASON =
  'Erased: a verified erasure named somebody in it';

/** Why a file goes, early or on time, as the registry and a retired import's log say it. */
const CAUSES = {
  EXPIRED: {
    asset: 'Expired: sanitised roster file past its retention',
    action: RosterImportActionKind.SOURCE_EXPIRED,
    retired:
      'Its file was deleted at the end of its retention, before anybody ' +
      'selected it, so it can no longer be selected.',
  },
  ERASED: {
    asset: ROSTER_SOURCE_ERASED_REASON,
    action: RosterImportActionKind.SOURCE_ERASED,
    retired:
      'Its file was deleted because it named somebody whose roster data was ' +
      'erased, before anybody selected it, so it can no longer be selected.',
  },
} as const;

/** Why a file goes. */
export type RosterSourceCause = keyof typeof CAUSES;

/** What deleting some files came to. */
export interface RosterSourceDestruction {
  /** Files deleted. */
  readonly deleted: number;
  /** Held imports retired. */
  readonly retired: number;
  /** Files whose bytes could not be deleted, left for the nightly job. */
  readonly notDeleted: number;
  /** The Fleets replayed. */
  readonly fleetIds: readonly string[];
}

/**
 * Deletes sanitised roster files when their retention ends (FC-037).
 *
 * R22 and Steve's decisions of 29 September 2026: a file goes when its
 * `retainUntil` passes — 180 days after upload by default — whatever state
 * its import is in.
 *
 * - **The Fleet's history stays.** An import in force was read into
 *   observations when it went into force, and nothing reads its file again:
 *   corrections, replays and reports all read the rows. Its placement is
 *   left alone, so it counts exactly as before.
 * - **A held import is retired.** One waiting in a conflict was never read,
 *   and selecting it would read its file. With the file gone its placement
 *   is withdrawn, its log says why, and the Fleet is replayed so that it
 *   leaves the projection's inputs; its conflict offers it no more.
 *
 * The bytes go first, and a file that cannot be deleted is left for the
 * next run rather than recorded as gone. The registry and the import change
 * together, so a run that stops half-way leaves the file due, and the next
 * one finishes it.
 */
@Injectable()
export class RosterSourceRetentionService {
  private readonly _logger = new Logger(RosterSourceRetentionService.name);

  /**
   * Creates an instance of RosterSourceRetentionService.
   *
   * @param _dataSource - The database.
   * @param _quarantine - Where the files are.
   * @param _replays - Replays a Fleet whose held import was retired.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _quarantine: QuarantineStorageService,
    private readonly _replays: RosterReplayQueueService,
  ) {}

  /**
   * Deletes every file whose retention has ended, a batch at a time.
   * Daily, by the Fleet's retention schedule.
   *
   * @returns How many were deleted, how many held imports retired, and how
   *   many could not be deleted, and whether that was all that is due.
   */
  async expire(): Promise<RetentionOutcome> {
    const due = await this._dataSource.manager.find(FileAssetEntity, {
      where: {
        kind: FileAssetKind.ROSTER_IMPORT_SOURCE,
        state: Not(FileAssetState.DELETED),
        retainUntil: LessThanOrEqual(new Date()),
      },
      order: { retainUntil: 'ASC', id: 'ASC' },
      take: RETENTION_BATCH_SIZE,
    });
    const done = await this.destroyAll(due, 'EXPIRED');

    return {
      counts: {
        expired: done.deleted,
        retired: done.retired,
        notDeleted: done.notDeleted,
      },
      complete: due.length < RETENTION_BATCH_SIZE && done.notDeleted === 0,
    };
  }

  /**
   * Deletes the files of some imports now, as a verified erasure does
   * (FC-038). A file whose bytes cannot be deleted is marked due, so the
   * nightly job deletes it.
   *
   * @param importIds - The imports whose files go.
   * @returns What it came to.
   */
  async erase(importIds: readonly string[]): Promise<RosterSourceDestruction> {
    if (importIds.length === 0) {
      return { deleted: 0, retired: 0, notDeleted: 0, fleetIds: [] };
    }

    const manager = this._dataSource.manager;
    const records = await manager.find(RosterImportSourceEntity, {
      where: { id: In([...importIds]) },
      select: { id: true, assetId: true },
    });
    const assets = await manager.find(FileAssetEntity, {
      where: {
        id: In(records.map(record => record.assetId)),
        state: Not(FileAssetState.DELETED),
      },
    });

    await manager.update(
      FileAssetEntity,
      { id: In(assets.map(asset => asset.id)) },
      { retainUntil: new Date() },
    );

    return this.destroyAll(assets, 'ERASED');
  }

  /**
   * Deletes files, then replays each Fleet a retired import was in.
   *
   * @param assets - The files.
   * @param cause - Why they go.
   * @returns What it came to.
   */
  private async destroyAll(
    assets: readonly FileAssetEntity[],
    cause: RosterSourceCause,
  ): Promise<RosterSourceDestruction> {
    let deleted = 0;
    let retired = 0;
    let notDeleted = 0;
    const replays = new Set<string>();

    for (const asset of assets) {
      if (asset.objectKey !== null && !(await this.drop(asset))) {
        notDeleted++;
        continue;
      }

      const fleetId = await this.forget(asset.id, cause);

      deleted++;

      if (fleetId !== null) {
        retired++;
        replays.add(fleetId);
      }
    }

    for (const fleetId of replays) {
      await this._replays.enqueue(fleetId);
    }

    return { deleted, retired, notDeleted, fleetIds: [...replays] };
  }

  /**
   * Records a file as gone, and retires its import if it was held.
   *
   * @param assetId - The file.
   * @param cause - Why it goes.
   * @returns The Fleet to replay when a held import was retired, else null.
   */
  private async forget(
    assetId: string,
    cause: RosterSourceCause,
  ): Promise<string | null> {
    return this._dataSource.transaction(async manager => {
      await manager.update(
        FileAssetEntity,
        { id: assetId },
        {
          state: FileAssetState.DELETED,
          storage: FileAssetStorage.NONE,
          revocationReason: CAUSES[cause].asset,
          withdrawnAt: new Date(),
        },
      );

      const record = await manager.findOne(RosterImportSourceEntity, {
        where: { assetId },
      });
      const placement =
        record === null
          ? null
          : await manager.findOne(FileAssetPlacementEntity, {
              where: {
                subject: FileAssetSubject.ROSTER_IMPORT,
                subjectId: record.id,
                assetId,
              },
            });

      if (
        record === null ||
        placement?.state !== FileAssetPlacementState.HELD
      ) {
        return null;
      }

      await manager.update(
        FileAssetPlacementEntity,
        { id: placement.id },
        { state: FileAssetPlacementState.WITHDRAWN, settledAt: new Date() },
      );
      await manager
        .createQueryBuilder()
        .insert()
        .into(RosterImportActionEntity)
        .values({
          fleetId: record.fleetId,
          importSourceId: record.id,
          conflictGroupId: null,
          action: CAUSES[cause].action,
          actorUserId: null,
          reason: CAUSES[cause].retired,
          detail: null,
          idempotencyKey: `${CAUSES[cause].action}:${record.id}`,
        })
        .orIgnore()
        .execute();
      await this._replays.request(manager, record.fleetId);

      this._logger.log(
        `[forget] Held roster import retired - FleetId: ${record.fleetId}, ` +
          `ImportId: ${record.id}`,
      );

      return record.fleetId;
    });
  }

  /**
   * Removes a file's bytes, reporting rather than throwing.
   *
   * @param asset - The file.
   * @returns True when they are gone.
   */
  private async drop(asset: FileAssetEntity): Promise<boolean> {
    try {
      await this._quarantine.remove(asset.objectKey as string);

      return true;
    } catch (error: unknown) {
      this._logger.error(
        `[drop] Roster file not deleted - AssetId: ${asset.id}, ` +
          `Reason: ${error instanceof Error ? error.message : 'unknown'}`,
      );

      return false;
    }
  }
}
