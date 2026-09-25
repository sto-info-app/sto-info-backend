import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager, In } from 'typeorm';

import { FileAssetPlacementEntity } from 'src/file-assets/entities/file-asset-placement.entity';
import { FileAssetPlacementState } from 'src/file-assets/enums/file-asset-placement-state.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';

import { RosterReplayQueueService } from '../../projection/services/roster-replay-queue.service';
import {
  ExcludeRosterRowsDto,
  MarkRosterImportPartialDto,
  RosterImportReasonDto,
} from '../dto/correct-roster-import.dto';
import { RosterImportDetailDto } from '../dto/roster-import-detail.dto';
import {
  RosterImportActionDetail,
  RosterImportActionEntity,
} from '../entities/roster-import-action.entity';
import { RosterImportSourceEntity } from '../entities/roster-import-source.entity';
import { RosterObservationEntity } from '../entities/roster-observation.entity';
import { RosterImportActionKind } from '../enums/roster-import-action-kind.enum';
import { RosterImportStatusService } from './roster-import-status.service';

/** The placement states an import can be corrected in. */
const CORRECTABLE: readonly FileAssetPlacementState[] = [
  FileAssetPlacementState.ACTIVE,
  FileAssetPlacementState.HELD,
];

/** What one correction does, inside its transaction. */
type Correction = (
  manager: EntityManager,
  record: RosterImportSourceEntity,
) => Promise<{
  readonly action: RosterImportActionKind;
  readonly detail: RosterImportActionDetail | null;
}>;

/**
 * Lets an investigator change how an import counts (FC-019).
 *
 * Plan section 3.6: excluded imports remain immutable authorised evidence
 * but leave all derived results; an excluded row means unknown, not a
 * departure; and every exclusion keeps its reason, actor and time, with
 * re-inclusion rebuilding deterministically. Nothing here changes what an
 * export said. Each correction:
 *
 * 1. locks the import, within its Fleet, so two investigators correcting it
 *    at once are told rather than silently overwritten;
 * 2. refuses a correction that would change nothing, or that the import is
 *    not in a state to take — only an import in force or held can be
 *    corrected, and only one in force has rows to exclude;
 * 3. writes the change and an action recording who, why and what;
 * 4. asks for the Fleet's roster to be replayed, in the same transaction;
 *
 * and after it commits, queues the replay. The replay does the rest: an
 * excluded import leaves the projection, a partial one stops proving
 * departures, and an excluded row leaves its member unknown in that export.
 *
 * Only `roster.investigate` holders reach this, and a reason is required of
 * every correction: Steve's decisions of 25 September 2026.
 */
@Injectable()
export class RosterImportCorrectionService {
  private readonly _logger = new Logger(RosterImportCorrectionService.name);

  /**
   * Creates an instance of RosterImportCorrectionService.
   *
   * @param _dataSource - The connection corrections take their transaction
   *   on.
   * @param _replays - Asks for the Fleet's roster to be replayed.
   * @param _status - Reports the import as it now stands.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _replays: RosterReplayQueueService,
    private readonly _status: RosterImportStatusService,
  ) {}

  /**
   * Takes an import out of the Fleet's history.
   *
   * @param fleetId - The Fleet.
   * @param importId - The import.
   * @param userId - The investigator.
   * @param body - Why.
   * @returns The import as it now stands.
   */
  async exclude(
    fleetId: string,
    importId: string,
    userId: string,
    body: RosterImportReasonDto,
  ): Promise<RosterImportDetailDto> {
    return this.correct(
      fleetId,
      importId,
      userId,
      body.reason,
      (manager, record) => {
        if (record.excluded) {
          throw new ConflictException('This import is already excluded.');
        }

        return this.flag(
          manager,
          record,
          { excluded: true },
          RosterImportActionKind.EXCLUDED,
        );
      },
    );
  }

  /**
   * Puts an excluded import back into the Fleet's history.
   *
   * @param fleetId - The Fleet.
   * @param importId - The import.
   * @param userId - The investigator.
   * @param body - Why.
   * @returns The import as it now stands.
   */
  async reinstate(
    fleetId: string,
    importId: string,
    userId: string,
    body: RosterImportReasonDto,
  ): Promise<RosterImportDetailDto> {
    return this.correct(
      fleetId,
      importId,
      userId,
      body.reason,
      (manager, record) => {
        if (!record.excluded) {
          throw new ConflictException('This import is not excluded.');
        }

        return this.flag(
          manager,
          record,
          { excluded: false },
          RosterImportActionKind.REINSTATED,
        );
      },
    );
  }

  /**
   * Says whether an export may not list everybody.
   *
   * @param fleetId - The Fleet.
   * @param importId - The import.
   * @param userId - The investigator.
   * @param body - Whether it is partial, and why.
   * @returns The import as it now stands.
   */
  async markPartial(
    fleetId: string,
    importId: string,
    userId: string,
    body: MarkRosterImportPartialDto,
  ): Promise<RosterImportDetailDto> {
    return this.correct(
      fleetId,
      importId,
      userId,
      body.reason,
      (manager, record) => {
        if (record.partial === body.partial) {
          throw new ConflictException(
            body.partial
              ? 'This import is already marked partial.'
              : 'This import is not marked partial.',
          );
        }

        return this.flag(
          manager,
          record,
          { partial: body.partial },
          body.partial
            ? RosterImportActionKind.MARKED_PARTIAL
            : RosterImportActionKind.UNMARKED_PARTIAL,
        );
      },
    );
  }

