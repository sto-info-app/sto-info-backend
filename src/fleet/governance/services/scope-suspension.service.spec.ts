import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { DataSource, IsNull } from 'typeorm';

import { NotificationSeverity } from 'src/notification/enums/notification-severity.enum';
import { NotificationTarget } from 'src/notification/enums/notification-target.enum';
import { NotificationService } from 'src/notification/notification.service';

import { FleetAuthorisationRevisionService } from '../../authorisation/fleet-authorisation-revision.service';
import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { ScopeRoleAssignmentEntity } from '../../entities/scope-role-assignment.entity';
import { StoArmadaEntity } from '../../entities/sto-armada.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { ScopeGovernanceActionKind } from '../enums/scope-governance-action-kind.enum';
import {
  armadaScope,
  communityScope,
  fleetScope,
} from '../utilities/governance-scope.utility';
import { ScopeGovernanceLogService } from './scope-governance-log.service';
import { ScopeSuspensionService } from './scope-suspension.service';

const COMMUNITY_ID = '23000000-0000-4000-8000-000000000001';
const FLEET_ID = '23000000-0000-4000-8000-000000000002';
const ARMADA_ID = '23000000-0000-4000-8000-000000000003';
const ADMIN_ID = '23000000-0000-4000-8000-000000000004';
const OWNER_ID = '23000000-0000-4000-8000-000000000005';
const SCOPE_ADMIN_ID = '23000000-0000-4000-8000-000000000006';
const COMMUNITY_ADMIN_ID = '23000000-0000-4000-8000-000000000007';

const COMMUNITY_PAGE = 'https://sto.example/fleets/communities/fixture';

