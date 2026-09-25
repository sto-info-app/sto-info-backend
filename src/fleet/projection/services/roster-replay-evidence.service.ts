import { Injectable } from '@nestjs/common';

import { EntityManager, In, IsNull, Not } from 'typeorm';

import { FileAssetPlacementEntity } from 'src/file-assets/entities/file-asset-placement.entity';
import { FileAssetPlacementState } from 'src/file-assets/enums/file-asset-placement-state.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';

import { RosterImportConflictEntity } from '../../imports/entities/roster-import-conflict.entity';
import { RosterImportSourceEntity } from '../../imports/entities/roster-import-source.entity';
import { RosterObservationEntity } from '../../imports/entities/roster-observation.entity';
import { RosterProjectionInputOutcome } from '../enums/roster-projection-input-outcome.enum';
import {
  ClassifiedRosterInput,
  classifyRosterInputs,
} from '../utilities/roster-input-classifier';

/** One row of an effective export, as the replay reads it. */
export type RosterEvidenceRow = Pick<
  RosterObservationEntity,
  | 'line'
  | 'characterName'
  | 'characterNameNormalised'
  | 'accountHandle'
  | 'accountHandleNormalised'
  | 'level'
  | 'className'
  | 'guildRank'
  | 'contributionTotal'
  | 'joinedAt'
  | 'joinedAtAmbiguous'
  | 'rankChangedAt'
  | 'rankChangedAtAmbiguous'
  | 'excluded'
>;

/** One effective export and every row of it, excluded ones included. */
export interface RosterEvidenceSnapshot {
  /** The import. */
  readonly importId: string;
  /** The instant its export claims. */
  readonly exportedAt: Date;
  /** Whether an investigator marked it partial. */
  readonly partial: boolean;
  /** Its rows, in line order, each saying whether it was excluded. */
  readonly rows: readonly RosterEvidenceRow[];
}

/** Everything a replay is built from. */
export interface RosterReplayEvidence {
  /** Every import in force or held, and what the replay makes of it. */
  readonly inputs: readonly ClassifiedRosterInput[];
  /** The effective exports, in export order. */
  readonly snapshots: readonly RosterEvidenceSnapshot[];
}

/** The columns an observation is read with. Nothing the replay ignores. */
const ROW_COLUMNS: Record<keyof RosterEvidenceRow, true> = {
  line: true,
  characterName: true,
  characterNameNormalised: true,
  accountHandle: true,
  accountHandleNormalised: true,
  level: true,
  className: true,
  guildRank: true,
  contributionTotal: true,
  joinedAt: true,
  joinedAtAmbiguous: true,
  rankChangedAt: true,
  rankChangedAtAmbiguous: true,
  excluded: true,
};

/**
 * Reads what a Fleet's roster replay is built from (FC-019).
 *
 * Every import with an export instant whose placement is in force or held is
 * a candidate, and {@link classifyRosterInputs} decides which of each moment
 * is read. Only those are read row by row. Everything is read through the
 * replay's own transaction, so what is classified and what is read are the
 * same state of the Fleet.
 *
 * Nothing a row said beyond what the replay uses is read: no Last Active, no
 * status and no public comment.
 */
@Injectable()
export class RosterReplayEvidenceService {
  /**
   * Reads a Fleet's evidence.
   *
   * @param manager - The replay's transaction.
   * @param fleetId - The Fleet.
   * @returns Every candidate import with its outcome, and the effective
   *   exports with their rows.
   */
  async read(
    manager: EntityManager,
    fleetId: string,
  ): Promise<RosterReplayEvidence> {
    const imports = await manager.find(RosterImportSourceEntity, {
      where: { fleetId, exportedAt: Not(IsNull()) },
      select: {
        id: true,
        exportedAt: true,
        uploadedAt: true,
        sanitisedSha256: true,
        excluded: true,
        partial: true,
        conflictGroupId: true,
      },
    });

    if (imports.length === 0) {
      return { inputs: [], snapshots: [] };
    }

    const ids = imports.map(record => record.id);
    const placements = await manager.find(FileAssetPlacementEntity, {
      where: {
        subject: FileAssetSubject.ROSTER_IMPORT,
        subjectId: In(ids),
        state: In([
          FileAssetPlacementState.ACTIVE,
          FileAssetPlacementState.HELD,
        ]),
      },
      select: { subjectId: true, state: true },
    });
    const stateOf = new Map(
      placements.map(placement => [placement.subjectId, placement.state]),
    );

    const excludedRows = new Map<string, number>();

    for (const excluded of await manager.find(RosterObservationEntity, {
      where: { fleetId, excluded: true },
      select: { importSourceId: true },
    })) {
      excludedRows.set(
        excluded.importSourceId,
        (excludedRows.get(excluded.importSourceId) ?? 0) + 1,
      );
    }

    const groupIds = [
      ...new Set(
        imports
          .map(record => record.conflictGroupId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const selections = new Map(
      (groupIds.length === 0
        ? []
        : await manager.find(RosterImportConflictEntity, {
            where: { id: In(groupIds) },
            select: { id: true, selectedImportId: true },
          })
      ).map(group => [group.id, group.selectedImportId]),
    );

    const inputs = classifyRosterInputs(
      imports
        .filter(record => stateOf.has(record.id))
        .map(record => ({
          id: record.id,
          exportedAt: record.exportedAt!,
          uploadedAt: record.uploadedAt,
          sanitisedSha256: record.sanitisedSha256,
          inForce: stateOf.get(record.id) === FileAssetPlacementState.ACTIVE,
          excluded: record.excluded,
          partial: record.partial,
          excludedRows: excludedRows.get(record.id) ?? 0,
          conflictGroupId: record.conflictGroupId,
        })),
      selections,
    );

    const snapshots: RosterEvidenceSnapshot[] = [];

    for (const input of inputs) {
      if (input.outcome !== RosterProjectionInputOutcome.EFFECTIVE) {
        continue;
      }

      snapshots.push({
        importId: input.id,
        exportedAt: input.exportedAt,
        partial: input.partial,
        rows: await manager.find(RosterObservationEntity, {
          where: { importSourceId: input.id },
          select: ROW_COLUMNS,
          order: { line: 'ASC' },
        }),
      });
    }

    return { inputs, snapshots };
  }
}
