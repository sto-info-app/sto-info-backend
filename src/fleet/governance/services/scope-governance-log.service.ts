import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager, IsNull } from 'typeorm';

import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { ScopeCapabilityEffect } from '../../enums/scope-capability-effect.enum';
import { usernamesFor } from '../../recruitment/utilities/recruitment-names.utility';
import { ScopeGovernanceActionDto } from '../dto/scope-governance.dto';
import { ScopeGovernanceActionEntity } from '../entities/scope-governance-action.entity';
import { ScopeGovernanceActionKind } from '../enums/scope-governance-action-kind.enum';
import { GovernanceScope } from '../utilities/governance-scope.utility';

/** The most history the Manage pages are shown. */
export const GOVERNANCE_HISTORY_LIMIT = 50;

/** One change to record. */
export interface GovernanceEntry {
  /** Where. */
  readonly scope: GovernanceScope;
  /** What. */
  readonly action: ScopeGovernanceActionKind;
  /** Who made it. */
  readonly actorUserId: string;
  /** Whether a site administrator made it in a dispute. */
  readonly asSiteAdmin?: boolean;
  /** Who it was about. */
  readonly subjectUserId?: string | null;
  /** The role label. */
  readonly role?: FleetScopeRole | null;
  /** The capability. */
  readonly capability?: string | null;
  /** For a clearing, what was cleared. */
  readonly clearedEffect?: ScopeCapabilityEffect | null;
  /** Why. */
  readonly reason?: string | null;
  /** The ownership offer. */
  readonly transferId?: string | null;
}

/**
 * Writes and reads the governance history of a Community or Fleet (FC-022).
 *
 * Every change is written in the transaction that makes it, so a change
 * without its record, or a record without its change, cannot be committed.
 */
@Injectable()
export class ScopeGovernanceLogService {
  /**
   * Creates an instance of ScopeGovernanceLogService.
   *
   * @param _dataSource - The database.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
  ) {}

  /**
   * Records one change, in the caller's transaction.
   *
   * @param manager - The transaction making the change.
   * @param entry - The change.
   */
  async record(manager: EntityManager, entry: GovernanceEntry): Promise<void> {
    await manager.save(
      ScopeGovernanceActionEntity,
      manager.create(ScopeGovernanceActionEntity, {
        communityId: entry.scope.communityId,
        fleetId: entry.scope.fleetId,
        armadaId: entry.scope.armadaId,
        action: entry.action,
        actorUserId: entry.actorUserId,
        asSiteAdmin: entry.asSiteAdmin ?? false,
        subjectUserId: entry.subjectUserId ?? null,
        role: entry.role ?? null,
        capability: entry.capability ?? null,
        clearedEffect: entry.clearedEffect ?? null,
        reason: entry.reason ?? null,
        transferId: entry.transferId ?? null,
      }),
    );
  }

  /**
   * Reads a scope's recent history, newest first.
   *
   * A Community's history is its own changes, not its Fleets' or Armadas';
   * each of those shows its own.
   *
   * @param scope - The scope.
   * @returns Up to {@link GOVERNANCE_HISTORY_LIMIT} entries.
   */
  async list(scope: GovernanceScope): Promise<ScopeGovernanceActionDto[]> {
    const manager = this._dataSource.manager;
    const rows = await manager.find(ScopeGovernanceActionEntity, {
      where: {
        communityId: scope.communityId,
        fleetId: scope.fleetId ?? IsNull(),
        armadaId: scope.armadaId ?? IsNull(),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: GOVERNANCE_HISTORY_LIMIT,
    });
    const names = await usernamesFor(
      manager,
      rows.flatMap(row => [row.actorUserId, row.subjectUserId]),
    );

    return rows.map(row => ({
      id: row.id,
      action: row.action,
      actorName:
        row.actorUserId === null ? null : (names.get(row.actorUserId) ?? null),
      asSiteAdmin: row.asSiteAdmin,
      subjectName:
        row.subjectUserId === null
          ? null
          : (names.get(row.subjectUserId) ?? null),
      role: row.role,
      capability: row.capability,
      clearedEffect: row.clearedEffect,
      reason: row.reason,
      createdAt: row.createdAt,
    }));
  }
}
