import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { DataSource, EntityManager } from 'typeorm';

import { NotificationSeverity } from 'src/notification/enums/notification-severity.enum';
import { NotificationTarget } from 'src/notification/enums/notification-target.enum';
import { NotificationService } from 'src/notification/notification.service';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { insertRecorder } from '../../../../test/insert-recorder';
import { ActivityType } from '../../activity/enums/activity.enums';
import { FleetAuthorisationRevisionService } from '../../authorisation/fleet-authorisation-revision.service';
import { ArmadaFleetMembershipEntity } from '../../entities/armada-fleet-membership.entity';
import { CharacterFleetMembershipEntity } from '../../entities/character-fleet-membership.entity';
import { ScopeCapabilityGrantEntity } from '../../entities/scope-capability-grant.entity';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { ScopeRoleAssignmentEntity } from '../../entities/scope-role-assignment.entity';
import { StoArmadaEntity } from '../../entities/sto-armada.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import { ScopeGovernanceActionKind } from '../../governance/enums/scope-governance-action-kind.enum';
import { CharacterFleetProposalService } from '../../services/character-fleet-proposal.service';
import { FleetApplicationEntity } from '../entities/fleet-application.entity';
import { ScopeMembershipActionEntity } from '../entities/scope-membership-action.entity';
import { FleetApplicationRoute } from '../enums/fleet-application-route.enum';
import { ScopeMembershipActionKind } from '../enums/scope-membership-action-kind.enum';
import {
  ENDED_BY_LEAVING,
  RecruitmentMembershipService,
} from './recruitment-membership.service';

const FLEET = {
  id: 'fleet-1',
  communityId: 'community-1',
} as StoFleetEntity;
const NOW = new Date('2026-09-26T12:00:00Z');

