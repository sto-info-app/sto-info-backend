import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { DataSource } from 'typeorm';

import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { CharacterFleetMapper } from '../../mappers/character-fleet.mapper';
import { FleetInvitationState } from '../dto/fleet-invitation.dto';
import { FleetApplicationActionEntity } from '../entities/fleet-application-action.entity';
import { FleetApplicationEntity } from '../entities/fleet-application.entity';
import { FleetInvitationEntity } from '../entities/fleet-invitation.entity';
import { FleetApplicationActionKind } from '../enums/fleet-application-action-kind.enum';
import { FleetApplicationRoute } from '../enums/fleet-application-route.enum';
import { FleetApplicationStatus } from '../enums/fleet-application-status.enum';
import { FleetInvitationStatus } from '../enums/fleet-invitation-status.enum';
import {
  FLEET_INVITATION_LIFETIME_DAYS,
  FleetInvitationService,
  stateOf,
} from './fleet-invitation.service';
import { RecruitmentEligibilityService } from './recruitment-eligibility.service';
import { RecruitmentMembershipService } from './recruitment-membership.service';
import { RecruitmentSettingsService } from './recruitment-settings.service';

const FLEET = {
  id: 'fleet-1',
  communityId: 'community-1',
  community: { ownerUserId: 'owner-1' },
} as StoFleetEntity;
const NOW = new Date('2026-09-26T12:00:00Z');
const DAY = 86_400_000;

/**
 * Builds an invitation.
 *
 * @param changes - Fields to override.
 * @returns The invitation.
 */
function invitation(
  changes: Partial<FleetInvitationEntity> = {},
): FleetInvitationEntity {
  return {
    id: 'invitation-1',
    communityId: 'community-1',
    fleetId: 'fleet-1',
    invitedUserId: 'invitee-1',
    invitedByUserId: 'officer-1',
    status: FleetInvitationStatus.PENDING,
    expiresAt: new Date(NOW.getTime() + DAY),
    answeredAt: null,
    createdAt: new Date(NOW.getTime() - DAY),
    fleet: FLEET,
    ...changes,
  } as FleetInvitationEntity;
}