describe('ScopeSuspensionService', () => {
  let stored: { id: string; status: FleetScopeStatus } | null;
  let community: Partial<FleetCommunityEntity> | null;
  let admins: Partial<ScopeRoleAssignmentEntity>[];
  let manager: { findOne: jest.Mock; find: jest.Mock; update: jest.Mock };
  let bump: jest.Mock;
  let record: jest.Mock;
  let createNotification: jest.Mock;
  let service: ScopeSuspensionService;
  let savedFrontendUrl: string | undefined;

  beforeEach(() => {
    savedFrontendUrl = process.env.APP_FRONTEND_URL;
    process.env.APP_FRONTEND_URL = 'https://sto.example';
    stored = { id: FLEET_ID, status: FleetScopeStatus.ACTIVE };
    community = {
      id: COMMUNITY_ID,
      name: 'Fixture Community',
      slug: 'fixture',
      ownerUserId: OWNER_ID,
    };
    admins = [];
    manager = {
      // The locked row is the scope's; every other read names its place.
      findOne: jest.fn((entity: unknown, options: { lock?: unknown }) => {
        if (options.lock !== undefined) {
          return Promise.resolve(stored);
        }

        if (entity === FleetCommunityEntity) {
          return Promise.resolve(community);
        }

        return Promise.resolve({
          id: entity === StoFleetEntity ? FLEET_ID : ARMADA_ID,
          exactGameName:
            entity === StoFleetEntity ? 'Fixture Fleet' : 'Fixture Armada',
          slug: 'fixture-scope',
          platform: { name: 'PC' },
        });
      }),
      find: jest.fn(() => Promise.resolve(admins)),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
    };
    bump = jest.fn(() => Promise.resolve(2));
    record = jest.fn(() => Promise.resolve());
    createNotification = jest.fn(() => Promise.resolve({}));
    service = new ScopeSuspensionService(
      {
        transaction: jest.fn((work: (m: typeof manager) => Promise<unknown>) =>
          work(manager),
        ),
      } as unknown as DataSource,
      { bump } as unknown as FleetAuthorisationRevisionService,
      { record } as unknown as ScopeGovernanceLogService,
      { createNotification } as unknown as NotificationService,
    );
  });

  afterEach(() => {
    process.env.APP_FRONTEND_URL = savedFrontendUrl;
  });

  /** Whom each notice went to, in order. */
  const recipients = (): string[] =>
    createNotification.mock.calls.map(
      ([notice]) => (notice as { userId: string }).userId,
    );

  it.each([
    [
      'a Community',
      communityScope(COMMUNITY_ID),
      FleetCommunityEntity,
      { id: COMMUNITY_ID },
      COMMUNITY_ID,
    ],
    [
      'a Fleet',
      fleetScope(COMMUNITY_ID, FLEET_ID),
      StoFleetEntity,
      { id: FLEET_ID, communityId: COMMUNITY_ID },
      FLEET_ID,
    ],
    [
      'an Armada',
      armadaScope(COMMUNITY_ID, ARMADA_ID),
      StoArmadaEntity,
      { id: ARMADA_ID, communityId: COMMUNITY_ID },
      ARMADA_ID,
    ],
  ])(
    'suspends %s, locked, logged as a site admin’s and advertised',
    async (_name, scope, entity, where, id) => {
      stored = { id, status: FleetScopeStatus.ACTIVE };

      await service.suspend(scope, ' Under review ', ADMIN_ID);

      expect(manager.findOne).toHaveBeenCalledWith(entity, {
        where,
        lock: { mode: 'pessimistic_write' },
      });
      expect(manager.update).toHaveBeenCalledWith(
        entity,
        { id },
        { status: FleetScopeStatus.SUSPENDED },
      );
      expect(record).toHaveBeenCalledWith(manager, {
        scope,
        action: ScopeGovernanceActionKind.SUSPENDED,
        actorUserId: ADMIN_ID,
        asSiteAdmin: true,
        reason: 'Under review',
      });
      expect(bump).toHaveBeenCalledWith(scope.kind, id, manager);
    },
  );

  it('reinstates a suspended scope', async () => {
    stored = { id: FLEET_ID, status: FleetScopeStatus.SUSPENDED };

    await service.reinstate(
      fleetScope(COMMUNITY_ID, FLEET_ID),
      'Done',
      ADMIN_ID,
    );

    expect(manager.update).toHaveBeenCalledWith(
      StoFleetEntity,
      { id: FLEET_ID },
      { status: FleetScopeStatus.ACTIVE },
    );
    expect(record).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({ action: ScopeGovernanceActionKind.REINSTATED }),
    );
    expect(bump).toHaveBeenCalledWith(FleetScopeKind.FLEET, FLEET_ID, manager);
  });

  it('changes nothing when it is already so', async () => {
    stored = { id: FLEET_ID, status: FleetScopeStatus.SUSPENDED };
    await service.suspend(
      fleetScope(COMMUNITY_ID, FLEET_ID),
      'Again',
      ADMIN_ID,
    );

    stored = { id: FLEET_ID, status: FleetScopeStatus.ACTIVE };
    await service.reinstate(
      fleetScope(COMMUNITY_ID, FLEET_ID),
      'Again',
      ADMIN_ID,
    );

    expect(manager.update).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('refuses a closed scope', async () => {
    stored = { id: FLEET_ID, status: FleetScopeStatus.CLOSED };

    await expect(
      service.suspend(fleetScope(COMMUNITY_ID, FLEET_ID), 'Why', ADMIN_ID),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.reinstate(fleetScope(COMMUNITY_ID, FLEET_ID), 'Why', ADMIN_ID),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a scope that does not exist, and a missing reason', async () => {
    stored = null;

    await expect(
      service.suspend(fleetScope(COMMUNITY_ID, FLEET_ID), 'Why', ADMIN_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.suspend(fleetScope(COMMUNITY_ID, FLEET_ID), '  ', ADMIN_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.reinstate(
        fleetScope(COMMUNITY_ID, FLEET_ID),
        undefined,
        ADMIN_ID,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // Steve's decision of 30 September 2026: the Owner and Admins are told,
  // never why, and nothing goes in the activity feed.
  describe('telling its Owner and Admins', () => {
    it('tells a Community’s Owner and its own Admins that it was suspended, without the reason', async () => {
      stored = { id: COMMUNITY_ID, status: FleetScopeStatus.ACTIVE };
      admins = [{ userId: SCOPE_ADMIN_ID }];

      await service.suspend(
        communityScope(COMMUNITY_ID),
        'Reported for harassment',
        ADMIN_ID,
      );

      expect(manager.find).toHaveBeenCalledWith(ScopeRoleAssignmentEntity, {
        where: [
          {
            communityId: COMMUNITY_ID,
            fleetId: IsNull(),
            armadaId: IsNull(),
            role: FleetScopeRole.ADMIN,
            validTo: IsNull(),
          },
        ],
        select: { id: true, userId: true },
      });
      expect(recipients()).toEqual([SCOPE_ADMIN_ID, OWNER_ID]);
      expect(createNotification).toHaveBeenCalledWith({
        target: NotificationTarget.USER,
        userId: OWNER_ID,
        severity: NotificationSeverity.WARNING,
        title: 'Fixture Community was suspended',
        body:
          'A site administrator suspended Fixture Community, and with it ' +
          'its Fleets and Armadas. Until it is reinstated, nothing there ' +
          'can be changed and nobody can post in its chat.',
        linkUrl: COMMUNITY_PAGE,
      });
      expect(JSON.stringify(createNotification.mock.calls)).not.toContain(
        'harassment',
      );
    });

    it.each([
      [
        'a Fleet',
        fleetScope(COMMUNITY_ID, FLEET_ID),
        'Fixture Fleet',
        { fleetId: FLEET_ID, armadaId: IsNull() },
        `${COMMUNITY_PAGE}/fleets/pc/fixture-scope`,
      ],
      [
        'an Armada',
        armadaScope(COMMUNITY_ID, ARMADA_ID),
        'Fixture Armada',
        { fleetId: IsNull(), armadaId: ARMADA_ID },
        `${COMMUNITY_PAGE}/armadas/pc/fixture-scope`,
      ],
    ])(
      'tells %s’s Admins, the Community’s Admins whose role reaches it, and the Owner, each once',
      async (_name, scope, scopeName, at, link) => {
        // The Owner holding a role here too is still told once.
        admins = [
          { userId: SCOPE_ADMIN_ID },
          { userId: COMMUNITY_ADMIN_ID },
          { userId: OWNER_ID },
        ];
        stored = { id: scopeName, status: FleetScopeStatus.SUSPENDED };

        await service.reinstate(scope, 'Cleared', ADMIN_ID);

        expect(manager.find).toHaveBeenCalledWith(ScopeRoleAssignmentEntity, {
          where: [
            {
              communityId: COMMUNITY_ID,
              ...at,
              role: FleetScopeRole.ADMIN,
              validTo: IsNull(),
            },
            {
              communityId: COMMUNITY_ID,
              fleetId: IsNull(),
              armadaId: IsNull(),
              role: FleetScopeRole.ADMIN,
              validTo: IsNull(),
            },
          ],
          select: { id: true, userId: true },
        });
        expect(recipients()).toEqual([
          SCOPE_ADMIN_ID,
          COMMUNITY_ADMIN_ID,
          OWNER_ID,
        ]);
        expect(createNotification).toHaveBeenCalledWith({
          target: NotificationTarget.USER,
          userId: SCOPE_ADMIN_ID,
          severity: NotificationSeverity.SUCCESS,
          title: `${scopeName} was reinstated`,
          body:
            `A site administrator lifted ${scopeName}’s suspension. Its ` +
            'roles, members and events stand as they were.',
          linkUrl: link,
        });
      },
    );

    it('says a Fleet’s suspension is its own', async () => {
      await service.suspend(
        fleetScope(COMMUNITY_ID, FLEET_ID),
        'Why',
        ADMIN_ID,
      );

      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          body:
            'A site administrator suspended Fixture Fleet. Until it is ' +
            'reinstated, nothing there can be changed and nobody can post ' +
            'in its chat.',
        }),
      );
    });

    it('does not tell the site administrator who made the change', async () => {
      admins = [{ userId: ADMIN_ID }];
      community = { ...community!, ownerUserId: ADMIN_ID };

      await service.suspend(
        fleetScope(COMMUNITY_ID, FLEET_ID),
        'Why',
        ADMIN_ID,
      );

      expect(createNotification).not.toHaveBeenCalled();
    });

    it('tells nobody when nothing changed, or the change was refused', async () => {
      stored = { id: FLEET_ID, status: FleetScopeStatus.SUSPENDED };
      await service.suspend(
        fleetScope(COMMUNITY_ID, FLEET_ID),
        'Why',
        ADMIN_ID,
      );

      stored = { id: FLEET_ID, status: FleetScopeStatus.CLOSED };
      await expect(
        service.reinstate(fleetScope(COMMUNITY_ID, FLEET_ID), 'Why', ADMIN_ID),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(manager.find).not.toHaveBeenCalled();
      expect(createNotification).not.toHaveBeenCalled();
    });

    it('keeps the change when a notice cannot be sent, and tells the rest', async () => {
      admins = [{ userId: SCOPE_ADMIN_ID }];
      createNotification.mockRejectedValueOnce(new Error('down'));

      await expect(
        service.suspend(fleetScope(COMMUNITY_ID, FLEET_ID), 'Why', ADMIN_ID),
      ).resolves.toBeUndefined();
      expect(manager.update).toHaveBeenCalled();
      expect(recipients()).toEqual([SCOPE_ADMIN_ID, OWNER_ID]);
    });

    it('links nowhere when the site’s address is not set', async () => {
      delete process.env.APP_FRONTEND_URL;

      await service.suspend(
        fleetScope(COMMUNITY_ID, FLEET_ID),
        'Why',
        ADMIN_ID,
      );

      expect(createNotification.mock.calls[0][0]).not.toHaveProperty('linkUrl');
    });

    // A closed Community's Owner may have been erased; a place that has gone
    // mid-change has nothing to name.
    it('tells only the Admins when there is no Owner, and nobody when the scope cannot be named', async () => {
      admins = [{ userId: SCOPE_ADMIN_ID }];
      community = { ...community!, ownerUserId: null };

      await service.suspend(
        fleetScope(COMMUNITY_ID, FLEET_ID),
        'Why',
        ADMIN_ID,
      );

      expect(recipients()).toEqual([SCOPE_ADMIN_ID]);

      createNotification.mockClear();
      community = null;
      stored = { id: FLEET_ID, status: FleetScopeStatus.ACTIVE };

      await service.suspend(
        fleetScope(COMMUNITY_ID, FLEET_ID),
        'Why',
        ADMIN_ID,
      );

      expect(createNotification).not.toHaveBeenCalled();
    });
  });
});
