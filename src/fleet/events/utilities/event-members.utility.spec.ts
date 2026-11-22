import { beforeEach, describe, expect, it } from '@jest/globals';

import { InMemoryManager } from '../../../../test/in-memory-manager';
import { ArmadaFleetMembershipEntity } from '../../entities/armada-fleet-membership.entity';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import {
  armadaScope,
  communityScope,
  fleetScope,
} from '../../governance/utilities/governance-scope.utility';
import { scopeMemberIds } from './event-members.utility';

const COMMUNITY_ID = 'community-1';

describe('scopeMemberIds', () => {
  let db: InMemoryManager;

  /**
   * A membership.
   *
   * @param userId - Whose.
   * @param fleetId - Of which Fleet, or null for the Community's own.
   * @param overrides - What else differs.
   * @returns The row.
   */
  const membership = (
    userId: string,
    fleetId: string | null,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    communityId: COMMUNITY_ID,
    fleetId,
    userId,
    status: ScopeMembershipStatus.APPROVED,
    deletedAt: null,
    ...overrides,
  });

  beforeEach(() => {
    db = new InMemoryManager().seed(ScopeMembershipEntity, [
      membership('in-fleet-a', 'fleet-a'),
      membership('in-fleet-b', 'fleet-b'),
      membership('in-community', null),
      membership('in-both', 'fleet-a'),
      membership('in-both', 'fleet-b'),
      membership('pending', 'fleet-a', {
        status: ScopeMembershipStatus.PENDING,
      }),
      membership('gone', 'fleet-a', { deletedAt: new Date() }),
      membership('elsewhere', 'fleet-a', { communityId: 'community-2' }),
    ]);
  });

  it('counts a Fleet’s approved members', async () => {
    await expect(
      scopeMemberIds(db.asManager(), fleetScope(COMMUNITY_ID, 'fleet-a')),
    ).resolves.toEqual(['in-fleet-a', 'in-both']);
  });

  it('counts the members of the Fleets placed in an Armada now, once each', async () => {
    db.seed(ArmadaFleetMembershipEntity, [
      { armadaId: 'armada-1', fleetId: 'fleet-a', validTo: null },
      { armadaId: 'armada-1', fleetId: 'fleet-b', validTo: null },
      { armadaId: 'armada-1', fleetId: 'fleet-c', validTo: new Date() },
    ]);

    await expect(
      scopeMemberIds(db.asManager(), armadaScope(COMMUNITY_ID, 'armada-1')),
    ).resolves.toEqual(['in-fleet-a', 'in-fleet-b', 'in-both']);
  });

  it('counts nobody for an Armada with no Fleet placed', async () => {
    await expect(
      scopeMemberIds(db.asManager(), armadaScope(COMMUNITY_ID, 'armada-1')),
    ).resolves.toEqual([]);
  });

  it('counts a Community’s own members and its Fleets’', async () => {
    await expect(
      scopeMemberIds(db.asManager(), communityScope(COMMUNITY_ID)),
    ).resolves.toEqual(['in-fleet-a', 'in-fleet-b', 'in-community', 'in-both']);
  });
});
