import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';

import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { FleetAuthorisationRevisionService } from '../../authorisation/fleet-authorisation-revision.service';
import { FleetAuthorisationService } from '../../authorisation/fleet-authorisation.service';
import { FLEET_CAPABILITIES } from '../../authorisation/fleet-capability.constants';
import { ScopeAuthorisation } from '../../authorisation/scope-authorisation.interface';
import { ArmadaFleetMembershipEntity } from '../../entities/armada-fleet-membership.entity';
import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { ScopeCapabilityGrantEntity } from '../../entities/scope-capability-grant.entity';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { ScopeRoleAssignmentEntity } from '../../entities/scope-role-assignment.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { ScopeCapabilityEffect } from '../../enums/scope-capability-effect.enum';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import { ScopeGovernanceActionEntity } from '../entities/scope-governance-action.entity';
import { ScopeGovernanceActionKind } from '../enums/scope-governance-action-kind.enum';
import {
  armadaScope,
  communityScope,
  fleetScope,
} from '../utilities/governance-scope.utility';
import { OwnershipTransferService } from './ownership-transfer.service';
import { ScopeGovernanceLogService } from './scope-governance-log.service';
import { ENDED_BY_CLOSURE, ScopeRolesService } from './scope-roles.service';

const COMMUNITY_ID = '24000000-0000-4000-8000-000000000001';
const FLEET_ID = '24000000-0000-4000-8000-000000000002';
const OWNER_ID = '24000000-0000-4000-8000-000000000003';
const ADMIN_ID = '24000000-0000-4000-8000-000000000004';
const MEMBER_ID = '24000000-0000-4000-8000-000000000005';
const OUTSIDER_ID = '24000000-0000-4000-8000-000000000006';
const ANOTHER_MEMBER_ID = '24000000-0000-4000-8000-000000000007';
const ASSIGNMENT_ID = '24000000-0000-4000-8000-000000000008';
const GRANT_ID = '24000000-0000-4000-8000-000000000009';

const SINCE = new Date('2026-09-01T00:00:00.000Z');

const FLEET = fleetScope(COMMUNITY_ID, FLEET_ID);
const COMMUNITY = communityScope(COMMUNITY_ID);
const ARMADA = armadaScope(COMMUNITY_ID, 'armada-1');

