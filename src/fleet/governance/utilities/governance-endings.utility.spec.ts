import { beforeEach, describe, expect, it } from '@jest/globals';

import { InMemoryManager } from '../../../../test/in-memory-manager';
import { ScopeCapabilityGrantEntity } from '../../entities/scope-capability-grant.entity';
import { ScopeRoleAssignmentEntity } from '../../entities/scope-role-assignment.entity';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { ScopeGovernanceActionEntity } from '../entities/scope-governance-action.entity';
import { ScopeGovernanceActionKind } from '../enums/scope-governance-action-kind.enum';
import { endAndLog } from './governance-endings.utility';

const COMMUNITY_ID = 'community-1';
const FLEET_ID = 'fleet-1';
const REASON = 'Ended when it was closed.';

describe('endAndLog (FC-039)', () => {
  let db: InMemoryManager;
  const now = new Date('2026-09-29T12:00:00Z');
  const earlier = new Date('2026-09-01T12:00:00Z');

  beforeEach(() => {
    db = new InMemoryManager();
    db.seed(ScopeRoleAssignmentEntity, [
      {
        id: 'role-1',
        communityId: COMMUNITY_ID,
        fleetId: FLEET_ID,
        armadaId: null,
        userId: 'member-1',
        role: FleetScopeRole.OFFICER,
        validTo: null,
      },
      // Ended already: its own entry said so then.
      {
        id: 'role-2',
        communityId: COMMUNITY_ID,
        fleetId: FLEET_ID,
        armadaId: null,
        userId: 'member-2',
        role: FleetScopeRole.ADMIN,
        validTo: earlier,
      },
      // Elsewhere.
      {
        id: 'role-3',
        communityId: COMMUNITY_ID,
        fleetId: 'fleet-2',
        armadaId: null,
        userId: 'member-1',
        role: FleetScopeRole.OFFICER,
        validTo: null,
      },
    ]);
    db.seed(ScopeCapabilityGrantEntity, [
      {
        id: 'grant-1',
        communityId: COMMUNITY_ID,
        fleetId: FLEET_ID,
        armadaId: null,
        subjectUserId: 'member-1',
        subjectRole: null,
        capability: 'news.write',
        effect: 'DENY',
        validTo: null,
      },
    ]);
  });

  it('ends each open role and grant, and logs each by the system, keyed by the row', async () => {
    await expect(
      endAndLog(
        db.asManager(),
        { roles: { fleetId: FLEET_ID }, grants: { fleetId: FLEET_ID } },
        REASON,
        now,
      ),
    ).resolves.toEqual({ roles: 1, grants: 1 });

    expect(
      db
        .rows(ScopeRoleAssignmentEntity)
        .map(row => [row.id, row.validTo] as const),
    ).toEqual([
      ['role-1', now],
      ['role-2', earlier],
      ['role-3', null],
    ]);
    expect(db.rows(ScopeCapabilityGrantEntity)[0].validTo).toBe(now);
    expect(db.rows(ScopeGovernanceActionEntity)).toEqual([
      expect.objectContaining({
        communityId: COMMUNITY_ID,
        fleetId: FLEET_ID,
        armadaId: null,
        action: ScopeGovernanceActionKind.ROLE_WITHDRAWN,
        actorUserId: null,
        subjectUserId: 'member-1',
        role: FleetScopeRole.OFFICER,
        reason: REASON,
        idempotencyKey: 'ENDED:role-1',
      }),
      expect.objectContaining({
        action: ScopeGovernanceActionKind.CAPABILITY_CLEARED,
        actorUserId: null,
        subjectUserId: 'member-1',
        role: null,
        capability: 'news.write',
        clearedEffect: 'DENY',
        reason: REASON,
        idempotencyKey: 'ENDED:grant-1',
      }),
    ]);
  });

  it('ends only what it is asked to, and nothing a second time', async () => {
    await endAndLog(
      db.asManager(),
      { roles: { fleetId: FLEET_ID } },
      REASON,
      now,
    );

    await expect(
      endAndLog(db.asManager(), { roles: { fleetId: FLEET_ID } }, REASON, now),
    ).resolves.toEqual({ roles: 0, grants: 0 });
    expect(db.rows(ScopeCapabilityGrantEntity)[0].validTo).toBeNull();
    expect(
      db.rows(ScopeGovernanceActionEntity).map(row => row.idempotencyKey),
    ).toEqual(['ENDED:role-1']);
  });

  it('ends grants alone, leaving every role', async () => {
    await expect(
      endAndLog(
        db.asManager(),
        { grants: { subjectUserId: 'member-1' } },
        REASON,
        now,
      ),
    ).resolves.toEqual({ roles: 0, grants: 1 });
    expect(
      db.rows(ScopeRoleAssignmentEntity).filter(row => row.validTo === now),
    ).toEqual([]);
  });
});
