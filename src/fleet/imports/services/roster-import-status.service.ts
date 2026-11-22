import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import {
  FindOptionsRelations,
  In,
  IsNull,
  Not,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';

import { FileAssetPlacementEntity } from 'src/file-assets/entities/file-asset-placement.entity';
import { FileAssetPlacementState } from 'src/file-assets/enums/file-asset-placement-state.enum';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { FileAssetPlacementService } from 'src/file-assets/services/file-asset-placement.service';
import { RosterRankCountDto } from 'src/fleet/roster/dto/roster-page.dto';
import { RosterRankOrderEntity } from 'src/fleet/roster/entities/roster-rank-order.entity';
import { RosterSortDirection } from 'src/fleet/roster/enums/roster-sort.enum';
import { compareText } from 'src/shared/utilities/compare-text.utility';
import { escapeSqlLikeTerm } from 'src/shared/utilities/sql-like.utility';

import {
  resolveDirectoryPage,
  resolveDirectoryPageSize,
} from '../../utilities/directory-query.utility';
import { RosterImportActionDto } from '../dto/roster-import-action.dto';
import { RosterImportConflictPageDto } from '../dto/roster-import-conflicts.dto';
import { RosterImportDetailDto } from '../dto/roster-import-detail.dto';
import { RosterImportPageDto } from '../dto/roster-import-page.dto';
import { RosterImportRowsQueryDto } from '../dto/roster-import-rows-query.dto';
import { RosterImportRowPageDto } from '../dto/roster-import-rows.dto';
import { RosterImportSourceDto } from '../dto/roster-import-source.dto';
import { RosterImportActionEntity } from '../entities/roster-import-action.entity';
import { RosterImportConflictEntity } from '../entities/roster-import-conflict.entity';
import { RosterImportSourceEntity } from '../entities/roster-import-source.entity';
import { RosterObservationEntity } from '../entities/roster-observation.entity';
import { RosterCsvRejectionCode } from '../enums/roster-csv-rejection-code.enum';
import { RosterHoldReason } from '../enums/roster-hold-reason.enum';
import { RosterImportConflictFilter } from '../enums/roster-import-conflict-filter.enum';
import { RosterImportRowSort } from '../enums/roster-import-row-sort.enum';
import { RosterImportStatus } from '../enums/roster-import-status.enum';
import { RosterPublicationRejectionCode } from '../enums/roster-publication-rejection-code.enum';
import { normaliseRosterCharacterName } from '../utilities/roster-identity.utility';
import { ROSTER_SOURCE_ERASED_REASON } from './roster-source-retention.service';

/** The column each ordering of an import's rows sorts by first (FC-055). */
const ROW_SORT_COLUMNS: Readonly<Record<RosterImportRowSort, string>> = {
  [RosterImportRowSort.LINE]: 'o.line',
  [RosterImportRowSort.NAME]: 'o.characterNameNormalised',
  [RosterImportRowSort.HANDLE]: 'o.accountHandleNormalised',
  [RosterImportRowSort.RANK]: 'r.tier',
  [RosterImportRowSort.LEVEL]: 'o.level',
  [RosterImportRowSort.JOINED]: 'o.joinedAt',
  [RosterImportRowSort.CONTRIBUTION]: 'o.contributionTotal',
  [RosterImportRowSort.LAST_ACTIVE]: 'o.lastActiveAt',
};

/**
 * What a refusal is reported as when this feature did not make it.
 *
 * The scanner's own code is administrator-only (R24): naming what matched
 * tells somebody probing the scanner precisely what gets through.
 */
export const SCAN_REFUSED = 'SCAN_REFUSED';

/**
 * The scanner's refusal that says it never judged the file.
 *
 * Every attempt to scan it failed to reach a verdict and the budget ran
 * out, which is what happened to the first import on tribble when the
 * worker could not read from the store (17 October 2026). It names nothing
 * about the file's content, so it may be shown to whoever sent it, and an
 * import refused this way may be replaced by sending the export again, as
 * an abandoned one may: the file was never read, and answering a re-send
 * with this import would leave the export unimportable for good.
 */
export const SCAN_NOT_COMPLETED = 'RETRY_BUDGET_EXHAUSTED';

/**
 * The refusals that describe no content and may be named to whoever sent the
 * file: this feature's own, about the file's structure, and the scanner's
 * one admission that it never answered.
 *
 * An allow-list rather than a deny-list, so a code added anywhere else in the
 * asset pipeline is hidden until somebody decides otherwise.
 */
const NAMEABLE_REFUSALS: ReadonlySet<string> = new Set<string>([
  RosterCsvRejectionCode.ROWS_UNREADABLE,
  ...Object.values(RosterPublicationRejectionCode),
  SCAN_NOT_COMPLETED,
]);

/** The asset states in which the scanner has yet to answer. */
const AWAITING_SCANNER: ReadonlySet<FileAssetState> = new Set([
  FileAssetState.RECEIVING,
  FileAssetState.QUARANTINED,
  FileAssetState.SCANNING,
  FileAssetState.RETRY_PENDING,
]);

/**
 * The asset states in which the scanner has cleared the file. `AVAILABLE`
 * with a pending placement is an import whose publication was interrupted
 * after its rows were read, and is resumed rather than read again.
 */
const CLEARED: ReadonlySet<FileAssetState> = new Set([
  FileAssetState.CLEAN,
  FileAssetState.AVAILABLE,
]);

/** What every read of an import needs beside the row itself. */
const RELATIONS: FindOptionsRelations<RosterImportSourceEntity> = {
  asset: true,
  uploadedBy: { profile: true },
};

/** A status, and the code that explains it where one does. */
interface DerivedStatus {
  readonly status: RosterImportStatus;
  readonly reason: string | null;
}

/**
 * Reports what became of a Fleet's roster imports.
 *
 * The status is derived here and nowhere else, from the two records that
 * hold the truth between them: the asset (what the scanner made of the
 * bytes) and the placement (what publication made of the import). An import
 * is looked up within its Fleet and never by identifier alone, so an import
 * of another Fleet is reported as absent rather than as forbidden.
 */
@Injectable()
export class RosterImportStatusService {
  private readonly _logger = new Logger(RosterImportStatusService.name);

  /**
   * Creates an instance of RosterImportStatusService.
   *
   * @param _imports - Import provenance.
   * @param _placements - What publication made of each import.
   * @param _observations - Read for the rows an investigator excluded.
   * @param _actions - Every correction made to an import.
   * @param _conflicts - Which export a conflict group selected.
   */
  constructor(
    @InjectRepository(RosterImportSourceEntity)
    private readonly _imports: Repository<RosterImportSourceEntity>,
    private readonly _placements: FileAssetPlacementService,
    @InjectRepository(RosterObservationEntity)
    private readonly _observations: Repository<RosterObservationEntity>,
    @InjectRepository(RosterImportActionEntity)
    private readonly _actions: Repository<RosterImportActionEntity>,
    @InjectRepository(RosterImportConflictEntity)
    private readonly _conflicts: Repository<RosterImportConflictEntity>,
  ) {}

  /**
   * Lists a Fleet's imports, newest first.
   *
   * @param fleetId - The Fleet.
   * @param page - The page asked for, from one.
   * @param pageSize - How many to a page.
   * @returns The page.
   */
  async list(
    fleetId: string,
    page?: number,
    pageSize?: number,
  ): Promise<RosterImportPageDto> {
    const resolvedPage = resolveDirectoryPage(page);
    const resolvedPageSize = resolveDirectoryPageSize(pageSize);

    const [records, total] = await this._imports.findAndCount({
      where: { fleetId },
      relations: RELATIONS,
      // The identifier breaks ties, so two uploads in one instant cannot
      // swap places between one page and the next.
      order: { uploadedAt: 'DESC', id: 'DESC' },
      skip: (resolvedPage - 1) * resolvedPageSize,
      take: resolvedPageSize,
    });

    return {
      items: await this.summarise(records),
      total,
      page: resolvedPage,
      pageSize: resolvedPageSize,
    };
  }

  /**
   * Reports one import as a listing would.
   *
   * @param fleetId - The Fleet it must belong to.
   * @param importId - The import.
   * @returns The import.
   * @throws NotFoundException when the Fleet has no such import.
   */
  async summary(
    fleetId: string,
    importId: string,
  ): Promise<RosterImportSourceDto> {
    const [summary] = await this.summarise([
      await this.require(fleetId, importId),
    ]);

    return summary;
  }

  /**
   * Reports one import, with what only an investigator is shown.
   *
   * @param fleetId - The Fleet it must belong to.
   * @param importId - The import.
   * @param investigator - Whether the caller holds `roster.investigate`.
   * @returns The import.
   * @throws NotFoundException when the Fleet has no such import.
   */
  async detail(
    fleetId: string,
    importId: string,
    investigator: boolean,
  ): Promise<RosterImportDetailDto> {
    const record = await this.require(fleetId, importId);
    const [summary] = await this.summarise([record]);

    if (!investigator) {
      return {
        ...summary,
        problems: null,
        conflictMembers: null,
        selectedImportId: null,
        excludedLines: null,
        actions: null,
      };
    }

    return {
      ...summary,
      selectedImportId:
        record.conflictGroupId === null
          ? null
          : ((
              await this._conflicts.findOne({
                where: { id: record.conflictGroupId },
                select: { id: true, selectedImportId: true },
              })
            )?.selectedImportId ?? null),
      excludedLines: (
        await this._observations.find({
          where: { importSourceId: record.id, excluded: true },
          select: { line: true },
          order: { line: 'ASC' },
        })
      ).map(observation => observation.line),
      actions: await this.history(record.id),
      problems: (record.publicationProblems ?? []).map(problem => ({
        code: problem.code,
        line: problem.line,
        column: problem.column,
      })),
      conflictMembers:
        record.conflictGroupId === null
          ? []
          : await this.summarise(
              await this._imports.find({
                where: {
                  fleetId,
                  conflictGroupId: record.conflictGroupId,
                  id: Not(record.id),
                },
                relations: RELATIONS,
                // The order the conflict service decides by, so the first
                // unrefused member listed is the version in force.
                order: { uploadedAt: 'ASC', id: 'ASC' },
              }),
            ),
    };
  }

  /**
   * Lists one import's rows, in line order, for an investigator choosing
   * rows to exclude (FC-020).
   *
   * @param fleetId - The Fleet it must belong to.
   * @param importId - The import.
   * @param page - The page asked for, from one.
   * @param pageSize - How many to a page.
   * @returns The page. An import with no rows in force gives none.
   * @throws NotFoundException when the Fleet has no such import.
   */
  async rows(
    fleetId: string,
    importId: string,
    query: RosterImportRowsQueryDto = {},
  ): Promise<RosterImportRowPageDto> {
    const record = await this.require(fleetId, importId);
    const resolvedPage = resolveDirectoryPage(query.page);
    const resolvedPageSize = resolveDirectoryPageSize(query.pageSize);
    const [[rows, total], ranks] = await Promise.all([
      this.rowsQuery(record.id, query)
        .skip((resolvedPage - 1) * resolvedPageSize)
        .take(resolvedPageSize)
        .getManyAndCount(),
      this.rankCounts(record.id, fleetId),
    ]);

    return {
      items: rows.map(row => ({
        line: row.line,
        characterName: row.characterName,
        accountHandle: row.accountHandle,
        guildRank: row.guildRank,
        level: row.level,
        contributionTotal: row.contributionTotal,
        joinedAt: row.joinedAt,
        lastActiveAt: row.lastActiveAt,
        excluded: row.excluded,
      })),
      ranks,
      total,
      page: resolvedPage,
      pageSize: resolvedPageSize,
    };
  }

  /**
   * Builds the query for one import's rows, within the filters and in the
   * order asked for (FC-055).
   *
   * Mirrors the roster page's: a search matches a Character name or an
   * account handle through the same folds the import stored, a rank is
   * matched exactly, and a rank ordering goes by the Fleet's rank order,
   * joined for the sort alone. Every ordering ends on line, so a page
   * boundary never falls differently between two requests.
   *
   * @param importId - The import.
   * @param query - The filters and ordering asked for.
   * @returns The query, unpaged.
   */
  private rowsQuery(
    importId: string,
    query: RosterImportRowsQueryDto,
  ): SelectQueryBuilder<RosterObservationEntity> {
    const sort = query.sort ?? RosterImportRowSort.LINE;
    const direction = query.direction ?? RosterSortDirection.ASC;
    const builder = this._observations
      .createQueryBuilder('o')
      .leftJoin(
        RosterRankOrderEntity,
        'r',
        'r.fleetId = o.fleetId AND r.label = o.guildRank',
      )
      .where('o.importSourceId = :importId', { importId });

    if (query.search) {
      // Both folds lower-case, and a handle's also trims, which the DTO has
      // already done to the term.
      const term = escapeSqlLikeTerm(
        normaliseRosterCharacterName(query.search),
      );

      builder.andWhere(
        '(o.characterNameNormalised LIKE :search OR o.accountHandleNormalised LIKE :search)',
        { search: `%${term}%` },
      );
    }

    if (query.rank !== undefined) {
      builder.andWhere('o.guildRank = :rank', { rank: query.rank });
    }

    builder.orderBy(ROW_SORT_COLUMNS[sort], direction, 'NULLS LAST');

    if (sort === RosterImportRowSort.RANK) {
      builder.addOrderBy('o.guildRank', direction);
    }

    if (sort !== RosterImportRowSort.LINE) {
      builder.addOrderBy('o.line', 'ASC');
    }

    return builder;
  }

  /**
   * Counts the rows holding each rank label on the import, for the Rank
   * filter (FC-055): across the whole import, whatever is being shown.
   *
   * @param importId - The import.
   * @param fleetId - The Fleet, whose rank order places the labels.
   * @returns Each label, highest tier first and unplaced labels last.
   */
  private async rankCounts(
    importId: string,
    fleetId: string,
  ): Promise<RosterRankCountDto[]> {
    const [counts, placed] = await Promise.all([
      this._observations
        .createQueryBuilder('o')
        .select('o.guildRank', 'label')
        .addSelect('COUNT(*)', 'members')
        .where('o.importSourceId = :importId', { importId })
        .groupBy('o.guildRank')
        .getRawMany<{ label: string; members: string }>(),
      this._observations.manager.find(RosterRankOrderEntity, {
        where: { fleetId },
        select: { fleetId: true, label: true, tier: true },
      }),
    ]);
    const tiers = new Map(placed.map(entry => [entry.label, entry.tier]));

    return counts
      .map(count => ({
        label: count.label,
        tier: tiers.get(count.label) ?? null,
        members: Number(count.members),
      }))
      .sort(
        (a, b) =>
          (a.tier ?? Number.MAX_SAFE_INTEGER) -
            (b.tier ?? Number.MAX_SAFE_INTEGER) ||
          compareText(a.label, b.label),
      );
  }

  /**
   * Lists a Fleet's conflict groups, latest moment first, each with its
   * exports (FC-020).
   *
   * Read from the groups themselves rather than from a revision's inputs: an
   * export that is only held asks for no replay, so a revision can be one
   * behind a group.
   *
   * @param fleetId - The Fleet.
   * @param filter - Which groups.
   * @param page - The page asked for, from one.
   * @param pageSize - How many to a page.
   * @returns The page.
   */
  async conflicts(
    fleetId: string,
    filter: RosterImportConflictFilter = RosterImportConflictFilter.OPEN,
    page?: number,
    pageSize?: number,
  ): Promise<RosterImportConflictPageDto> {
    const resolvedPage = resolveDirectoryPage(page);
    const resolvedPageSize = resolveDirectoryPageSize(pageSize);
    const [groups, total] = await this._conflicts.findAndCount({
      where: {
        fleetId,
        ...(filter === RosterImportConflictFilter.OPEN
          ? { resolvedAt: IsNull() }
          : {}),
        ...(filter === RosterImportConflictFilter.SETTLED
          ? { resolvedAt: Not(IsNull()) }
          : {}),
      },
      order: { exportedAt: 'DESC', id: 'DESC' },
      skip: (resolvedPage - 1) * resolvedPageSize,
      take: resolvedPageSize,
    });
    const members =
      groups.length === 0
        ? []
        : await this.summariseWithGroups(
            await this._imports.find({
              where: {
                fleetId,
                conflictGroupId: In(groups.map(group => group.id)),
              },
              relations: RELATIONS,
              // The order the conflict service decides by.
              order: { uploadedAt: 'ASC', id: 'ASC' },
            }),
          );

    return {
      items: groups.map(group => ({
        id: group.id,
        exportedAt: group.exportedAt,
        openedAt: group.openedAt,
        resolvedAt: group.resolvedAt,
        selectedImportId: group.selectedImportId,
        members: members
          .filter(member => member.groupId === group.id)
          .map(member => member.summary),
      })),
      total,
      page: resolvedPage,
      pageSize: resolvedPageSize,
    };
  }

  /**
   * Summarises imports, keeping which group each is in.
   *
   * @param records - The imports.
   * @returns Each import's summary beside its group.
   */
  private async summariseWithGroups(
    records: readonly RosterImportSourceEntity[],
  ): Promise<
    Array<{ groupId: string | null; summary: RosterImportSourceDto }>
  > {
    const summaries = await this.summarise(records);

    return records.map((record, index) => ({
      groupId: record.conflictGroupId,
      summary: summaries[index],
    }));
  }

  /**
   * Every correction made to an import, newest first.
   *
   * @param importId - The import.
   * @returns Its actions, each naming its investigator by username.
   */
  private async history(importId: string): Promise<RosterImportActionDto[]> {
    const actions = await this._actions.find({
      where: { importSourceId: importId },
      relations: { actor: { profile: true } },
      order: { actedAt: 'DESC', id: 'DESC' },
    });

    return actions.map(action => ({
      id: action.id,
      action: action.action,
      actorName: action.actor?.profile?.username ?? null,
      reason: action.reason,
      detail: action.detail === null ? null : { ...action.detail },
      actedAt: action.actedAt,
    }));
  }

  /**
   * Finds an import within its Fleet.
   *
   * @param fleetId - The Fleet.
   * @param importId - The import.
   * @returns The import, with its asset and uploader.
   * @throws NotFoundException when the Fleet has no such import.
   */
  private async require(
    fleetId: string,
    importId: string,
  ): Promise<RosterImportSourceEntity> {
    const record = await this._imports.findOne({
      where: { id: importId, fleetId },
      relations: RELATIONS,
    });

    if (record === null) {
      throw new NotFoundException('Not found');
    }

    return record;
  }

  /**
   * Reports whether sending the same file again may replace this import.
   *
   * Only an import whose file was never read: one given up on before it was
   * read (FC-050), or one the scanner refused without ever judging it. An
   * import in flight, in force, held or refused on what was in it stays the
   * answer to its file.
   *
   * @param record - The import, with its asset.
   * @returns True when a re-send starts afresh.
   */
  async mayBeReplaced(record: RosterImportSourceEntity): Promise<boolean> {
    const placement = await this._placements.findByAssetId(record.assetId);
    const { status, reason } = this.derive(record, placement);

    return (
      status === RosterImportStatus.ABANDONED ||
      (status === RosterImportStatus.REFUSED && reason === SCAN_NOT_COMPLETED)
    );
  }

  /**
   * Reports several imports, asking about their placements once.
   *
   * @param records - The imports, with their assets and uploaders.
   * @returns Them, in the same order.
   */
  private async summarise(
    records: readonly RosterImportSourceEntity[],
  ): Promise<RosterImportSourceDto[]> {
    const placements = await this._placements.findByAssetIds(
      records.map(record => record.assetId),
    );
    const byAsset = new Map(
      placements.map(placement => [placement.assetId, placement]),
    );

    return records.map(record =>
      this.describe(record, byAsset.get(record.assetId) ?? null),
    );
  }

  /**
   * Reports one import.
   *
   * @param record - The import, with its asset and uploader.
   * @param placement - Its placement, if it ever claimed one.
   * @returns The import as it is reported.
   */
  private describe(
    record: RosterImportSourceEntity,
    placement: FileAssetPlacementEntity | null,
  ): RosterImportSourceDto {
    const { status, reason } = this.derive(record, placement);

    return {
      id: record.id,
      assetId: record.assetId,
      fleetId: record.fleetId,
      originalFilename: record.originalFilename,
      sourceSha256: record.sourceSha256,
      sanitisedSha256: record.sanitisedSha256,
      sourceByteSize: Number(record.sourceByteSize),
      sanitisedByteSize: Number(record.sanitisedByteSize),
      sourceHeaderShape: record.sourceHeaderShape,
      exportTimezone: record.exportTimezone,
      exportLocalStamp: record.exportLocalStamp,
      exportedAt: record.exportedAt,
      exportedAtAmbiguous: record.exportedAtAmbiguous,
      rowCount: record.rowCount,
      officerTailRowCount: record.officerTailRowCount,
      parserVersion: record.parserVersion,
      state: record.asset.state,
      retainUntil: record.asset.retainUntil,
      conflictGroupId: record.conflictGroupId,
      status,
      statusReason: reason,
      problemCount: record.publicationProblems?.length ?? 0,
      uploadedByName: record.uploadedBy?.profile?.username ?? null,
      uploadedAt: record.uploadedAt,
      excluded: record.excluded,
      partial: record.partial,
    };
  }

  /**
   * Works out where an import has got to.
   *
   * The placement is asked first where it is decisive, because a held or
   * abandoned import can have a perfectly ordinary asset. A refusal comes
   * next, whoever made it. Only then does the asset say how far along an
   * import still in flight is.
   *
   * @param record - The import, with its asset.
   * @param placement - Its placement, if it ever claimed one.
   * @returns The status, and the code that explains it.
   */
  private derive(
    record: RosterImportSourceEntity,
    placement: FileAssetPlacementEntity | null,
  ): DerivedStatus {
    const { asset } = record;

    if (placement?.state === FileAssetPlacementState.HELD) {
      return {
        status: RosterImportStatus.HELD,
        // The only thing a roster is held for. Said only when it is true of
        // this import, rather than assumed of every hold.
        reason:
          record.conflictGroupId === null
            ? null
            : RosterHoldReason.EXPORT_INSTANT_IN_CONFLICT,
      };
    }

    if (placement?.state === FileAssetPlacementState.ABANDONED) {
      return { status: RosterImportStatus.ABANDONED, reason: null };
    }

    // Only retention (FC-037) and erasure (FC-038) withdraw a roster
    // import's placement, and the registry says which.
    if (placement?.state === FileAssetPlacementState.WITHDRAWN) {
      return {
        status:
          asset.revocationReason === ROSTER_SOURCE_ERASED_REASON
            ? RosterImportStatus.ERASED
            : RosterImportStatus.EXPIRED,
        reason: null,
      };
    }

    if (asset.state === FileAssetState.REJECTED) {
      return {
        status: RosterImportStatus.REFUSED,
        reason:
          asset.rejectionCode !== null &&
          NAMEABLE_REFUSALS.has(asset.rejectionCode)
            ? asset.rejectionCode
            : SCAN_REFUSED,
      };
    }

    if (placement?.state === FileAssetPlacementState.ACTIVE) {
      return { status: RosterImportStatus.IMPORTED, reason: null };
    }

    if (AWAITING_SCANNER.has(asset.state)) {
      return { status: RosterImportStatus.SCANNING, reason: null };
    }

    if (
      CLEARED.has(asset.state) &&
      placement?.state === FileAssetPlacementState.PENDING
    ) {
      return { status: RosterImportStatus.PUBLISHING, reason: null };
    }

    // Nothing writes any other combination today: a cleared file with no
    // placement to publish into, bytes deleted from under a pending import,
    // a placement superseded. Whatever it is, nothing will move
    // it on, which is what ABANDONED says; and it is logged, because it means
    // something upstream did what this was never told it could.
    this._logger.warn(
      `[derive] Roster import in an unexpected state - ImportId: ` +
        `${record.id}, AssetState: ${asset.state}, PlacementState: ` +
        `${placement?.state ?? 'none'}`,
    );

    return { status: RosterImportStatus.ABANDONED, reason: null };
  }
}
