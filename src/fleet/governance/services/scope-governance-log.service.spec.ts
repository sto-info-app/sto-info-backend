import { DataSource, EntityManager, IsNull } from 'typeorm';

import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { insertRecorder } from '../../../../test/insert-recorder';
import { ActivityType } from '../../activity/enums/activity.enums';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { ScopeCapabilityEffect } from '../../enums/scope-capability-effect.enum';
import { ScopeGovernanceActionEntity } from '../entities/scope-governance-action.entity';
import { ScopeGovernanceActionKind } from '../enums/scope-governance-action-kind.enum';
import {
  armadaScope,
  communityScope,
  fleetScope,
} from '../utilities/governance-scope.utility';
import {
  GOVERNANCE_HISTORY_LIMIT,
  ScopeGovernanceLogService,
} from './scope-governance-log.service';

const COMMUNITY_ID = '21000000-0000-4000-8000-000000000001';
const FLEET_ID = '21000000-0000-4000-8000-000000000002';
const OWNER_ID = '21000000-0000-4000-8000-000000000003';
const MEMBER_ID = '21000000-0000-4000-8000-000000000004';

describe('ScopeGovernanceLogService', () => {
  let manager: {
    find: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let activity: ReturnType<typeof insertRecorder>;
  let rows: Partial<ScopeGovernanceActionEntity>[];
  let service: ScopeGovernanceLogService;

  beforeEach(() => {
    rows = [];
    activity = insertRecorder();
    manager = {
      createQueryBuilder: activity.createQueryBuilder,
      find: jest.fn((entity: unknown) =>
        Promise.resolve(
          entity === UserProfileEntity
            ? [{ userId: OWNER_ID, username: 'MidNiteShadow' }]
            : rows,
        ),
      ),
      save: jest.fn((_entity: unknown, row: object) =>
        Promise.resolve({ id: 'action-1', ...row }),
      ),
      create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
    };
    service = new ScopeGovernanceLogService({
      manager,
    } as unknown as DataSource);
  });

  it('records a change in the caller’s transaction, filling what was not said', async () => {
    await service.record(manager as unknown as EntityManager, {
      scope: fleetScope(COMMUNITY_ID, FLEET_ID),
      action: ScopeGovernanceActionKind.ROLE_ASSIGNED,
      actorUserId: OWNER_ID,
      subjectUserId: MEMBER_ID,
      role: FleetScopeRole.OFFICER,
    });

    expect(manager.save).toHaveBeenCalledWith(ScopeGovernanceActionEntity, {
      communityId: COMMUNITY_ID,
      fleetId: FLEET_ID,
      armadaId: null,
      action: ScopeGovernanceActionKind.ROLE_ASSIGNED,
      actorUserId: OWNER_ID,
      asSiteAdmin: false,
      subjectUserId: MEMBER_ID,
      role: FleetScopeRole.OFFICER,
      capability: null,
      clearedEffect: null,
      reason: null,
      transferId: null,
    });
    expect(activity.recorded()).toEqual([
      expect.objectContaining({
        communityId: COMMUNITY_ID,
        fleetId: FLEET_ID,
        armadaId: null,
        type: ActivityType.ROLE_APPOINTED,
        actorUserId: OWNER_ID,
        subjectUserId: MEMBER_ID,
        sourceId: 'action-1',
        detail: { role: FleetScopeRole.OFFICER },
        idempotencyKey: 'ROLE_APPOINTED:action-1',
      }),
    ]);
  });

  it('keeps grants and offers off the activity feed', async () => {
    await service.record(manager as unknown as EntityManager, {
      scope: communityScope(COMMUNITY_ID),
      action: ScopeGovernanceActionKind.OWNERSHIP_OFFERED,
      actorUserId: OWNER_ID,
      subjectUserId: MEMBER_ID,
    });

    expect(activity.recorded()).toEqual([]);
  });

  it.each([
    [ScopeGovernanceActionKind.OWNERSHIP_ACCEPTED, MEMBER_ID, OWNER_ID],
    [ScopeGovernanceActionKind.OWNERSHIP_REASSIGNED, OWNER_ID, MEMBER_ID],
  ])(
    'names the new owner of a %s Community',
    async (action, actorUserId, subjectUserId) => {
      await service.record(manager as unknown as EntityManager, {
        scope: communityScope(COMMUNITY_ID),
        action,
        actorUserId,
        subjectUserId,
      });

      expect(activity.recorded()).toEqual([
        expect.objectContaining({
          type: ActivityType.OWNERSHIP_TRANSFERRED,
          subjectUserId: MEMBER_ID,
        }),
      ]);
    },
  );

  it('puts a closure on the feed, with nobody as its subject', async () => {
    await service.record(manager as unknown as EntityManager, {
      scope: armadaScope(COMMUNITY_ID, FLEET_ID),
      action: ScopeGovernanceActionKind.CLOSED,
      actorUserId: OWNER_ID,
      reason: 'Winding down',
    });

    expect(activity.recorded()).toEqual([
      expect.objectContaining({
        armadaId: FLEET_ID,
        type: ActivityType.SCOPE_CLOSED,
        subjectUserId: null,
        detail: null,
      }),
    ]);
  });

  it('keeps everything a change says about itself', async () => {
    await service.record(manager as unknown as EntityManager, {
      scope: communityScope(COMMUNITY_ID),
      action: ScopeGovernanceActionKind.CAPABILITY_CLEARED,
      actorUserId: OWNER_ID,
      asSiteAdmin: false,
      capability: 'news.write',
      clearedEffect: ScopeCapabilityEffect.GRANT,
      reason: 'Posting went quiet',
      transferId: null,
    });

    expect(manager.save).toHaveBeenCalledWith(
      ScopeGovernanceActionEntity,
      expect.objectContaining({
        fleetId: null,
        capability: 'news.write',
        clearedEffect: ScopeCapabilityEffect.GRANT,
        reason: 'Posting went quiet',
      }),
    );
  });

  // A Community's history is its own; each Fleet and Armada keeps its own.
  it.each([
    ['a Community', communityScope(COMMUNITY_ID), IsNull(), IsNull()],
    ['a Fleet', fleetScope(COMMUNITY_ID, FLEET_ID), FLEET_ID, IsNull()],
    ['an Armada', armadaScope(COMMUNITY_ID, FLEET_ID), IsNull(), FLEET_ID],
  ])(
    'reads %s’s own history, newest first',
    async (_label, scope, fleetId, armadaId) => {
      await service.list(scope);

      expect(manager.find).toHaveBeenCalledWith(ScopeGovernanceActionEntity, {
        where: { communityId: COMMUNITY_ID, fleetId, armadaId },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: GOVERNANCE_HISTORY_LIMIT,
      });
    },
  );

  it('names people by username, and nobody it cannot name or has gone', async () => {
    const at = new Date('2026-09-27T10:00:00.000Z');
    rows = [
      {
        id: 'a1',
        action: ScopeGovernanceActionKind.ROLE_WITHDRAWN,
        actorUserId: OWNER_ID,
        asSiteAdmin: false,
        subjectUserId: MEMBER_ID,
        role: FleetScopeRole.ADMIN,
        capability: null,
        clearedEffect: null,
        reason: 'Stepped down',
        createdAt: at,
      },
      {
        id: 'a2',
        action: ScopeGovernanceActionKind.CLOSED,
        actorUserId: MEMBER_ID,
        asSiteAdmin: true,
        subjectUserId: null,
        role: null,
        capability: null,
        clearedEffect: null,
        reason: 'Reported',
        createdAt: at,
      },
      {
        id: 'a3',
        action: ScopeGovernanceActionKind.OWNERSHIP_DECLINED,
        actorUserId: null,
        asSiteAdmin: false,
        subjectUserId: OWNER_ID,
        role: null,
        capability: null,
        clearedEffect: null,
        reason: null,
        createdAt: at,
      },
    ];

    await expect(service.list(communityScope(COMMUNITY_ID))).resolves.toEqual([
      {
        id: 'a1',
        action: ScopeGovernanceActionKind.ROLE_WITHDRAWN,
        actorName: 'MidNiteShadow',
        asSiteAdmin: false,
        subjectName: null,
        role: FleetScopeRole.ADMIN,
        capability: null,
        clearedEffect: null,
        reason: 'Stepped down',
        createdAt: at,
      },
      {
        id: 'a2',
        action: ScopeGovernanceActionKind.CLOSED,
        actorName: null,
        asSiteAdmin: true,
        subjectName: null,
        role: null,
        capability: null,
        clearedEffect: null,
        reason: 'Reported',
        createdAt: at,
      },
      {
        id: 'a3',
        action: ScopeGovernanceActionKind.OWNERSHIP_DECLINED,
        actorName: null,
        asSiteAdmin: false,
        subjectName: 'MidNiteShadow',
        role: null,
        capability: null,
        clearedEffect: null,
        reason: null,
        createdAt: at,
      },
    ]);
  });
});
