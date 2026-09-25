import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager, In, Not } from 'typeorm';

import { FileAssetPlacementEntity } from 'src/file-assets/entities/file-asset-placement.entity';
import { FileAssetPlacementState } from 'src/file-assets/enums/file-asset-placement-state.enum';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { AssetPublicationQueueService } from 'src/file-assets/services/asset-publication-queue.service';
import {
  canonicaliseTimezone,
  LocalTimeResolution,
  resolveLocalDateTime,
} from 'src/shared/utilities/timezone.utility';

import { RosterReplayQueueService } from '../../projection/services/roster-replay-queue.service';
import { ROSTER_ALLOWED_COLUMNS } from '../constants/roster-csv.constants';
import {
  CorrectRosterImportTimezoneDto,
  ExcludeRosterRowsDto,
  MarkRosterImportPartialDto,
  RosterImportReasonDto,
} from '../dto/correct-roster-import.dto';
import { RosterImportDetailDto } from '../dto/roster-import-detail.dto';
import {
  RosterImportActionDetail,
  RosterImportActionEntity,
} from '../entities/roster-import-action.entity';
import { RosterImportConflictEntity } from '../entities/roster-import-conflict.entity';
import { RosterImportSourceEntity } from '../entities/roster-import-source.entity';
import { RosterObservationEntity } from '../entities/roster-observation.entity';
import { RosterCsvRejectionCode } from '../enums/roster-csv-rejection-code.enum';
import { RosterFilenameRejectionCode } from '../enums/roster-filename-rejection-code.enum';
import { RosterImportActionKind } from '../enums/roster-import-action-kind.enum';
import { RosterRowRejectionCode } from '../enums/roster-row-rejection-code.enum';
import { RosterImportStatusService } from './roster-import-status.service';
import { RosterRowProblem } from './roster-typed-parser.service';

/** The placement states an import can be corrected in. */
const CORRECTABLE: readonly FileAssetPlacementState[] = [
  FileAssetPlacementState.ACTIVE,
  FileAssetPlacementState.HELD,
];

/**
 * The four date columns of an observation, each with the column the export
 * named it by. The local text is the observation; the instant and the
 * ambiguity flag are what a zone made of it, and are what a correction
 * rewrites.
 */
const DATE_COLUMNS = [
  ['joinedAt', ROSTER_ALLOWED_COLUMNS[6]],
  ['rankChangedAt', ROSTER_ALLOWED_COLUMNS[7]],
  ['lastActiveAt', ROSTER_ALLOWED_COLUMNS[8]],
  ['publicCommentEditedAt', ROSTER_ALLOWED_COLUMNS[11]],
] as const;

/** What a correction did, for the record and for what follows the commit. */
interface Corrected {
  /** What the action log calls it. */
  readonly action: RosterImportActionKind;
  /** The lines, or the zone and instant, it changed. */
  readonly detail: RosterImportActionDetail | null;
  /** For a selection, the group it settled. */
  readonly conflictGroupId?: string;
  /**
   * For a selection of a held export, true: it has to be read and put in
   * force, and its going into force queues the replay.
   */
  readonly release?: boolean;
}