describe('RecruitmentMembershipService', () => {
  let membership: ScopeMembershipEntity | null;
  let recorded: boolean;
  let holdsRole: boolean;
  let manager: {
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    find: jest.Mock;
    exists: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    increment: jest.Mock;
    insert: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let activity: ReturnType<typeof insertRecorder>;
  /** Where the Fleet sits in an Armada, if anywhere (FC-025). */
  let placement: { armadaId: string; communityId: string } | null;
  let bump: jest.Mock;
  let raiseWithin: jest.Mock;
  let withdrawRecruitedWithin: jest.Mock;
  let createNotification: jest.Mock;
  let service: RecruitmentMembershipService;

  beforeEach(() => {
    membership = null;
    recorded = false;
    holdsRole = false;
    placement = null;
    activity = insertRecorder();
    manager = {
      createQueryBuilder: activity.createQueryBuilder,
      findOne: jest.fn((entity: unknown) =>
        Promise.resolve(
          entity === ArmadaFleetMembershipEntity ? placement : membership,
        ),
      ),
      findOneOrFail: jest.fn((entity: unknown) =>
        Promise.resolve(
          entity === StoFleetEntity
            ? { ...FLEET, exactGameName: 'Kell Fleet' }
            : { ...membership },
        ),
      ),
      find: jest.fn(() => Promise.resolve([])),
      exists: jest.fn((entity: unknown) =>
        Promise.resolve(
          entity === CharacterFleetMembershipEntity ? recorded : holdsRole,
        ),
      ),
      create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
      save: jest.fn((_entity: unknown, data: object) =>
        Promise.resolve({ id: 'membership-new', ...data }),
      ),
      update: jest.fn(() => Promise.resolve({})),
      increment: jest.fn(() => Promise.resolve()),
      insert: jest.fn(() => Promise.resolve()),
    };
    bump = jest.fn(() => Promise.resolve(2));
    raiseWithin = jest.fn(() => Promise.resolve({ id: 'proposal-1' }));
    withdrawRecruitedWithin = jest.fn(() => Promise.resolve());
    createNotification = jest.fn(() => Promise.resolve({}));
    const dataSource = {
      manager,
      transaction: jest.fn((work: (m: typeof manager) => Promise<unknown>) =>
        work(manager),
      ),
    };
    service = new RecruitmentMembershipService(
      dataSource as unknown as DataSource,
      { bump } as unknown as FleetAuthorisationRevisionService,
      {
        raiseWithin,
        withdrawRecruitedWithin,
      } as unknown as CharacterFleetProposalService,
      { createNotification } as unknown as NotificationService,
    );
  });

  const em = (): EntityManager => manager as unknown as EntityManager;

  /**
   * Builds a membership.
   *
   * @param status - Its status.
   * @returns The membership.
   */
  const member = (status: ScopeMembershipStatus): ScopeMembershipEntity =>
    ({
      id: 'membership-1',
      communityId: 'community-1',
      fleetId: 'fleet-1',
      userId: 'member-1',
      status,
    }) as ScopeMembershipEntity;

  /** The entities saved, in order. */
  const savedTo = (entity: unknown): object[] =>
    manager.save.mock.calls
      .filter(([target]) => target === entity)
      .map(([, data]) => data as object);

  describe('assertMayJoin', () => {
    it.each([null, ScopeMembershipStatus.LEFT, ScopeMembershipStatus.REVOKED])(
      'lets somebody in whose membership is %s',
      async status => {
        membership = status === null ? null : member(status);

        await expect(
          service.assertMayJoin(em(), 'fleet-1', 'member-1'),
        ).resolves.toBeUndefined();
      },
    );

    it('refuses a member', async () => {
      membership = member(ScopeMembershipStatus.APPROVED);

      await expect(
        service.assertMayJoin(em(), 'fleet-1', 'member-1'),
      ).rejects.toThrow(
        new ConflictException('Already a member of this Fleet.'),
      );
    });

    it('refuses somebody whose membership is suspended', async () => {
      membership = member(ScopeMembershipStatus.SUSPENDED);

      await expect(
        service.assertMayJoin(em(), 'fleet-1', 'member-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('grantWithin', () => {
    const grant = () =>
      service.grantWithin(em(), {
        fleet: FLEET,
        userId: 'member-1',
        characterId: 'character-1',
        applicationId: 'application-1',
        actorUserId: 'officer-1',
        now: NOW,
      });

    it('creates an approved membership, logs it and advertises the change', async () => {
      await grant();

      expect(savedTo(ScopeMembershipEntity)).toEqual([
        {
          communityId: 'community-1',
          fleetId: 'fleet-1',
          userId: 'member-1',
          status: ScopeMembershipStatus.APPROVED,
          requestedAt: NOW,
          decidedAt: NOW,
          decidedByUserId: 'officer-1',
        },
      ]);
      expect(savedTo(ScopeMembershipActionEntity)).toEqual([
        {
          membershipId: 'membership-new',
          action: ScopeMembershipActionKind.APPROVED,
          actorUserId: 'officer-1',
          applicationId: 'application-1',
        },
      ]);
      expect(activity.recorded()).toEqual([
        expect.objectContaining({
          communityId: 'community-1',
          fleetId: 'fleet-1',
          type: ActivityType.MEMBER_JOINED,
          actorUserId: 'officer-1',
          subjectUserId: 'member-1',
          sourceId: 'membership-new',
          idempotencyKey: 'MEMBER_JOINED:membership-new',
          occurredAt: NOW,
        }),
      ]);
      expect(bump).toHaveBeenCalledWith(FleetScopeKind.FLEET, 'fleet-1', em());
    });

    it('locks any membership the person had before', async () => {
      await grant();

      expect(manager.findOne).toHaveBeenCalledWith(ScopeMembershipEntity, {
        where: { fleetId: 'fleet-1', userId: 'member-1' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('brings back a member who left, clearing the old reason', async () => {
      membership = {
        ...member(ScopeMembershipStatus.REVOKED),
        decisionReason: 'Inactive',
      } as ScopeMembershipEntity;

      await grant();

      expect(savedTo(ScopeMembershipEntity)[0]).toEqual(
        expect.objectContaining({
          id: 'membership-1',
          status: ScopeMembershipStatus.APPROVED,
          decisionReason: null,
          decidedByUserId: 'officer-1',
        }),
      );
    });

    it('asks the member to confirm their Character’s Fleet', async () => {
      await grant();

      expect(raiseWithin).toHaveBeenCalledWith(
        em(),
        'character-1',
        {
          fleetId: 'fleet-1',
          proposedByUserId: 'officer-1',
          applicationId: 'application-1',
        },
        NOW,
      );
    });

    it('asks nothing when the Character already records this Fleet', async () => {
      recorded = true;

      await grant();

      expect(raiseWithin).not.toHaveBeenCalled();
    });

    it('refuses somebody already a member, before writing anything', async () => {
      membership = member(ScopeMembershipStatus.APPROVED);

      await expect(grant()).rejects.toBeInstanceOf(ConflictException);
      expect(manager.save).not.toHaveBeenCalled();
    });
  });

  describe('leave', () => {
    // FC-025: an Armada role is for its Fleets' members.
    it('ends the Armada roles its member no longer qualifies for', async () => {
      membership = member(ScopeMembershipStatus.APPROVED);
      placement = { armadaId: 'armada-1', communityId: 'community-1' };

      await service.leave('community-1', 'fleet-1', 'member-1');

      expect(manager.find).toHaveBeenCalledWith(
        ScopeRoleAssignmentEntity,
        expect.objectContaining({
          where: expect.objectContaining({ armadaId: 'armada-1' }),
        }),
      );
      expect(manager.increment).toHaveBeenCalledWith(
        StoArmadaEntity,
        { id: 'armada-1' },
        'revision',
        1,
      );
    });

    it('touches no Armada when the Fleet is in none', async () => {
      membership = member(ScopeMembershipStatus.APPROVED);
      await service.leave('community-1', 'fleet-1', 'member-1');

      expect(manager.increment).not.toHaveBeenCalled();
    });

    it('ends the membership as LEFT, drops any role and advertises it', async () => {
      membership = member(ScopeMembershipStatus.APPROVED);

      manager.find.mockImplementation((entity: unknown) =>
        Promise.resolve(
          entity === ScopeRoleAssignmentEntity
            ? [
                {
                  id: 'role-1',
                  communityId: 'community-1',
                  fleetId: 'fleet-1',
                  armadaId: null,
                  userId: 'member-1',
                  role: FleetScopeRole.OFFICER,
                },
              ]
            : entity === ScopeCapabilityGrantEntity
              ? [
                  {
                    id: 'grant-1',
                    communityId: 'community-1',
                    fleetId: 'fleet-1',
                    armadaId: null,
                    subjectUserId: 'member-1',
                    subjectRole: null,
                    capability: 'news.write',
                    effect: 'GRANT',
                  },
                ]
              : [],
        ),
      );

      await service.leave('community-1', 'fleet-1', 'member-1');

      expect(membership).toEqual(
        expect.objectContaining({
          status: ScopeMembershipStatus.LEFT,
          decidedByUserId: 'member-1',
          decisionReason: null,
        }),
      );
      expect(savedTo(ScopeMembershipActionEntity)).toEqual([
        {
          membershipId: 'membership-1',
          action: ScopeMembershipActionKind.LEFT,
          actorUserId: 'member-1',
          reason: null,
        },
      ]);
      expect(activity.recorded()).toEqual([
        expect.objectContaining({
          type: ActivityType.MEMBER_LEFT,
          actorUserId: 'member-1',
          subjectUserId: 'member-1',
          sourceId: 'membership-1',
          detail: null,
        }),
      ]);
      expect(manager.find).toHaveBeenCalledWith(ScopeRoleAssignmentEntity, {
        where: expect.objectContaining({
          fleetId: 'fleet-1',
          userId: 'member-1',
        }),
      });
      expect(manager.update).toHaveBeenCalledWith(
        ScopeRoleAssignmentEntity,
        { id: 'role-1' },
        { validTo: expect.any(Date) },
      );
      // A capability given to or taken from them here goes with them.
      expect(manager.find).toHaveBeenCalledWith(ScopeCapabilityGrantEntity, {
        where: expect.objectContaining({
          fleetId: 'fleet-1',
          subjectUserId: 'member-1',
        }),
      });
      expect(manager.update).toHaveBeenCalledWith(
        ScopeCapabilityGrantEntity,
        { id: 'grant-1' },
        { validTo: expect.any(Date) },
      );
      // FC-039: each is logged, by the system, naming the leaving.
      expect(manager.insert.mock.calls.map(([, row]) => row)).toEqual([
        expect.objectContaining({
          action: ScopeGovernanceActionKind.ROLE_WITHDRAWN,
          actorUserId: null,
          subjectUserId: 'member-1',
          reason: ENDED_BY_LEAVING,
          idempotencyKey: 'ENDED:role-1',
        }),
        expect.objectContaining({
          action: ScopeGovernanceActionKind.CAPABILITY_CLEARED,
          capability: 'news.write',
          reason: ENDED_BY_LEAVING,
          idempotencyKey: 'ENDED:grant-1',
        }),
      ]);
      expect(withdrawRecruitedWithin).toHaveBeenCalledWith(
        em(),
        'fleet-1',
        'member-1',
      );
      expect(bump).toHaveBeenCalledWith(FleetScopeKind.FLEET, 'fleet-1', em());
    });

    it.each([
      null,
      ScopeMembershipStatus.SUSPENDED,
      ScopeMembershipStatus.LEFT,
    ])('refuses somebody whose membership is %s', async status => {
      membership = status === null ? null : member(status);

      await expect(
        service.leave('community-1', 'fleet-1', 'member-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    const remove = () =>
      service.remove(
        'community-1',
        'fleet-1',
        'membership-1',
        '  Inactive for a year ',
        'officer-1',
      );

    it.each([ScopeMembershipStatus.APPROVED, ScopeMembershipStatus.SUSPENDED])(
      'revokes a %s membership with its reason',
      async status => {
        membership = member(status);

        await remove();

        expect(membership).toEqual(
          expect.objectContaining({
            status: ScopeMembershipStatus.REVOKED,
            decidedByUserId: 'officer-1',
            decisionReason: 'Inactive for a year',
          }),
        );
        expect(savedTo(ScopeMembershipActionEntity)).toEqual([
          expect.objectContaining({
            action: ScopeMembershipActionKind.REMOVED,
            reason: 'Inactive for a year',
          }),
        ]);
        // The reason stays in the log, off the feed.
        expect(activity.recorded()).toEqual([
          expect.objectContaining({
            type: ActivityType.MEMBER_REMOVED,
            actorUserId: 'officer-1',
            subjectUserId: 'member-1',
            detail: null,
          }),
        ]);
        // The question about their Character goes with the membership.
        expect(withdrawRecruitedWithin).toHaveBeenCalledWith(
          em(),
          'fleet-1',
          'member-1',
        );
      },
    );

    it.each([null, ScopeMembershipStatus.LEFT])(
      'refuses a membership that is %s',
      async status => {
        membership = status === null ? null : member(status);

        await expect(remove()).rejects.toBeInstanceOf(NotFoundException);
      },
    );

    it('sends somebody removing themselves to Leave', async () => {
      membership = {
        ...member(ScopeMembershipStatus.APPROVED),
        userId: 'officer-1',
      } as ScopeMembershipEntity;

      await expect(remove()).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to remove somebody holding a role at the Fleet', async () => {
      membership = member(ScopeMembershipStatus.APPROVED);
      holdsRole = true;

      await expect(remove()).rejects.toBeInstanceOf(ConflictException);
      expect(manager.save).not.toHaveBeenCalled();
    });
  });

  describe('suspend and reinstate (FC-036)', () => {
    const suspend = (actor = 'owner-1') =>
      service.suspend(
        'community-1',
        'fleet-1',
        'membership-1',
        '  Repeated spam  ',
        actor,
      );
    const reinstate = () =>
      service.reinstate(
        'community-1',
        'fleet-1',
        'membership-1',
        ' Sorted ',
        'owner-1',
      );

    it('refuses a membership that is not current, or not suspended', async () => {
      await expect(suspend()).rejects.toThrow(NotFoundException);

      membership = member(ScopeMembershipStatus.SUSPENDED);
      await expect(suspend()).rejects.toThrow(NotFoundException);

      membership = member(ScopeMembershipStatus.APPROVED);
      await expect(reinstate()).rejects.toThrow(NotFoundException);
    });

    it('refuses to suspend yourself, or somebody holding a role', async () => {
      membership = member(ScopeMembershipStatus.APPROVED);
      await expect(suspend('member-1')).rejects.toThrow(BadRequestException);

      holdsRole = true;
      await expect(suspend()).rejects.toThrow(ConflictException);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('suspends a member, logged with the reason, and tells them without it', async () => {
      membership = member(ScopeMembershipStatus.APPROVED);

      await suspend();

      expect(savedTo(ScopeMembershipEntity)).toEqual([
        expect.objectContaining({
          status: ScopeMembershipStatus.SUSPENDED,
          decidedByUserId: 'owner-1',
          decisionReason: 'Repeated spam',
        }),
      ]);
      expect(savedTo(ScopeMembershipActionEntity)).toEqual([
        {
          membershipId: 'membership-1',
          action: ScopeMembershipActionKind.SUSPENDED,
          actorUserId: 'owner-1',
          reason: 'Repeated spam',
        },
      ]);
      expect(bump).toHaveBeenCalledWith(
        FleetScopeKind.FLEET,
        'fleet-1',
        manager,
      );
      // Nothing it holds changes: no role or grant is ended.
      expect(manager.update).not.toHaveBeenCalled();
      expect(createNotification).toHaveBeenCalledWith({
        target: NotificationTarget.USER,
        userId: 'member-1',
        title: 'Fleet membership suspended',
        body: expect.not.stringContaining('spam'),
        severity: NotificationSeverity.WARNING,
      });
    });

    it('reinstates a suspended member, and tells them', async () => {
      membership = member(ScopeMembershipStatus.SUSPENDED);

      await reinstate();

      expect(savedTo(ScopeMembershipEntity)).toEqual([
        expect.objectContaining({
          status: ScopeMembershipStatus.APPROVED,
          decisionReason: 'Sorted',
        }),
      ]);
      expect(savedTo(ScopeMembershipActionEntity)).toEqual([
        expect.objectContaining({
          action: ScopeMembershipActionKind.REINSTATED,
          reason: 'Sorted',
        }),
      ]);
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Fleet membership reinstated',
          body: 'Your membership of Kell Fleet has been reinstated.',
          severity: NotificationSeverity.SUCCESS,
        }),
      );
    });

    it('keeps the change when the notice cannot be sent', async () => {
      membership = member(ScopeMembershipStatus.APPROVED);
      createNotification.mockRejectedValue(new Error('No database'));

      await expect(suspend()).resolves.toBeUndefined();
      expect(savedTo(ScopeMembershipActionEntity)).toHaveLength(1);
    });
  });

  describe('list', () => {
    it('lists nobody for a Fleet without members', async () => {
      await expect(service.list('fleet-1')).resolves.toEqual([]);
      expect(manager.find).toHaveBeenCalledTimes(1);
    });

    it('names each member with the Character and way they came in', async () => {
      const since = new Date('2026-09-20T10:00:00Z');
      manager.find.mockImplementation((entity: unknown) => {
        switch (entity) {
          case ScopeMembershipEntity:
            return Promise.resolve([
              { ...member(ScopeMembershipStatus.APPROVED), decidedAt: since },
              {
                ...member(ScopeMembershipStatus.SUSPENDED),
                id: 'membership-2',
                userId: 'member-2',
                decidedAt: new Date('2026-09-25T10:00:00Z'),
                decisionReason: 'Repeated spam',
              },
              {
                ...member(ScopeMembershipStatus.APPROVED),
                id: 'membership-3',
                userId: 'member-3',
                decidedAt: since,
              },
            ]);
          case UserProfileEntity:
            return Promise.resolve([{ userId: 'member-1', username: 'Kell' }]);
          case ScopeMembershipActionEntity:
            return Promise.resolve([
              { membershipId: 'membership-1', applicationId: 'application-2' },
              { membershipId: 'membership-1', applicationId: 'application-1' },
              // A suspension moves the decision; the grant says since when.
              {
                membershipId: 'membership-2',
                applicationId: null,
                createdAt: since,
              },
            ]);
          case FleetApplicationEntity:
            return Promise.resolve([
              {
                id: 'application-2',
                characterId: 'character-1',
                route: FleetApplicationRoute.INVITATION,
              },
            ]);
          case CharacterEntity:
            return Promise.resolve([
              { id: 'character-1', fullHandle: 'Kell Marr@kell' },
            ]);
          default:
            return Promise.resolve([]);
        }
      });

      await expect(service.list('fleet-1')).resolves.toEqual([
        {
          membershipId: 'membership-1',
          username: 'Kell',
          status: ScopeMembershipStatus.APPROVED,
          memberSince: since,
          route: FleetApplicationRoute.INVITATION,
          characterName: 'Kell Marr@kell',
          suspensionReason: null,
        },
        {
          membershipId: 'membership-2',
          username: null,
          status: ScopeMembershipStatus.SUSPENDED,
          memberSince: since,
          route: null,
          characterName: null,
          suspensionReason: 'Repeated spam',
        },
        {
          membershipId: 'membership-3',
          username: null,
          status: ScopeMembershipStatus.APPROVED,
          memberSince: since,
          route: null,
          characterName: null,
          suspensionReason: null,
        },
      ]);
    });

    it('reads no applications for members recruitment never logged', async () => {
      manager.find.mockImplementation((entity: unknown) =>
        Promise.resolve(
          entity === ScopeMembershipEntity
            ? [member(ScopeMembershipStatus.APPROVED)]
            : [],
        ),
      );

      const [listed] = await service.list('fleet-1');

      expect(listed.route).toBeNull();
      expect(manager.find).not.toHaveBeenCalledWith(
        FleetApplicationEntity,
        expect.anything(),
      );
    });

    it('names no Character when the application behind a grant has gone', async () => {
      manager.find.mockImplementation((entity: unknown) => {
        switch (entity) {
          case ScopeMembershipEntity:
            return Promise.resolve([member(ScopeMembershipStatus.APPROVED)]);
          case ScopeMembershipActionEntity:
            return Promise.resolve([
              { membershipId: 'membership-1', applicationId: 'application-9' },
            ]);
          default:
            return Promise.resolve([]);
        }
      });

      const [listed] = await service.list('fleet-1');

      expect(listed.characterName).toBeNull();
      expect(listed.route).toBeNull();
    });
  });
});
