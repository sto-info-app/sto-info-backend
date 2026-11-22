import { EntityManager, FindOptionsWhere, IsNull } from 'typeorm';

import { ScopeCapabilityGrantEntity } from '../../entities/scope-capability-grant.entity';
import { ScopeRoleAssignmentEntity } from '../../entities/scope-role-assignment.entity';
import { ScopeGovernanceActionEntity } from '../entities/scope-governance-action.entity';
import { ScopeGovernanceActionKind } from '../enums/scope-governance-action-kind.enum';

/** What a bulk ending ends. Either may be left out. */
export interface GovernanceEndings {
  readonly roles?: FindOptionsWhere<ScopeRoleAssignmentEntity>;
  readonly grants?: FindOptionsWhere<ScopeCapabilityGrantEntity>;
}

/**
 * Ends roles and capability grants in bulk, and logs each one (FC-039).
 *
 * A closure, a departure or a hand-over ends whatever somebody held; its own
 * governance entry says who did that and why. Each role and grant it ends
 * gets an entry of its own too, made by nobody — the system, as a
 * consequence — with a reason naming the cause, so the history shows every
 * role that went and why without anybody having to infer it. Each entry is
 * keyed by the row it ended, which ends once, so a retry writes none twice.
 *
 * @param manager - The transaction making the change.
 * @param endings - What ends.
 * @param reason - Why, naming the cause.
 * @param now - When.
 * @returns How many roles and grants ended.
 */
export async function endAndLog(
  manager: EntityManager,
  endings: GovernanceEndings,
  reason: string,
  now: Date,
): Promise<{ roles: number; grants: number }> {
  const roles =
    endings.roles === undefined
      ? []
      : await manager.find(ScopeRoleAssignmentEntity, {
          where: { ...endings.roles, validTo: IsNull() },
        });
  const grants =
    endings.grants === undefined
      ? []
      : await manager.find(ScopeCapabilityGrantEntity, {
          where: { ...endings.grants, validTo: IsNull() },
        });

  for (const role of roles) {
    await manager.update(
      ScopeRoleAssignmentEntity,
      { id: role.id },
      { validTo: now },
    );
    await manager.insert(ScopeGovernanceActionEntity, {
      communityId: role.communityId,
      fleetId: role.fleetId,
      armadaId: role.armadaId,
      action: ScopeGovernanceActionKind.ROLE_WITHDRAWN,
      actorUserId: null,
      subjectUserId: role.userId,
      role: role.role,
      reason,
      idempotencyKey: `ENDED:${role.id}`,
    });
  }

  for (const grant of grants) {
    await manager.update(
      ScopeCapabilityGrantEntity,
      { id: grant.id },
      { validTo: now },
    );
    await manager.insert(ScopeGovernanceActionEntity, {
      communityId: grant.communityId,
      fleetId: grant.fleetId,
      armadaId: grant.armadaId,
      action: ScopeGovernanceActionKind.CAPABILITY_CLEARED,
      actorUserId: null,
      subjectUserId: grant.subjectUserId,
      role: grant.subjectRole,
      capability: grant.capability,
      clearedEffect: grant.effect,
      reason,
      idempotencyKey: `ENDED:${grant.id}`,
    });
  }

  return { roles: roles.length, grants: grants.length };
}