/** What one correction does, inside its transaction. */
type Correction = (
  manager: EntityManager,
  record: RosterImportSourceEntity,
) => Promise<Corrected>;

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
 *
 * ## Correcting a timezone
 *
 * The export's stamp and every date in its rows are read again through the
 * corrected zone from the local text kept for exactly this (plan section
 * 3.4). Refused, changing nothing, when the import is in a conflict group —
 * Steve's decision of 25 September 2026 — when the new instant is one
 * another export of the Fleet already claims, when the stamp or any date
 * never happened in that zone, or when the stamp names two moments there and
 * the request did not say which, exactly as at upload. The Fleet-name match
 * made at upload is not redone: a former name's validity is measured in
 * months, and the stamp moves by hours.
 *
 * ## Selecting an export
 *
 * Settles which export of a disputed moment stands, and can be changed by
 * selecting another. A held export has never been read, so selecting one
 * queues it for publication once the selection commits; the publisher,
 * asked again, finds it selected and reads it into force, and its going
 * into force queues the replay. Until then the moment reads as awaiting,
 * and if the publication cannot finish, the replay request recorded here
 * leaves the projection stale for the sweep rather than silently wrong.
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
   * @param _publications - Queues a selected held export to be read.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _replays: RosterReplayQueueService,
    private readonly _status: RosterImportStatusService,
    private readonly _publications: AssetPublicationQueueService,
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
   * Reads an export again through the zone it was really taken in.
   *
   * @param fleetId - The Fleet.
   * @param importId - The import.
   * @param userId - The investigator.
   * @param body - The zone, the moment where the stamp names two, and why.
   * @returns The import as it now stands.
   */
  async correctTimezone(
    fleetId: string,
    importId: string,
    userId: string,
    body: CorrectRosterImportTimezoneDto,
  ): Promise<RosterImportDetailDto> {
    return this.correct(
      fleetId,
      importId,
      userId,
      body.reason,
      async (manager, record) => {
        if (record.conflictGroupId !== null) {
          throw new ConflictException(
            'Another export claims this one’s moment. Select or exclude ' +
              'between them before correcting its timezone.',
          );
        }

        // Validated by the DTO, so known; canonical so that two spellings of
        // one zone are not two zones.
        const timezone = canonicaliseTimezone(body.timezone)!;

        if (timezone === record.exportTimezone) {
          throw new ConflictException(
            'This import is already read through that timezone.',
          );
        }

        const exportedAt = this.settleStamp(record, timezone, body.exportedAt);

        await this.requireMomentFree(manager, record, exportedAt.at);
        await this.rereadRows(manager, record, timezone);

        await manager.update(
          RosterImportSourceEntity,
          { id: record.id },
          {
            exportTimezone: timezone,
            exportedAt: exportedAt.at,
            exportedAtAmbiguous: exportedAt.ambiguous,
          },
        );

        return {
          action: RosterImportActionKind.TIMEZONE_CORRECTED,
          detail: {
            fromTimezone: record.exportTimezone,
            toTimezone: timezone,
            fromExportedAt: record.exportedAt?.toISOString() ?? null,
            toExportedAt: exportedAt.at.toISOString(),
          },
        };
      },
    );
  }

  /**
   * Selects an export as the one that stands for its disputed moment.
   *
   * @param fleetId - The Fleet.
   * @param importId - The export to select.
   * @param userId - The investigator.
   * @param body - Why.
   * @returns The import as it now stands.
   */
  async select(
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
      async (manager, record) => {
        if (record.conflictGroupId === null) {
          throw new ConflictException(
            'No other export claims this moment, so there is nothing to ' +
              'select between.',
          );
        }

        if (record.excluded) {
          throw new ConflictException(
            'This import is excluded. Reinstate it before selecting it.',
          );
        }

        const group = await manager.findOneOrFail(RosterImportConflictEntity, {
          where: { id: record.conflictGroupId },
          lock: { mode: 'pessimistic_write' },
        });

        if (group.selectedImportId === record.id) {
          throw new ConflictException(
            'This export is already the one selected.',
          );
        }

        await manager.update(
          RosterImportConflictEntity,
          { id: group.id },
          { selectedImportId: record.id, resolvedAt: new Date() },
        );

        return {
          action: RosterImportActionKind.CONFLICT_SELECTED,
          detail: null,
          conflictGroupId: group.id,
          release:
            (await this.placementState(manager, record)) ===
            FileAssetPlacementState.HELD,
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
    const done = await this._dataSource.transaction(async manager => {
      const record = await manager.findOne(RosterImportSourceEntity, {
        where: { id: importId, fleetId },
        lock: { mode: 'pessimistic_write' },
      });

      if (record === null) {
        throw new NotFoundException('Not found');
      }

      await this.requireCorrectable(manager, record);

      const corrected = await work(manager, record);

      await manager.insert(RosterImportActionEntity, {
        fleetId,
        importSourceId: record.id,
        conflictGroupId: corrected.conflictGroupId ?? null,
        action: corrected.action,
        actorUserId: userId,
        reason,
        detail: corrected.detail,
      });
      await this._replays.request(manager, fleetId);

      return { ...corrected, assetId: record.assetId };
    });

    this._logger.log(
      `[correct] Roster import corrected - FleetId: ${fleetId}, ` +
        `ImportId: ${importId}, Action: ${done.action}`,
    );

    if (done.release === true) {
      await this._publications.enqueue(done.assetId);
    } else {
      await this._replays.enqueue(fleetId);
    }

    return this._status.detail(fleetId, importId, true);
  }

  /**
   * Works out the instant an export's stamp names in a zone.
   *
   * @param record - The import.
   * @param timezone - The canonical zone.
   * @param chosen - The moment the request chose, if it chose one.
   * @returns The instant, and whether it was chosen between two.
   * @throws BadRequestException when the stamp never happened in that zone,
   *   names two moments and none was chosen, or the one chosen is neither.
   */
  private settleStamp(
    record: RosterImportSourceEntity,
    timezone: string,
    chosen: string | undefined,
  ): { at: Date; ambiguous: boolean } {
    if (record.exportLocalStamp === null) {
      throw new ConflictException(
        'This import has no export time to read again.',
      );
    }

    // A stamp the upload already read is well formed, so only the zone can
    // make it unreadable now.
    const resolved = resolveLocalDateTime(record.exportLocalStamp, timezone)!;

    if (resolved.resolution === LocalTimeResolution.NONEXISTENT) {
      throw this.unreadable(RosterFilenameRejectionCode.STAMP_NONEXISTENT);
    }

    if (chosen === undefined) {
      if (resolved.resolution === LocalTimeResolution.AMBIGUOUS) {
        throw this.unreadable(
          RosterFilenameRejectionCode.STAMP_CHOICE_REQUIRED,
        );
      }

      return { at: resolved.candidates[0], ambiguous: false };
    }

    const at = resolved.candidates.find(
      candidate => candidate.getTime() === new Date(chosen).getTime(),
    );

    if (at === undefined) {
      throw this.unreadable(
        RosterFilenameRejectionCode.STAMP_CHOICE_NOT_A_CANDIDATE,
      );
    }

    return { at, ambiguous: resolved.candidates.length > 1 };
  }

  /**
   * Refuses a moment another export of the Fleet already claims.
   *
   * Under the lock an upload claiming that moment takes, so a correction and
   * an upload racing for it are serialised, and whichever comes second sees
   * the other. A refused export is no claim on anything.
   *
   * @param manager - The transaction.
   * @param record - The import being corrected.
   * @param exportedAt - The instant it would move to.
   * @throws ConflictException naming the export that claims it.
   */
  private async requireMomentFree(
    manager: EntityManager,
    record: RosterImportSourceEntity,
    exportedAt: Date,
  ): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `fleet-roster-export:${record.fleetId}:${exportedAt.toISOString()}`,
    ]);

    const claimant = (
      await manager.find(RosterImportSourceEntity, {
        where: { fleetId: record.fleetId, exportedAt, id: Not(record.id) },
        relations: { asset: true },
      })
    ).find(other => other.asset.state !== FileAssetState.REJECTED);

    if (claimant !== undefined) {
      throw new ConflictException(
        `Another export of this Fleet, ${claimant.originalFilename}, ` +
          'already claims that moment.',
      );
    }
  }

  /**
   * Reads every date in an import's rows again through a zone.
   *
   * All of them or none: a date that never happened in that zone refuses the
   * correction, naming its line and column as the upload would have.
   *
   * @param manager - The transaction.
   * @param record - The import.
   * @param timezone - The canonical zone.
   * @throws BadRequestException carrying every row problem.
   */
  private async rereadRows(
    manager: EntityManager,
    record: RosterImportSourceEntity,
    timezone: string,
  ): Promise<void> {
    const rows = await manager.find(RosterObservationEntity, {
      where: { importSourceId: record.id },
      select: {
        id: true,
        line: true,
        joinedAtLocal: true,
        rankChangedAtLocal: true,
        lastActiveAtLocal: true,
        publicCommentEditedAtLocal: true,
      },
      order: { line: 'ASC' },
    });
    const problems: RosterRowProblem[] = [];
    const updates: Array<{
      id: string;
      values: Partial<RosterObservationEntity>;
    }> = [];

    for (const row of rows) {
      const values: Partial<Record<string, Date | boolean | null>> = {};

      for (const [column, header] of DATE_COLUMNS) {
        const local = row[`${column}Local`];

        if (local === null) {
          continue;
        }

        // Read once already, so well formed; only the zone can fail it.
        const resolved = resolveLocalDateTime(local, timezone)!;

        if (resolved.resolution === LocalTimeResolution.NONEXISTENT) {
          problems.push({
            code: RosterRowRejectionCode.DATE_NONEXISTENT,
            line: row.line,
            column: header,
          });
          continue;
        }

        values[column] = resolved.candidates[0];
        values[`${column}Ambiguous`] = resolved.candidates.length > 1;
      }

      updates.push({
        id: row.id,
        values: values as Partial<RosterObservationEntity>,
      });
    }

    if (problems.length > 0) {
      throw this.unreadable(RosterCsvRejectionCode.ROWS_UNREADABLE, problems);
    }

    for (const { id, values } of updates) {
      if (Object.keys(values).length > 0) {
        await manager.update(RosterObservationEntity, { id }, values);
      }
    }
  }

  /**
   * The refusal a correction that cannot be read gets.
   *
   * The shape an upload's refusal has, so a client reads one body: a code,
   * and every row problem, and nothing out of the file.
   *
   * @param code - Why.
   * @param problems - Every row the zone cannot read, for a refusal of rows.
   * @returns The exception.
   */
  private unreadable(
    code: RosterCsvRejectionCode | RosterFilenameRejectionCode,
    problems: readonly RosterRowProblem[] = [],
  ): BadRequestException {
    return new BadRequestException({
      message:
        'Through that timezone this export cannot be read, so nothing was ' +
        'corrected.',
      code,
      line: null,
      problems: problems.map(problem => ({ ...problem })),
    });
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