describe('FleetInvitationService', () => {
  let profile: { userId: string; username: string } | null;
  let stored: FleetInvitationEntity | null;
  let manager: Record<string, jest.Mock>;
  let builder: Record<string, jest.Mock>;
  let eligibility: Record<string, jest.Mock>;
  let membership: Record<string, jest.Mock>;
  let service: FleetInvitationService;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    profile = { userId: 'invitee-1', username: 'Kell' };
    stored = null;
    builder = {
      where: jest.fn(() => builder),
      getOne: jest.fn(() => Promise.resolve(profile)),
    };
    manager = {
      createQueryBuilder: jest.fn(() => builder),
      findOne: jest.fn(() => Promise.resolve(stored)),
      findOneOrFail: jest.fn(() =>
        Promise.resolve({
          id: 'application-1',
          fleet: FLEET,
          character: { fullHandle: 'Kell Marr@kell' },
          status: FleetApplicationStatus.ACCEPTED,
          route: FleetApplicationRoute.INVITATION,
          submittedAt: NOW,
          decidedAt: NOW,
          decisionNote: null,
        }),
      ),
      find: jest.fn((entity: unknown) =>
        Promise.resolve(
          entity === UserProfileEntity
            ? [
                { userId: 'invitee-1', username: 'Kell' },
                { userId: 'officer-1', username: 'Tovan' },
              ]
            : [invitation()],
        ),
      ),
      create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
      save: jest.fn((_entity: unknown, data: object) =>
        Promise.resolve({
          id: 'saved-1',
          createdAt: NOW,
          answeredAt: null,
          ...data,
        }),
      ),
    };
    eligibility = {
      loadFleet: jest.fn(() => Promise.resolve(FLEET)),
      requireCharacter: jest.fn(() =>
        Promise.resolve({ id: 'character-1', fullHandle: 'Kell Marr@kell' }),
      ),
    };
    membership = {
      assertMayJoin: jest.fn(() => Promise.resolve()),
      grantWithin: jest.fn(() => Promise.resolve({ id: 'membership-1' })),
    };
    const dataSource = {
      manager,
      transaction: jest.fn((work: (m: typeof manager) => Promise<unknown>) =>
        work(manager),
      ),
    };
    service = new FleetInvitationService(
      dataSource as unknown as DataSource,
      {
        current: jest.fn(() =>
          Promise.resolve({ settings: { id: 'settings-2' } }),
        ),
      } as unknown as RecruitmentSettingsService,
      eligibility as unknown as RecruitmentEligibilityService,
      membership as unknown as RecruitmentMembershipService,
      {
        toSummaryDto: jest.fn(() => ({ id: 'fleet-1' })),
      } as unknown as CharacterFleetMapper,
    );
  });

  afterEach(() => jest.useRealTimers());

  /** The entities saved to one table, in order. */
  const savedTo = (entity: unknown): Record<string, unknown>[] =>
    manager.save.mock.calls
      .filter(([target]) => target === entity)
      .map(([, data]) => data as Record<string, unknown>);

  describe('stateOf', () => {
    it('reads an unanswered invitation as open until it lapses', () => {
      expect(stateOf(invitation(), NOW)).toBe(FleetInvitationState.PENDING);
      expect(
        stateOf(invitation({ expiresAt: new Date(NOW.getTime() - 1) }), NOW),
      ).toBe(FleetInvitationState.LAPSED);
    });

    it('reads an answered invitation as it was answered', () => {
      expect(
        stateOf(invitation({ status: FleetInvitationStatus.DECLINED }), NOW),
      ).toBe(FleetInvitationState.DECLINED);
    });
  });

  describe('invite', () => {
    const invite = (username = ' Kell ') =>
      service.invite('community-1', 'fleet-1', username, 'officer-1');

    it('invites the person with that username for 14 days', async () => {
      const sent = await invite();

      expect(builder.where).toHaveBeenCalledWith(
        'LOWER(profile.username) = LOWER(:username)',
        { username: 'Kell' },
      );
      expect(savedTo(FleetInvitationEntity)).toEqual([
        {
          communityId: 'community-1',
          fleetId: 'fleet-1',
          invitedUserId: 'invitee-1',
          invitedByUserId: 'officer-1',
          status: FleetInvitationStatus.PENDING,
          expiresAt: new Date(
            NOW.getTime() + FLEET_INVITATION_LIFETIME_DAYS * DAY,
          ),
        },
      ]);
      expect(sent).toEqual({
        id: 'saved-1',
        invitedUsername: 'Kell',
        invitedByUsername: 'Tovan',
        state: FleetInvitationState.PENDING,
        sentAt: NOW,
        expiresAt: new Date(NOW.getTime() + 14 * DAY),
        answeredAt: null,
      });
    });

    it('replaces an invitation that lapsed unanswered', async () => {
      const lapsed = invitation({ expiresAt: new Date(NOW.getTime() - 1) });
      stored = lapsed;

      await invite();

      expect(lapsed.status).toBe(FleetInvitationStatus.LAPSED);
      expect(lapsed.answeredAt).toEqual(NOW);
      expect(savedTo(FleetInvitationEntity)).toHaveLength(2);
    });

    it('refuses a second open invitation', async () => {
      stored = invitation();

      await expect(invite()).rejects.toThrow(
        'They already have an open invitation.',
      );
    });

    it('refuses a username nobody has', async () => {
      profile = null;

      await expect(invite('Nobody')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to invite the officer themselves', async () => {
      profile = { userId: 'officer-1', username: 'Tovan' };

      await expect(invite()).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to invite the Community’s Owner', async () => {
      profile = { userId: 'owner-1', username: 'Owner' };

      await expect(invite()).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to invite a member', async () => {
      membership.assertMayJoin.mockImplementationOnce(() =>
        Promise.reject(
          new ConflictException('Already a member of this Fleet.'),
        ),
      );

      await expect(invite()).rejects.toThrow('Already a member');
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('invites somebody to a Fleet that is not held by a Community owner', async () => {
      eligibility.loadFleet.mockImplementationOnce(() =>
        Promise.resolve({ ...FLEET, community: null }),
      );

      await expect(invite()).resolves.toEqual(
        expect.objectContaining({ id: 'saved-1' }),
      );
    });
  });

  describe('withdraw', () => {
    it('withdraws an open invitation', async () => {
      const open = invitation();
      stored = open;

      const withdrawn = await service.withdraw(
        'community-1',
        'fleet-1',
        'invitation-1',
      );

      expect(open.status).toBe(FleetInvitationStatus.WITHDRAWN);
      expect(withdrawn.state).toBe(FleetInvitationState.WITHDRAWN);
    });

    it('does not find an invitation of another Fleet', async () => {
      await expect(
        service.withdraw('community-1', 'fleet-2', 'invitation-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses an invitation already answered', async () => {
      stored = invitation({ status: FleetInvitationStatus.ACCEPTED });

      await expect(
        service.withdraw('community-1', 'fleet-1', 'invitation-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('list', () => {
    it('lists a Fleet’s invitations, naming who sent them', async () => {
      manager.find.mockImplementation((entity: unknown) =>
        Promise.resolve(
          entity === UserProfileEntity
            ? [{ userId: 'invitee-1', username: 'Kell' }]
            : [
                invitation(),
                invitation({ id: 'invitation-2', invitedByUserId: null }),
              ],
        ),
      );

      const listed = await service.list('fleet-1');

      expect(listed.map(entry => entry.invitedByUsername)).toEqual([
        null,
        null,
      ]);
      expect(listed[0].invitedUsername).toBe('Kell');
      expect(manager.find).toHaveBeenCalledWith(
        FleetInvitationEntity,
        expect.objectContaining({
          where: { fleetId: 'fleet-1' },
          order: { createdAt: 'DESC', id: 'DESC' },
        }),
      );
    });

    it('names nobody whose account has no username', async () => {
      manager.find.mockImplementation((entity: unknown) =>
        Promise.resolve(entity === UserProfileEntity ? [] : [invitation()]),
      );

      const [entry] = await service.list('fleet-1');

      expect(entry.invitedUsername).toBeNull();
    });
  });

  describe('listMine', () => {
    it('lists the person’s open invitations with their Fleets', async () => {
      manager.find.mockImplementation((entity: unknown) =>
        Promise.resolve(
          entity === UserProfileEntity
            ? [{ userId: 'officer-1', username: 'Tovan' }]
            : [
                invitation(),
                invitation({ id: 'invitation-2', invitedByUserId: null }),
                invitation({
                  id: 'invitation-3',
                  invitedByUserId: 'officer-9',
                }),
              ],
        ),
      );

      const mine = await service.listMine('invitee-1');

      expect(mine[0]).toEqual({
        id: 'invitation-1',
        fleet: { id: 'fleet-1' },
        invitedByUsername: 'Tovan',
        sentAt: new Date(NOW.getTime() - DAY),
        expiresAt: new Date(NOW.getTime() + DAY),
      });
      expect(mine[1].invitedByUsername).toBeNull();
      expect(mine[2].invitedByUsername).toBeNull();
    });
  });

  describe('accept', () => {
    it('records the invitation’s way in and grants membership', async () => {
      const open = invitation();
      stored = open;

      const mine = await service.accept(
        'invitation-1',
        'invitee-1',
        'character-1',
      );

      expect(manager.findOne).toHaveBeenCalledWith(FleetInvitationEntity, {
        where: { id: 'invitation-1', invitedUserId: 'invitee-1' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(eligibility.requireCharacter).toHaveBeenCalledWith(
        manager,
        FLEET,
        'character-1',
        'invitee-1',
        null,
      );
      expect(savedTo(FleetApplicationEntity)).toEqual([
        expect.objectContaining({
          route: FleetApplicationRoute.INVITATION,
          status: FleetApplicationStatus.ACCEPTED,
          invitationId: 'invitation-1',
          decidedByUserId: 'officer-1',
          settingsId: 'settings-2',
        }),
      ]);
      expect(savedTo(FleetApplicationActionEntity)[0]).toEqual(
        expect.objectContaining({
          action: FleetApplicationActionKind.ACCEPTED,
          actorUserId: 'invitee-1',
        }),
      );
      expect(open.status).toBe(FleetInvitationStatus.ACCEPTED);
      expect(membership.grantWithin).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          userId: 'invitee-1',
          actorUserId: 'officer-1',
          applicationId: 'saved-1',
        }),
      );
      expect(mine).toEqual(
        expect.objectContaining({
          route: FleetApplicationRoute.INVITATION,
          characterName: 'Kell Marr@kell',
        }),
      );
    });

    it('records no form for a Fleet that never saved one', async () => {
      stored = invitation();
      service = new FleetInvitationService(
        {
          manager,
          transaction: jest.fn(
            (work: (m: typeof manager) => Promise<unknown>) => work(manager),
          ),
        } as unknown as DataSource,
        {
          current: jest.fn(() => Promise.resolve({ settings: null })),
        } as unknown as RecruitmentSettingsService,
        eligibility as unknown as RecruitmentEligibilityService,
        membership as unknown as RecruitmentMembershipService,
        { toSummaryDto: jest.fn() } as unknown as CharacterFleetMapper,
      );

      await service.accept('invitation-1', 'invitee-1', 'character-1');

      expect(savedTo(FleetApplicationEntity)[0].settingsId).toBeNull();
    });

    it('does not find somebody else’s invitation', async () => {
      await expect(
        service.accept('invitation-1', 'someone-else', 'character-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses an invitation that has lapsed', async () => {
      stored = invitation({ expiresAt: new Date(NOW.getTime() - 1) });

      await expect(
        service.accept('invitation-1', 'invitee-1', 'character-1'),
      ).rejects.toThrow('has lapsed or has already been answered');
      expect(membership.grantWithin).not.toHaveBeenCalled();
    });
  });

  describe('decline', () => {
    it('declines an open invitation', async () => {
      const open = invitation();
      stored = open;

      await service.decline('invitation-1', 'invitee-1');

      expect(open.status).toBe(FleetInvitationStatus.DECLINED);
      expect(open.answeredAt).toEqual(NOW);
    });

    it('refuses an invitation already withdrawn', async () => {
      stored = invitation({ status: FleetInvitationStatus.WITHDRAWN });

      await expect(
        service.decline('invitation-1', 'invitee-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
