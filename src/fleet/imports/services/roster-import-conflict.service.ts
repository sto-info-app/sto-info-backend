import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { EntityManager, In, IsNull, Not, Repository } from 'typeorm';

import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';

import { RosterImportConflictEntity } from '../entities/roster-import-conflict.entity';
import { RosterImportSourceEntity } from '../entities/roster-import-source.entity';

/**
 * Notices when two exports of one Fleet claim the same moment and disagree,
 * and says which of them has to wait.
 *
 * ## Grouping
 *
 * Done at upload, inside the transaction that records the import, so an
 * import is never recorded without its group. Two uploads claiming the same
 * instant at the same time are serialised by a transaction-scoped advisory
 * lock on the Fleet and the instant: whichever takes the lock second finds
 * the first already committed, so every disagreement is seen by one of the
 * two however they interleave.
 *
 * An import the scanner or the reader refused is left out. It can never be
 * in force, so it cannot disagree with anything that is, and counting it
 * would hold a genuine export behind a file nobody will ever read.
 *
 * ## Holding
 *
 * The first version of a moment the site saw stays in force; an import
 * saying something different waits until the group is resolved. "First" is
 * the earliest upload in the group that has not been refused, and an import
 * saying the same as it is not held, because it is not different.
 *
 * That is decided when the file is published rather than when it is
 * grouped, because a scan takes time and the first upload may be refused in
 * the meantime.
 */
@Injectable()
export class RosterImportConflictService {
  private readonly _logger = new Logger(RosterImportConflictService.name);

  /**
   * Creates an instance of RosterImportConflictService.
   *
   * @param _conflicts - Repository of conflict groups.
   * @param _imports - Repository of roster imports.
   */
  constructor(
    @InjectRepository(RosterImportConflictEntity)
    private readonly _conflicts: Repository<RosterImportConflictEntity>,
    @InjectRepository(RosterImportSourceEntity)
    private readonly _imports: Repository<RosterImportSourceEntity>,
  ) {}

  /**
   * Puts a newly recorded import in a group with every other import of the
   * same Fleet and instant, when any of them says something different.
   *
   * @param manager - The transaction the import was recorded in.
   * @param record - The import, already inserted in that transaction.
   * @param exportedAt - The instant it claims.
   * @returns The group it is now in, or null when nothing disagrees.
   */
  async group(
    manager: EntityManager,
    record: RosterImportSourceEntity,
    exportedAt: Date,
  ): Promise<RosterImportConflictEntity | null> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `fleet-roster-export:${record.fleetId}:${exportedAt.toISOString()}`,
    ]);

    const imports = manager.getRepository(RosterImportSourceEntity);
    const conflicts = manager.getRepository(RosterImportConflictEntity);

    const others = (
      await imports.find({
        where: { fleetId: record.fleetId, exportedAt, id: Not(record.id) },
        relations: { asset: true },
      })
    ).filter(other => other.asset.state !== FileAssetState.REJECTED);

    if (
      !others.some(other => other.sanitisedSha256 !== record.sanitisedSha256)
    ) {
      return null;
    }

    const group =
      (await conflicts.findOne({
        where: { fleetId: record.fleetId, exportedAt, resolvedAt: IsNull() },
      })) ??
      (await conflicts.save(
        conflicts.create({ fleetId: record.fleetId, exportedAt }),
      ));

    await imports.update(
      { id: In([record.id, ...others.map(other => other.id)]) },
      { conflictGroupId: group.id },
    );

    this._logger.warn(
      `[group] Roster exports claim one instant and disagree - ` +
        `ConflictGroupId: ${group.id}, FleetId: ${record.fleetId}, ` +
        `ExportedAt: ${exportedAt.toISOString()}, ` +
        `Members: ${others.length + 1}`,
    );

    return group;
  }

  /**
   * Says whether an import has to wait for its group to be resolved.
   *
   * @param record - The import being published.
   * @returns True when it is in an open group and differs from the first
   *   version of the moment the site saw.
   */
  async isHeld(record: RosterImportSourceEntity): Promise<boolean> {
    if (record.conflictGroupId === null) {
      return false;
    }

    const group = await this._conflicts.findOne({
      where: { id: record.conflictGroupId, resolvedAt: IsNull() },
    });

    if (group === null) {
      return false;
    }

    const members = await this._imports.find({
      where: { conflictGroupId: group.id },
      relations: { asset: true },
      order: { uploadedAt: 'ASC', id: 'ASC' },
    });

    // The import being published is a member and has just been cleared, so
    // there is always at least one that was not refused.
    const first =
      members.find(member => member.asset.state !== FileAssetState.REJECTED) ??
      record;

    return first.sanitisedSha256 !== record.sanitisedSha256;
  }
}