  /**
   * Excludes some of an import's rows, or puts them back.
   *
   * Only rows that exist and are not already as asked are accepted, and the
   * whole request is refused otherwise, so the action recorded names exactly
   * the rows that changed.
   *
   * @param fleetId - The Fleet.
   * @param importId - The import.
   * @param userId - The investigator.
   * @param body - Which lines, which way, and why.
   * @returns The import as it now stands.
   */
  async excludeRows(
    fleetId: string,
    importId: string,
    userId: string,
    body: ExcludeRosterRowsDto,
  ): Promise<RosterImportDetailDto> {
    return this.correct(
      fleetId,
      importId,
      userId,
      body.reason,
      async (manager, record) => {
        await this.requireInForce(manager, record);

        const lines = [...body.lines].sort((a, b) => a - b);
        const rows = await manager.find(RosterObservationEntity, {
          where: { importSourceId: record.id, line: In(lines) },
          select: { id: true, line: true, excluded: true },
        });
        const found = new Set(rows.map(row => row.line));
        const missing = lines.filter(line => !found.has(line));

        if (missing.length > 0) {
          throw new BadRequestException(
            `This import has no row on line ${missing.join(', ')}.`,
          );
        }

        const unchanged = rows
          .filter(row => row.excluded === body.excluded)
          .map(row => row.line)
          .sort((a, b) => a - b);

        if (unchanged.length > 0) {
          throw new ConflictException(
            `The row on line ${unchanged.join(', ')} is already ` +
              `${body.excluded ? 'excluded' : 'counted'}.`,
          );
        }

        await manager.update(
          RosterObservationEntity,
          { id: In(rows.map(row => row.id)) },
          { excluded: body.excluded },
        );

        return {
          action: body.excluded
            ? RosterImportActionKind.ROWS_EXCLUDED
            : RosterImportActionKind.ROWS_REINSTATED,
          detail: { lines },
        };
      },
    );
  }

  /**
   * Runs one correction: lock, check, change, record, ask for a replay, and
   * after the commit queue it.
   *
   * @param fleetId - The Fleet.
   * @param importId - The import.
   * @param userId - The investigator.
   * @param reason - Why, already trimmed and required by the DTO.
   * @param work - The correction itself.
   * @returns The import as it now stands.
   * @throws NotFoundException when the Fleet has no such import.
   * @throws ConflictException when the import is not in a state to correct.
   */
  private async correct(
    fleetId: string,
    importId: string,
    userId: string,
    reason: string,
    work: Correction,
  ): Promise<RosterImportDetailDto> {
    const action = await this._dataSource.transaction(async manager => {
      const record = await manager.findOne(RosterImportSourceEntity, {
        where: { id: importId, fleetId },
        lock: { mode: 'pessimistic_write' },
      });

      if (record === null) {
        throw new NotFoundException('Not found');
      }

      await this.requireCorrectable(manager, record);

      const done = await work(manager, record);

      await manager.insert(RosterImportActionEntity, {
        fleetId,
        importSourceId: record.id,
        action: done.action,
        actorUserId: userId,
        reason,
        detail: done.detail,
      });
      await this._replays.request(manager, fleetId);

      return done.action;
    });

    this._logger.log(
      `[correct] Roster import corrected - FleetId: ${fleetId}, ` +
        `ImportId: ${importId}, Action: ${action}`,
    );

    await this._replays.enqueue(fleetId);

    return this._status.detail(fleetId, importId, true);
  }

  /**
   * Changes a flag on the import.
   *
   * @param manager - The transaction.
   * @param record - The import, locked.
   * @param change - The flag and its new value.
   * @param action - What the action log calls it.
   * @returns The action to record, which has no detail.
   */
  private async flag(
    manager: EntityManager,
    record: RosterImportSourceEntity,
    change: Partial<Pick<RosterImportSourceEntity, 'excluded' | 'partial'>>,
    action: RosterImportActionKind,
  ): Promise<{ action: RosterImportActionKind; detail: null }> {
    await manager.update(RosterImportSourceEntity, { id: record.id }, change);

    return { action, detail: null };
  }

  /**
   * Refuses an import that is neither in force nor held.
   *
   * One still being scanned, refused or given up on has never counted and
   * never will, so there is nothing for a correction to change.
   *
   * @param manager - The transaction.
   * @param record - The import.
   * @throws ConflictException when it cannot be corrected.
   */
  private async requireCorrectable(
    manager: EntityManager,
    record: RosterImportSourceEntity,
  ): Promise<void> {
    const state = await this.placementState(manager, record);

    if (state === null || !CORRECTABLE.includes(state)) {
      throw new ConflictException(
        'Only an import in force, or waiting on a conflicting export, can be ' +
          'corrected.',
      );
    }
  }

  /**
   * Refuses an import whose rows have not been read.
   *
   * A held import is read only once it is selected, so it has no rows yet.
   *
   * @param manager - The transaction.
   * @param record - The import.
   * @throws ConflictException when it is not in force.
   */
  private async requireInForce(
    manager: EntityManager,
    record: RosterImportSourceEntity,
  ): Promise<void> {
    if (
      (await this.placementState(manager, record)) !==
      FileAssetPlacementState.ACTIVE
    ) {
      throw new ConflictException(
        'This import’s rows have not been read, so none can be excluded.',
      );
    }
  }

  /**
   * The state of an import's placement.
   *
   * @param manager - The transaction.
   * @param record - The import.
   * @returns The state, or null when it never claimed a placement.
   */
  private async placementState(
    manager: EntityManager,
    record: RosterImportSourceEntity,
  ): Promise<FileAssetPlacementState | null> {
    const placement = await manager.findOne(FileAssetPlacementEntity, {
      where: {
        subject: FileAssetSubject.ROSTER_IMPORT,
        subjectId: record.id,
        assetId: record.assetId,
      },
      select: { state: true },
    });

    return placement?.state ?? null;
  }
}
