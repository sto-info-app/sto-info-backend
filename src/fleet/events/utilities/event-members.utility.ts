import { EntityManager, In, IsNull } from 'typeorm';

import { ArmadaFleetMembershipEntity } from '../../entities/armada-fleet-membership.entity';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import { GovernanceScope } from '../../governance/utilities/governance-scope.utility';

/**
 * The people a scope counts as its members, for recording attendance
 * (FC-030).
 *
 * Steve's decision of 28 September 2026: a Fleet's approved members; an
 * Armada's, those of the Fleets placed in it now; a Community's, those of
 * the Community itself and of every Fleet in it.
 *
 * @param manager - The manager to read through.
 * @param scope - The scope.
 * @returns Their user IDs, each once.
 */
export async function scopeMemberIds(
  manager: EntityManager,
  scope: GovernanceScope,
): Promise<string[]> {
  const approved = {
    communityId: scope.communityId,
    status: ScopeMembershipStatus.APPROVED,
    deletedAt: IsNull(),
  };
  let memberships: ScopeMembershipEntity[];

  if (scope.kind === FleetScopeKind.FLEET) {
    memberships = await manager.find(ScopeMembershipEntity, {
      where: { ...approved, fleetId: scope.fleetId as string },
    });
  } else if (scope.kind === FleetScopeKind.ARMADA) {
    const placements = await manager.find(ArmadaFleetMembershipEntity, {
      where: { armadaId: scope.armadaId as string, validTo: IsNull() },
    });

    memberships =
      placements.length === 0
        ? []
        : await manager.find(ScopeMembershipEntity, {
            where: {
              ...approved,
              fleetId: In(placements.map(placement => placement.fleetId)),
            },
          });
  } else {
    memberships = await manager.find(ScopeMembershipEntity, {
      where: approved,
    });
  }

  return [...new Set(memberships.map(membership => membership.userId))];
}
