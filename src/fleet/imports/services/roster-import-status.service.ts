import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { FindOptionsRelations, Not, Repository } from 'typeorm';

import { FileAssetPlacementEntity } from 'src/file-assets/entities/file-asset-placement.entity';
import { FileAssetPlacementState } from 'src/file-assets/enums/file-asset-placement-state.enum';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { FileAssetPlacementService } from 'src/file-assets/services/file-asset-placement.service';

import {
  resolveDirectoryPage,
  resolveDirectoryPageSize,
} from '../../utilities/directory-query.utility';
import { RosterImportActionDto } from '../dto/roster-import-action.dto';
import { RosterImportDetailDto } from '../dto/roster-import-detail.dto';
import { RosterImportPageDto } from '../dto/roster-import-page.dto';
import { RosterImportSourceDto } from '../dto/roster-import-source.dto';
import { RosterImportActionEntity } from '../entities/roster-import-action.entity';
import { RosterImportConflictEntity } from '../entities/roster-import-conflict.entity';
import { RosterImportSourceEntity } from '../entities/roster-import-source.entity';
import { RosterObservationEntity } from '../entities/roster-observation.entity';
import { RosterCsvRejectionCode } from '../enums/roster-csv-rejection-code.enum';
import { RosterHoldReason } from '../enums/roster-hold-reason.enum';
import { RosterImportStatus } from '../enums/roster-import-status.enum';
import { RosterPublicationRejectionCode } from '../enums/roster-publication-rejection-code.enum';

/**
 * What a refusal is reported as when this feature did not make it.
 *
 * The scanner's own code is administrator-only (R24): naming what matched
 * tells somebody probing the scanner precisely what gets through.
 */
export const SCAN_REFUSED = 'SCAN_REFUSED';

/**
 * The refusals this feature made itself, which describe the file's structure
 * and may be named to whoever sent it.
 *
 * An allow-list rather than a deny-list, so a code added anywhere else in the
 * asset pipeline is hidden until somebody decides otherwise.
 */
const NAMEABLE_REFUSALS: ReadonlySet<string> = new Set<string>([
  RosterCsvRejectionCode.ROWS_UNREADABLE,
  ...Object.values(RosterPublicationRejectionCode),
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
    // a placement superseded or withdrawn. Whatever it is, nothing will move
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