describe('ScopeRolesService', () => {
  let authorisation: ScopeAuthorisation | null;
  let assignments: Partial<ScopeRoleAssignmentEntity>[];
  let grants: Partial<ScopeCapabilityGrantEntity>[];
  let members: string[];
  let found: object | null;
  /** The Fleets placed in the Armada, for its eligibility (FC-025). */
  let placedFleets: string[];
  let isOwner: boolean;
  let holdsRole: boolean;
  let manager: {
    find: jest.Mock;
    findOne: jest.Mock;
    exists: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    insert?: jest.Mock;
  };
  let authorise: jest.Mock;
  let bump: jest.Mock;
  let record: jest.Mock;
  let cancelOpenWithin: jest.Mock;
  let service: ScopeRolesService;

  /**
   * Builds what the policy says about the reader.
   *
   * @param roles - Their role labels here.
   * @param capabilities - What they hold here.
   * @returns The authorisation.
   */
  const reader = (
    roles: FleetScopeRole[],
    capabilities: string[] = [],
  ): ScopeAuthorisation =>
    ({
      scope: { communityOwnerUserId: OWNER_ID },
      roles: new Set(roles),
      capabilities: new Set(capabilities),
    }) as unknown as ScopeAuthorisation;

  beforeEach(() => {
    authorisation = reader(
      [FleetScopeRole.OWNER],
      [FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE],
    );
    assignments = [];
    grants = [];
    members = [MEMBER_ID, ADMIN_ID, OWNER_ID];
    found = null;
    placedFleets = [];
    isOwner = false;
    holdsRole = false;
    manager = {
      find: jest.fn((entity: unknown) => {
        if (entity === ScopeRoleAssignmentEntity) {
          return Promise.resolve(assignments);
        }
        if (entity === ScopeCapabilityGrantEntity) {
          return Promise.resolve(grants);
        }
        if (entity === ScopeMembershipEntity) {
          return Promise.resolve(members.map(userId => ({ userId })));
        }
        if (entity === ArmadaFleetMembershipEntity) {
          return Promise.resolve(placedFleets.map(fleetId => ({ fleetId })));
        }
        if (entity === UserProfileEntity) {
          return Promise.resolve([
            { userId: OWNER_ID, username: 'MidNiteShadow' },
            { userId: ADMIN_ID, username: 'Deputy' },
            { userId: MEMBER_ID, username: 'Bosun' },
            { userId: ANOTHER_MEMBER_ID, username: 'Anchor' },
          ]);
        }

        return Promise.resolve([]);
      }),
      findOne: jest.fn(() => Promise.resolve(found)),
      exists: jest.fn((entity: unknown) =>
        Promise.resolve(entity === FleetCommunityEntity ? isOwner : holdsRole),
      ),
      save: jest.fn((_entity: unknown, row: object) => Promise.resolve(row)),
      create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
      update: jest.fn(() => Promise.resolve({})),
    };
    authorise = jest.fn(() => Promise.resolve(authorisation));
    bump = jest.fn(() => Promise.resolve(2));
    record = jest.fn(() => Promise.resolve());
    cancelOpenWithin = jest.fn(() => Promise.resolve());
    service = new ScopeRolesService(
      {
        manager,
        transaction: jest.fn((work: (m: typeof manager) => Promise<unknown>) =>
          work(manager),
        ),
      } as unknown as DataSource,
      { authorise } as unknown as FleetAuthorisationService,
      { bump } as unknown as FleetAuthorisationRevisionService,
      { record } as unknown as ScopeGovernanceLogService,
      { cancelOpenWithin } as unknown as OwnershipTransferService,
    );
  });

  /** Every entry the log was given. */
  const entries = (): object[] => record.mock.calls.map(([, entry]) => entry);

  describe('reading who governs', () => {
    it('refuses a scope the reader cannot see', async () => {
      authorisation = null;

      await expect(service.view(FLEET, OUTSIDER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(authorise).toHaveBeenCalledWith(OUTSIDER_ID, {
        kind: FleetScopeKind.FLEET,
        id: FLEET_ID,
        withinCommunityId: COMMUNITY_ID,
      });
    });

    // Members and Officers see who leads them elsewhere; this is the
    // Owner's workbench and the Admins' reference.
    it.each([[[FleetScopeRole.OFFICER]], [[FleetScopeRole.MEMBER]], [[]]])(
      'refuses a reader holding %j',
      async roles => {
        authorisation = reader(roles);

        await expect(service.view(FLEET, MEMBER_ID)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      },
    );

    it('shows the Owner everything, and whom they may appoint', async () => {
      assignments = [
        {
          id: ASSIGNMENT_ID,
          userId: ADMIN_ID,
          role: FleetScopeRole.ADMIN,
          validFrom: SINCE,
        },
      ];
      grants = [
        {
          subjectRole: FleetScopeRole.OFFICER,
          subjectUserId: null,
          capability: 'news.write',
          effect: ScopeCapabilityEffect.GRANT,
        },
        {
          id: GRANT_ID,
          subjectRole: null,
          subjectUserId: MEMBER_ID,
          capability: 'events.manage',
          effect: ScopeCapabilityEffect.DENY,
          validFrom: SINCE,
        },
      ];
      members = [MEMBER_ID, ADMIN_ID, OWNER_ID, ANOTHER_MEMBER_ID];

      const view = await service.view(FLEET, OWNER_ID);

      expect(view.owner).toEqual({
        userId: OWNER_ID,
        username: 'MidNiteShadow',
      });
      expect(view.mayManage).toBe(true);
      expect(view.holders).toEqual([
        {
          userId: ADMIN_ID,
          username: 'Deputy',
          assignmentId: ASSIGNMENT_ID,
          role: FleetScopeRole.ADMIN,
          since: SINCE,
        },
      ]);
      // Neither the Owner nor somebody holding a role already, by name.
      expect(view.candidates).toEqual([
        { userId: ANOTHER_MEMBER_ID, username: 'Anchor' },
        { userId: MEMBER_ID, username: 'Bosun' },
      ]);
      expect(view.officerCapabilities).toEqual(['news.write']);
      expect(view.personal).toEqual([
        {
          userId: MEMBER_ID,
          username: 'Bosun',
          grantId: GRANT_ID,
          capability: 'events.manage',
          effect: ScopeCapabilityEffect.DENY,
          since: SINCE,
        },
      ]);
      expect(view.delegable.map(capability => capability.code)).not.toContain(
        FLEET_CAPABILITIES.SCOPE_CLOSE,
      );
    });

    it('reads only the rows held at exactly the scope', async () => {
      await service.view(FLEET, OWNER_ID);

      expect(manager.find).toHaveBeenCalledWith(ScopeRoleAssignmentEntity, {
        where: {
          communityId: COMMUNITY_ID,
          fleetId: FLEET_ID,
          armadaId: IsNull(),
          role: In([FleetScopeRole.ADMIN, FleetScopeRole.OFFICER]),
          validTo: IsNull(),
        },
        order: { validFrom: 'ASC' },
      });
    });

    it('shows no Owner for a closed Community whose Owner was erased (FC-038)', async () => {
      authorisation = {
        ...authorisation,
        scope: { communityOwnerUserId: null },
      } as unknown as ScopeAuthorisation;

      await expect(service.view(FLEET, OWNER_ID)).resolves.toEqual(
        expect.objectContaining({ owner: null }),
      );
    });

    it('shows an Admin who governs, and nobody to appoint', async () => {
      authorisation = reader([FleetScopeRole.ADMIN]);

      const view = await service.view(FLEET, ADMIN_ID);

      expect(view.mayManage).toBe(false);
      expect(view.candidates).toEqual([]);
      expect(manager.find).not.toHaveBeenCalledWith(
        ScopeMembershipEntity,
        expect.anything(),
      );
    });

    it('names a candidate it has no username for as unnamed, and sorts them first', async () => {
      members = [OUTSIDER_ID, MEMBER_ID];

      const view = await service.view(FLEET, OWNER_ID);

      expect(view.candidates).toEqual([
        { userId: OUTSIDER_ID, username: null },
        { userId: MEMBER_ID, username: 'Bosun' },
      ]);
    });

    // At the Community, anybody approved in any of its Fleets.
    it('takes a Community’s candidates from every Fleet in it', async () => {
      await service.view(COMMUNITY, OWNER_ID);

      expect(manager.find).toHaveBeenCalledWith(ScopeMembershipEntity, {
        where: {
          communityId: COMMUNITY_ID,
          fleetId: Not(IsNull()),
          status: ScopeMembershipStatus.APPROVED,
        },
        select: { userId: true },
      });
    });
  });

  describe('appointing', () => {
    const appoint = (
      scope = FLEET,
      userId = MEMBER_ID,
      reason: string | undefined = undefined,
    ) =>
      service.assign(
        scope,
        { userId, role: FleetScopeRole.OFFICER, reason },
        OWNER_ID,
      );

    // FC-025: an Armada's roles go to the members of its placed Fleets.
    it('appoints a member of a Fleet placed in the Armada, and advertises it there', async () => {
      placedFleets = [FLEET_ID];

      await appoint(ARMADA);

      expect(manager.save).toHaveBeenCalledWith(
        ScopeRoleAssignmentEntity,
        expect.objectContaining({ armadaId: 'armada-1', fleetId: null }),
      );
      expect(bump).toHaveBeenCalledWith(
        FleetScopeKind.ARMADA,
        'armada-1',
        manager,
      );
    });

    it('refuses the Owner, who holds everything already', async () => {
      isOwner = true;

      await expect(appoint()).rejects.toThrow(
        new BadRequestException('The Owner holds every power here already.'),
      );
    });

    it.each([
      [
        FLEET,
        'Only an approved member of this Fleet can be given a role here.',
      ],
      [
        COMMUNITY,
        'Only an approved member of one of this Community’s Fleets can be given a role here.',
      ],
      [
        ARMADA,
        'Only an approved member of one of this Armada’s Fleets can be given a role here.',
      ],
    ])('refuses somebody who is not a member (%#)', async (scope, message) => {
      await expect(appoint(scope, OUTSIDER_ID)).rejects.toThrow(
        new BadRequestException(message),
      );
    });

    it.each([
      [
        FleetScopeRole.ADMIN,
        'They are an Admin here already. Withdraw that role first.',
      ],
      [
        FleetScopeRole.OFFICER,
        'They are an Officer here already. Withdraw that role first.',
      ],
    ])('refuses a second role while they hold %s', async (role, message) => {
      found = { role };

      await expect(appoint()).rejects.toThrow(new ConflictException(message));
    });

    it('appoints, logs and advertises it, at the Fleet', async () => {
      await appoint(FLEET, MEMBER_ID, '  Runs Saturday events ');

      expect(manager.save).toHaveBeenCalledWith(ScopeRoleAssignmentEntity, {
        communityId: COMMUNITY_ID,
        fleetId: FLEET_ID,
        armadaId: null,
        userId: MEMBER_ID,
        role: FleetScopeRole.OFFICER,
        validFrom: expect.any(Date),
        grantedByUserId: OWNER_ID,
        reason: 'Runs Saturday events',
      });
      expect(entries()).toEqual([
        {
          scope: FLEET,
          action: ScopeGovernanceActionKind.ROLE_ASSIGNED,
          actorUserId: OWNER_ID,
          subjectUserId: MEMBER_ID,
          role: FleetScopeRole.OFFICER,
          reason: 'Runs Saturday events',
        },
      ]);
      expect(bump).toHaveBeenCalledWith(
        FleetScopeKind.FLEET,
        FLEET_ID,
        manager,
      );
    });

    it('advertises a Community appointment at the Community', async () => {
      await appoint(COMMUNITY);

      expect(manager.save).toHaveBeenCalledWith(
        ScopeRoleAssignmentEntity,
        expect.objectContaining({ fleetId: null, reason: null }),
      );
      expect(bump).toHaveBeenCalledWith(
        FleetScopeKind.COMMUNITY,
        COMMUNITY_ID,
        manager,
      );
    });
  });

  describe('withdrawing a role', () => {
    it('requires a reason before touching anything', async () => {
      await expect(
        service.withdraw(FLEET, ASSIGNMENT_ID, '  ', OWNER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(manager.findOne).not.toHaveBeenCalled();
    });

    it('refuses a role that is not held here', async () => {
      await expect(
        service.withdraw(FLEET, ASSIGNMENT_ID, 'Stepped down', OWNER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ends it, keeping the row, and logs why', async () => {
      const assignment = {
        id: ASSIGNMENT_ID,
        userId: ADMIN_ID,
        role: FleetScopeRole.ADMIN,
        validTo: null as Date | null,
      };
      found = assignment;

      await service.withdraw(FLEET, ASSIGNMENT_ID, ' Stepped down ', OWNER_ID);

      expect(assignment.validTo).toBeInstanceOf(Date);
      expect(entries()).toEqual([
        {
          scope: FLEET,
          action: ScopeGovernanceActionKind.ROLE_WITHDRAWN,
          actorUserId: OWNER_ID,
          subjectUserId: ADMIN_ID,
          role: FleetScopeRole.ADMIN,
          reason: 'Stepped down',
        },
      ]);
      // Ownership is offered only at the Community.
      expect(cancelOpenWithin).not.toHaveBeenCalled();
      expect(bump).toHaveBeenCalled();
    });

    // Ownership is offered only to a Community Admin.
    it('cancels an ownership offer to a Community Admin who loses the role', async () => {
      found = { userId: ADMIN_ID, role: FleetScopeRole.ADMIN, validTo: null };

      await service.withdraw(
        COMMUNITY,
        ASSIGNMENT_ID,
        'Stepped down',
        OWNER_ID,
      );

      expect(cancelOpenWithin).toHaveBeenCalledWith(manager, COMMUNITY_ID, {
        actorUserId: OWNER_ID,
        onlyTo: ADMIN_ID,
      });
    });

    it('leaves an offer alone when a Community Officer loses the role', async () => {
      found = {
        userId: MEMBER_ID,
        role: FleetScopeRole.OFFICER,
        validTo: null,
      };

      await service.withdraw(
        COMMUNITY,
        ASSIGNMENT_ID,
        'Stepped down',
        OWNER_ID,
      );

      expect(cancelOpenWithin).not.toHaveBeenCalled();
    });
  });

  describe('what every Officer holds', () => {
    const set = (capabilities: string[], reason?: string) =>
      service.setOfficerCapabilities(FLEET, { capabilities, reason }, OWNER_ID);

    it('refuses a capability that cannot be delegated here', async () => {
      await expect(set(['news.write', 'scope.close'])).rejects.toThrow(
        new BadRequestException('"scope.close" cannot be delegated here.'),
      );
      expect(manager.find).not.toHaveBeenCalled();
    });

    it('changes nothing when nothing changed', async () => {
      grants = [
        { capability: 'news.write', effect: ScopeCapabilityEffect.GRANT },
      ];

      await set(['news.write']);

      expect(manager.save).not.toHaveBeenCalled();
      expect(bump).not.toHaveBeenCalled();
    });

    it('adds capabilities with no reason needed', async () => {
      await set(['news.write', 'news.write', 'events.manage']);

      expect(manager.save).toHaveBeenCalledTimes(2);
      expect(manager.save).toHaveBeenCalledWith(ScopeCapabilityGrantEntity, {
        communityId: COMMUNITY_ID,
        fleetId: FLEET_ID,
        armadaId: null,
        subjectUserId: null,
        subjectRole: FleetScopeRole.OFFICER,
        capability: 'news.write',
        effect: ScopeCapabilityEffect.GRANT,
        validFrom: expect.any(Date),
        grantedByUserId: OWNER_ID,
        reason: null,
      });
      expect(entries()).toContainEqual({
        scope: FLEET,
        action: ScopeGovernanceActionKind.CAPABILITY_GRANTED,
        actorUserId: OWNER_ID,
        role: FleetScopeRole.OFFICER,
        capability: 'events.manage',
        reason: null,
      });
      expect(bump).toHaveBeenCalledTimes(1);
    });

    it('requires a reason to take one away', async () => {
      grants = [
        { capability: 'news.write', effect: ScopeCapabilityEffect.GRANT },
      ];

      await expect(set([])).rejects.toThrow(
        new BadRequestException(
          'Say why Officers here are losing a capability.',
        ),
      );
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('takes one away, keeping its row, and logs why', async () => {
      const grant = {
        capability: 'news.write',
        effect: ScopeCapabilityEffect.GRANT,
        validTo: null as Date | null,
      };
      grants = [grant];

      await set(['events.manage'], ' Too many posts ');

      expect(grant.validTo).toBeInstanceOf(Date);
      expect(entries()).toEqual([
        {
          scope: FLEET,
          action: ScopeGovernanceActionKind.CAPABILITY_CLEARED,
          actorUserId: OWNER_ID,
          role: FleetScopeRole.OFFICER,
          capability: 'news.write',
          clearedEffect: ScopeCapabilityEffect.GRANT,
          reason: 'Too many posts',
        },
        expect.objectContaining({
          action: ScopeGovernanceActionKind.CAPABILITY_GRANTED,
          capability: 'events.manage',
          reason: 'Too many posts',
        }),
      ]);
    });
  });

  describe('one person’s capabilities', () => {
    const set = (
      effect: ScopeCapabilityEffect,
      reason?: string,
      userId = MEMBER_ID,
      capability = 'news.write',
    ) =>
      service.setPersonal(
        FLEET,
        { userId, capability, effect, reason },
        OWNER_ID,
      );

    it('refuses a capability that cannot be delegated here', async () => {
      await expect(
        set(
          ScopeCapabilityEffect.GRANT,
          undefined,
          MEMBER_ID,
          'scope.roles.manage',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires a reason to deny one', async () => {
      await expect(set(ScopeCapabilityEffect.DENY)).rejects.toThrow(
        new BadRequestException('Say why the capability is being denied.'),
      );
    });

    it('refuses the Owner', async () => {
      isOwner = true;

      await expect(set(ScopeCapabilityEffect.GRANT)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('refuses somebody with no standing here', async () => {
      await expect(
        set(ScopeCapabilityEffect.GRANT, undefined, OUTSIDER_ID),
      ).rejects.toThrow(
        new BadRequestException(
          'A capability can only be given to or taken from a member or role holder here.',
        ),
      );
    });

    // A Community Admin may have left every Fleet and still hold the role.
    it('accepts a role holder who is no longer a member', async () => {
      holdsRole = true;

      await set(ScopeCapabilityEffect.GRANT, undefined, OUTSIDER_ID);

      expect(manager.save).toHaveBeenCalledWith(
        ScopeCapabilityGrantEntity,
        expect.objectContaining({ subjectUserId: OUTSIDER_ID }),
      );
    });

    it.each([
      [ScopeCapabilityEffect.GRANT, 'They have been granted that already.'],
      [ScopeCapabilityEffect.DENY, 'They have been denied that already.'],
    ])('refuses to %s what is already so', async (effect, message) => {
      found = { effect };

      await expect(set(effect, 'Because')).rejects.toThrow(
        new ConflictException(message),
      );
    });

    it('grants one, and logs it', async () => {
      await set(ScopeCapabilityEffect.GRANT, ' Covers for the Admin ');

      expect(manager.save).toHaveBeenCalledWith(ScopeCapabilityGrantEntity, {
        communityId: COMMUNITY_ID,
        fleetId: FLEET_ID,
        armadaId: null,
        subjectUserId: MEMBER_ID,
        subjectRole: null,
        capability: 'news.write',
        effect: ScopeCapabilityEffect.GRANT,
        validFrom: expect.any(Date),
        grantedByUserId: OWNER_ID,
        reason: 'Covers for the Admin',
      });
      expect(entries()).toEqual([
        {
          scope: FLEET,
          action: ScopeGovernanceActionKind.CAPABILITY_GRANTED,
          actorUserId: OWNER_ID,
          subjectUserId: MEMBER_ID,
          capability: 'news.write',
          reason: 'Covers for the Admin',
        },
      ]);
    });

    // A denial beats the grant it replaces, and every role.
    it('turns a grant into a denial, ending the grant', async () => {
      const grant = {
        effect: ScopeCapabilityEffect.GRANT,
        validTo: null as Date | null,
      };
      found = grant;

      await set(ScopeCapabilityEffect.DENY, 'Posted spoilers');

      expect(grant.validTo).toBeInstanceOf(Date);
      expect(entries()).toEqual([
        expect.objectContaining({
          action: ScopeGovernanceActionKind.CAPABILITY_DENIED,
          reason: 'Posted spoilers',
        }),
      ]);
    });
  });

  describe('clearing one person’s grant or denial', () => {
    it('refuses one that is not open here', async () => {
      await expect(
        service.clearPersonal(FLEET, GRANT_ID, 'x', OWNER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(manager.findOne).toHaveBeenCalledWith(ScopeCapabilityGrantEntity, {
        where: {
          communityId: COMMUNITY_ID,
          fleetId: FLEET_ID,
          armadaId: IsNull(),
          id: GRANT_ID,
          subjectUserId: Not(IsNull()),
          validTo: IsNull(),
        },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('requires a reason to clear a grant, which takes a power away', async () => {
      found = { effect: ScopeCapabilityEffect.GRANT };

      await expect(
        service.clearPersonal(FLEET, GRANT_ID, undefined, OWNER_ID),
      ).rejects.toThrow(
        new BadRequestException('Say why the capability is being taken away.'),
      );
    });

    it('clears a denial with no reason needed, and logs what was cleared', async () => {
      const denial = {
        subjectUserId: MEMBER_ID,
        capability: 'news.write',
        effect: ScopeCapabilityEffect.DENY,
        validTo: null as Date | null,
      };
      found = denial;

      await service.clearPersonal(FLEET, GRANT_ID, undefined, OWNER_ID);

      expect(denial.validTo).toBeInstanceOf(Date);
      expect(entries()).toEqual([
        {
          scope: FLEET,
          action: ScopeGovernanceActionKind.CAPABILITY_CLEARED,
          actorUserId: OWNER_ID,
          subjectUserId: MEMBER_ID,
          capability: 'news.write',
          clearedEffect: ScopeCapabilityEffect.DENY,
          reason: null,
        },
      ]);
      expect(bump).toHaveBeenCalled();
    });
  });

  it('ends every role and grant at exactly the scope, for a closure, each logged (FC-039)', async () => {
    const now = new Date();

    manager.insert = jest.fn(() => Promise.resolve());
    assignments = [
      {
        id: 'role-1',
        communityId: COMMUNITY_ID,
        fleetId: FLEET_ID,
        armadaId: null,
        userId: MEMBER_ID,
        role: FleetScopeRole.OFFICER,
      },
    ];
    grants = [];

    await service.endAllWithin(manager as unknown as EntityManager, FLEET, now);

    const exactly = {
      communityId: COMMUNITY_ID,
      fleetId: FLEET_ID,
      armadaId: IsNull(),
      validTo: IsNull(),
    };

    expect(manager.find).toHaveBeenCalledWith(ScopeRoleAssignmentEntity, {
      where: exactly,
    });
    expect(manager.find).toHaveBeenCalledWith(ScopeCapabilityGrantEntity, {
      where: exactly,
    });
    expect(manager.update).toHaveBeenCalledWith(
      ScopeRoleAssignmentEntity,
      { id: 'role-1' },
      { validTo: now },
    );
    expect(manager.insert).toHaveBeenCalledWith(
      ScopeGovernanceActionEntity,
      expect.objectContaining({
        action: ScopeGovernanceActionKind.ROLE_WITHDRAWN,
        actorUserId: null,
        subjectUserId: MEMBER_ID,
        reason: ENDED_BY_CLOSURE,
        idempotencyKey: 'ENDED:role-1',
      }),
    );
  });
});
