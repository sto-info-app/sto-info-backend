import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';

import {
  AuthorisationWorld,
  createAuthorisationWorld,
} from '../../../../test/fleet-authorisation-world';
import { FleetAudience } from '../../enums/fleet-audience.enum';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { ScopeCapabilityEffect } from '../../enums/scope-capability-effect.enum';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import { FleetAuthorisationService } from '../fleet-authorisation.service';
import {
  FLEET_CAPABILITIES,
  FleetCapability,
} from '../fleet-capability.constants';
import { ScopeRef } from '../scope-authorisation.interface';

/**
 * The role and audience matrix FC-005 is validated against.
 *
 * Every case here is a situation rather than a call: a described world of
 * Communities, Fleets, Armadas, people and grants, and then the real services
 * asked the real question. Assertions are grouped by the acceptance criterion
 * they belong to, so a failure says which promise broke.
 *
 * The forged-identifier and revoked-grant cases the ticket asks for are in the
 * fourth group and the first respectively.
 */
describe('Fleet authorisation: role and audience matrix', () => {
  const OWNER = 'user-owner';
  const COMMUNITY_ADMIN = 'user-community-admin';
  const FLEET_ADMIN = 'user-fleet-admin';
  const OFFICER = 'user-officer';
  const MEMBER = 'user-member';
  const COMMUNITY_MEMBER = 'user-community-member';
  const FOLLOWER = 'user-follower';
  const STRANGER = 'user-stranger';
  const SUSPENDED = 'user-suspended';
  const PENDING = 'user-pending';
  const DISABLED = 'user-disabled';
  const ARMADA_ADMIN = 'user-armada-admin';
  const RIVAL_OWNER = 'user-rival-owner';

  const COMMUNITY = 'community-1';
  const RIVAL_COMMUNITY = 'community-2';
  const FLEET = 'fleet-1';
  const SIBLING_FLEET = 'fleet-2';
  const RIVAL_FLEET = 'fleet-3';
  const UNREGISTERED_FLEET = 'fleet-0';
  const HELD_FLEET = 'fleet-held';
  const ARMADA = 'armada-1';

  const fleetScope: ScopeRef = { kind: FleetScopeKind.FLEET, id: FLEET };
  const communityScope: ScopeRef = {
    kind: FleetScopeKind.COMMUNITY,
    id: COMMUNITY,
  };
  const armadaScope: ScopeRef = { kind: FleetScopeKind.ARMADA, id: ARMADA };

  let world: AuthorisationWorld;

  /**
   * Builds the standing world every case starts from.
   *
   * @returns The wired services.
   */
  const buildWorld = (): AuthorisationWorld =>
    createAuthorisationWorld({
      users: [
        { id: OWNER, isAccountDisabled: false },
        { id: COMMUNITY_ADMIN, isAccountDisabled: false },
        { id: FLEET_ADMIN, isAccountDisabled: false },
        { id: OFFICER, isAccountDisabled: false },
        { id: MEMBER, isAccountDisabled: false },
        { id: COMMUNITY_MEMBER, isAccountDisabled: false },
        { id: FOLLOWER, isAccountDisabled: false },
        { id: STRANGER, isAccountDisabled: false },
        { id: SUSPENDED, isAccountDisabled: false },
        { id: PENDING, isAccountDisabled: false },
        { id: ARMADA_ADMIN, isAccountDisabled: false },
        { id: RIVAL_OWNER, isAccountDisabled: false },
        { id: DISABLED, isAccountDisabled: true },
      ],
      communities: [
        {
          id: COMMUNITY,
          ownerUserId: OWNER,
          status: FleetScopeStatus.ACTIVE,
          revision: 1,
        },
        {
          id: RIVAL_COMMUNITY,
          ownerUserId: RIVAL_OWNER,
          status: FleetScopeStatus.ACTIVE,
          revision: 1,
        },
      ],
      fleets: [
        {
          id: FLEET,
          communityId: COMMUNITY,
          status: FleetScopeStatus.ACTIVE,
          revision: 1,
        },
        {
          id: SIBLING_FLEET,
          communityId: COMMUNITY,
          status: FleetScopeStatus.ACTIVE,
          revision: 1,
        },
        {
          id: HELD_FLEET,
          communityId: COMMUNITY,
          status: FleetScopeStatus.SUSPENDED,
          revision: 1,
        },
        {
          id: RIVAL_FLEET,
          communityId: RIVAL_COMMUNITY,
          status: FleetScopeStatus.ACTIVE,
          revision: 1,
        },
        // Confirmed as an unregistered observation target: no Community, so
        // nobody owns it and nobody can hold anything on it.
        {
          id: UNREGISTERED_FLEET,
          communityId: null,
          status: FleetScopeStatus.ACTIVE,
          revision: 1,
        },
      ],
      armadas: [
        {
          id: ARMADA,
          communityId: COMMUNITY,
          status: FleetScopeStatus.ACTIVE,
          revision: 1,
        },
      ],
      roles: [
        {
          communityId: COMMUNITY,
          userId: COMMUNITY_ADMIN,
          role: FleetScopeRole.ADMIN,
        },
        {
          communityId: COMMUNITY,
          fleetId: FLEET,
          userId: FLEET_ADMIN,
          role: FleetScopeRole.ADMIN,
        },
        {
          communityId: COMMUNITY,
          fleetId: FLEET,
          userId: OFFICER,
          role: FleetScopeRole.OFFICER,
        },
        {
          communityId: COMMUNITY,
          fleetId: FLEET,
          userId: SUSPENDED,
          role: FleetScopeRole.OFFICER,
        },
        {
          communityId: COMMUNITY,
          armadaId: ARMADA,
          userId: ARMADA_ADMIN,
          role: FleetScopeRole.ADMIN,
        },
      ],
      memberships: [
        {
          communityId: COMMUNITY,
          fleetId: FLEET,
          userId: MEMBER,
          status: ScopeMembershipStatus.APPROVED,
        },
        {
          communityId: COMMUNITY,
          fleetId: FLEET,
          userId: OFFICER,
          status: ScopeMembershipStatus.APPROVED,
        },
        {
          communityId: COMMUNITY,
          userId: COMMUNITY_MEMBER,
          status: ScopeMembershipStatus.APPROVED,
        },
        {
          communityId: COMMUNITY,
          fleetId: FLEET,
          userId: PENDING,
          status: ScopeMembershipStatus.PENDING,
        },
        {
          communityId: COMMUNITY,
          fleetId: FLEET,
          userId: SUSPENDED,
          status: ScopeMembershipStatus.SUSPENDED,
        },
      ],
      grants: [
        // "Officers of this Fleet may import rosters" — the delegation that
        // makes an Officer more than a member.
        {
          communityId: COMMUNITY,
          fleetId: FLEET,
          subjectRole: FleetScopeRole.OFFICER,
          capability: FLEET_CAPABILITIES.ROSTER_IMPORT,
          effect: ScopeCapabilityEffect.GRANT,
        },
        // One member loses one capability without losing their membership.
        {
          communityId: COMMUNITY,
          fleetId: FLEET,
          subjectUserId: MEMBER,
          capability: FLEET_CAPABILITIES.CHAT_POST,
          effect: ScopeCapabilityEffect.DENY,
        },
      ],
      subscriptions: [{ communityId: COMMUNITY, userId: FOLLOWER }],
    });

  /**
   * Resolves somebody's capabilities at a scope, as a sorted array.
   *
   * @param userId - The user, or null when signed out.
   * @param ref - The scope.
   * @returns The capability codes held.
   */
  const capabilitiesOf = async (
    userId: string | null,
    ref: ScopeRef,
  ): Promise<FleetCapability[]> => {
    const authorisation = await world.authorisation.authorise(userId, ref);

    return [...(authorisation?.capabilities ?? [])].sort();
  };

  /** The denial log, silenced so a refusal under test is not also noise. */
  let warn: jest.SpyInstance;

  beforeEach(() => {
    world = buildWorld();
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('AC1: deny and suspension win, and a site-wide capability grants no Fleet access', () => {
    it('lets a DENY grant remove one capability while the membership stands', async () => {
      const held = await capabilitiesOf(MEMBER, fleetScope);
      const authorisation = await world.authorisation.authorise(
        MEMBER,
        fleetScope,
      );

      expect(authorisation?.isApprovedMember).toBe(true);
      expect(held).toContain(FLEET_CAPABILITIES.ROSTER_VIEW);
      expect(held).not.toContain(FLEET_CAPABILITIES.CHAT_POST);
    });

    it('lets a DENY beat a GRANT for the same person and capability', async () => {
      world.rows.grants.push({
        communityId: COMMUNITY,
        fleetId: FLEET,
        armadaId: null,
        subjectUserId: MEMBER,
        subjectRole: null,
        capability: FLEET_CAPABILITIES.CHAT_POST,
        effect: ScopeCapabilityEffect.GRANT,
        validTo: null,
        deletedAt: null,
      });

      expect(await capabilitiesOf(MEMBER, fleetScope)).not.toContain(
        FLEET_CAPABILITIES.CHAT_POST,
      );
    });

    it('lets a DENY at the Fleet beat a GRANT inherited from the Community', async () => {
      world.rows.grants.push(
        {
          communityId: COMMUNITY,
          fleetId: null,
          armadaId: null,
          subjectUserId: MEMBER,
          subjectRole: null,
          capability: FLEET_CAPABILITIES.NEWS_WRITE,
          effect: ScopeCapabilityEffect.GRANT,
          validTo: null,
          deletedAt: null,
        },
        {
          communityId: COMMUNITY,
          fleetId: FLEET,
          armadaId: null,
          subjectUserId: MEMBER,
          subjectRole: null,
          capability: FLEET_CAPABILITIES.NEWS_WRITE,
          effect: ScopeCapabilityEffect.DENY,
          validTo: null,
          deletedAt: null,
        },
      );

      expect(await capabilitiesOf(MEMBER, communityScope)).toContain(
        FLEET_CAPABILITIES.NEWS_WRITE,
      );
      expect(await capabilitiesOf(MEMBER, fleetScope)).not.toContain(
        FLEET_CAPABILITIES.NEWS_WRITE,
      );
    });

    it('withdraws everything from a suspended member, role and all', async () => {
      const authorisation = await world.authorisation.authorise(
        SUSPENDED,
        fleetScope,
      );

      expect(authorisation?.isSuspended).toBe(true);
      expect([...(authorisation?.roles ?? [])]).toEqual([]);
      expect(await capabilitiesOf(SUSPENDED, fleetScope)).toEqual([]);
    });

    it('lets a suspension at the Community reach every Fleet inside it', async () => {
      world.rows.memberships.push({
        communityId: COMMUNITY,
        fleetId: null,
        armadaId: null,
        userId: FLEET_ADMIN,
        status: ScopeMembershipStatus.SUSPENDED,
        deletedAt: null,
      });

      expect(await capabilitiesOf(FLEET_ADMIN, fleetScope)).toEqual([]);
      expect(await capabilitiesOf(FLEET_ADMIN, communityScope)).toEqual([]);
    });

    it('withdraws everything from a disabled account, including the owner', async () => {
      world.rows.communities[0].ownerUserId = DISABLED;

      const authorisation = await world.authorisation.authorise(
        DISABLED,
        communityScope,
      );

      expect(authorisation?.isSuspended).toBe(true);
      expect(await capabilitiesOf(DISABLED, communityScope)).toEqual([]);
    });

    it('treats an unknown user as suspended rather than as an owner', async () => {
      const authorisation = await world.authorisation.authorise(
        'user-never-existed',
        communityScope,
      );

      expect(authorisation?.isSuspended).toBe(true);
      expect(authorisation?.capabilities.size).toBe(0);
    });

    it('stops reading a grant once it has been closed', async () => {
      world.rows.grants[0].validTo = new Date('2026-09-01T00:00:00Z');

      expect(await capabilitiesOf(OFFICER, fleetScope)).not.toContain(
        FLEET_CAPABILITIES.ROSTER_IMPORT,
      );
    });

    it('stops reading a role assignment once it has been closed', async () => {
      world.rows.roles[1].validTo = new Date('2026-09-01T00:00:00Z');

      expect(await capabilitiesOf(FLEET_ADMIN, fleetScope)).toEqual([]);
    });

    /**
     * The strongest form of "a global capability does not grant all-Fleet
     * access" is that the policy cannot read a global capability at all. A
     * behavioural test can only show that one particular site-wide permission
     * did not leak; this shows there is no wire for one to leak along.
     */
    it('depends on nothing in the site-wide permission framework', () => {
      const imported = serviceImports();

      expect(imported.length).toBeGreaterThan(0);
      for (const module of imported) {
        expect(module).not.toMatch(/access-control|permission|user-role/i);
      }
    });

    it('gives a signed-in stranger nothing anywhere', async () => {
      expect(await capabilitiesOf(STRANGER, fleetScope)).toEqual([]);
      expect(await capabilitiesOf(STRANGER, communityScope)).toEqual([]);
      expect(await capabilitiesOf(STRANGER, armadaScope)).toEqual([]);
    });

    it('gives an anonymous caller nothing, without calling them suspended', async () => {
      const authorisation = await world.authorisation.authorise(
        null,
        fleetScope,
      );

      expect(authorisation?.capabilities.size).toBe(0);
      expect(authorisation?.isSuspended).toBe(false);
      expect(authorisation?.userId).toBeNull();
    });
  });

  describe('AC2: following and roster evidence grant no membership', () => {
    it('gives a Community follower no capability and no membership', async () => {
      const authorisation = await world.authorisation.authorise(
        FOLLOWER,
        communityScope,
      );

      expect(authorisation?.isApprovedMember).toBe(false);
      expect(authorisation?.membershipStatus).toBeNull();
      expect(authorisation?.capabilities.size).toBe(0);
      expect(await capabilitiesOf(FOLLOWER, fleetScope)).toEqual([]);
    });

    it('lets a follower see Community content and not the private roster', async () => {
      await expect(
        world.audience.canView(
          FleetAudience.COMMUNITY,
          communityScope,
          FOLLOWER,
        ),
      ).resolves.toBe(true);
      await expect(
        world.audience.canView(
          FleetAudience.FLEET_MEMBERS,
          fleetScope,
          FOLLOWER,
        ),
      ).resolves.toBe(false);
    });

    it('does not let an approved Community membership open a Fleet roster', async () => {
      const atCommunity = await world.authorisation.authorise(
        COMMUNITY_MEMBER,
        communityScope,
      );

      expect(atCommunity?.isApprovedMember).toBe(true);
      expect(await capabilitiesOf(COMMUNITY_MEMBER, fleetScope)).toEqual([]);
      await expect(
        world.audience.canView(
          FleetAudience.FLEET_MEMBERS,
          fleetScope,
          COMMUNITY_MEMBER,
        ),
      ).resolves.toBe(false);
    });

    it('gives a pending applicant nothing while their request stands', async () => {
      const authorisation = await world.authorisation.authorise(
        PENDING,
        fleetScope,
      );

      expect(authorisation?.membershipStatus).toBe(
        ScopeMembershipStatus.PENDING,
      );
      expect(authorisation?.isApprovedMember).toBe(false);
      expect(authorisation?.capabilities.size).toBe(0);
    });

    it.each([
      ScopeMembershipStatus.REJECTED,
      ScopeMembershipStatus.LEFT,
      ScopeMembershipStatus.REVOKED,
    ])('gives a %s membership nothing', async status => {
      world.rows.memberships.push({
        communityId: COMMUNITY,
        fleetId: FLEET,
        armadaId: null,
        userId: STRANGER,
        status,
        deletedAt: null,
      });

      expect(await capabilitiesOf(STRANGER, fleetScope)).toEqual([]);
    });

    /**
     * ADR-0002. A roster row naming a Character is evidence that somebody was
     * in a Fleet in the game; it is not a statement about an STO Info account,
     * and a Guild Rank in a CSV is a label somebody typed in a game client. The
     * policy proves this by having no way to read either — the repositories it
     * is constructed with are the whole of what it can see.
     */
    it('depends on no roster, import or Character record', () => {
      const imported = serviceImports();

      expect(imported.length).toBeGreaterThan(0);
      for (const module of imported) {
        expect(module).not.toMatch(/roster|character|import-|\/import/i);
      }
    });

    it('is constructed with exactly the repositories the policy needs', () => {
      const injected: unknown[] =
        Reflect.getMetadata('design:paramtypes', FleetAuthorisationService) ??
        [];

      // Seven repositories and the request-scoped store. A roster repository
      // appearing here would be the change this test exists to catch.
      expect(injected).toHaveLength(8);
    });
  });

  describe('AC3: Officer capabilities are delegated, never assumed', () => {
    it('gives an Officer nothing beyond the approved-member baseline', async () => {
      const held = await capabilitiesOf(OFFICER, fleetScope);

      expect(held).toContain(FLEET_CAPABILITIES.ROSTER_VIEW);
      expect(held).toContain(FLEET_CAPABILITIES.CHAT_POST);
      expect(held).not.toContain(FLEET_CAPABILITIES.APPLICATIONS_DECIDE);
      expect(held).not.toContain(FLEET_CAPABILITIES.NEWS_WRITE);
      expect(held).not.toContain(FLEET_CAPABILITIES.CHAT_MODERATE);
      expect(held).not.toContain(FLEET_CAPABILITIES.CHAT_TRANSCRIPT_EXPORT);
    });

    it('gives an Officer exactly what has been delegated to the label', async () => {
      expect(await capabilitiesOf(OFFICER, fleetScope)).toContain(
        FLEET_CAPABILITIES.ROSTER_IMPORT,
      );
    });

    it('leaves an Officer with no role at another Fleet unaffected by that delegation', async () => {
      world.rows.roles.push({
        communityId: COMMUNITY,
        fleetId: SIBLING_FLEET,
        armadaId: null,
        userId: OFFICER,
        role: FleetScopeRole.OFFICER,
        validTo: null,
        deletedAt: null,
      });

      expect(await capabilitiesOf(OFFICER, SIBLING())).not.toContain(
        FLEET_CAPABILITIES.ROSTER_IMPORT,
      );
    });

    it('delegates to one person without widening the label', async () => {
      world.rows.grants.push({
        communityId: COMMUNITY,
        fleetId: FLEET,
        armadaId: null,
        subjectUserId: OFFICER,
        subjectRole: null,
        capability: FLEET_CAPABILITIES.CHAT_TRANSCRIPT_EXPORT,
        effect: ScopeCapabilityEffect.GRANT,
        validTo: null,
        deletedAt: null,
      });
      world.rows.roles.push({
        communityId: COMMUNITY,
        fleetId: FLEET,
        armadaId: null,
        userId: STRANGER,
        role: FleetScopeRole.OFFICER,
        validTo: null,
        deletedAt: null,
      });

      expect(await capabilitiesOf(OFFICER, fleetScope)).toContain(
        FLEET_CAPABILITIES.CHAT_TRANSCRIPT_EXPORT,
      );
      expect(await capabilitiesOf(STRANGER, fleetScope)).not.toContain(
        FLEET_CAPABILITIES.CHAT_TRANSCRIPT_EXPORT,
      );
    });

    it('ignores a role-subject grant for a label the user does not hold', async () => {
      world.rows.grants.push({
        communityId: COMMUNITY,
        fleetId: FLEET,
        armadaId: null,
        subjectUserId: null,
        subjectRole: FleetScopeRole.ADMIN,
        capability: FLEET_CAPABILITIES.SCOPE_SETTINGS_MANAGE,
        effect: ScopeCapabilityEffect.GRANT,
        validTo: null,
        deletedAt: null,
      });

      expect(await capabilitiesOf(OFFICER, fleetScope)).not.toContain(
        FLEET_CAPABILITIES.SCOPE_SETTINGS_MANAGE,
      );
      expect(await capabilitiesOf(FLEET_ADMIN, fleetScope)).toContain(
        FLEET_CAPABILITIES.SCOPE_SETTINGS_MANAGE,
      );
    });

    it('confers nothing for a capability code it no longer recognises', async () => {
      world.rows.grants.push({
        communityId: COMMUNITY,
        fleetId: FLEET,
        armadaId: null,
        subjectUserId: OFFICER,
        subjectRole: null,
        capability: 'roster.teleport',
        effect: ScopeCapabilityEffect.GRANT,
        validTo: null,
        deletedAt: null,
      });

      expect(await capabilitiesOf(OFFICER, fleetScope)).not.toContain(
        'roster.teleport' as FleetCapability,
      );
    });

    it('denies nothing for a capability code it no longer recognises', async () => {
      world.rows.grants.push({
        communityId: COMMUNITY,
        fleetId: FLEET,
        armadaId: null,
        subjectUserId: OFFICER,
        subjectRole: null,
        capability: 'roster.view.old',
        effect: ScopeCapabilityEffect.DENY,
        validTo: null,
        deletedAt: null,
      });

      expect(await capabilitiesOf(OFFICER, fleetScope)).toContain(
        FLEET_CAPABILITIES.ROSTER_VIEW,
      );
    });

    /**
     * Plan section 4.3 lists settings, delegation, transfer and closure under
     * Owner and none of them under Admin. Settings being absent is the one that
     * looks like an oversight and is not: an Admin who could change settings
     * could change the recruitment and visibility of a Fleet they do not own.
     */
    it('gives an Admin everything short of ownership', async () => {
      const held = await capabilitiesOf(FLEET_ADMIN, fleetScope);

      expect(held).toContain(FLEET_CAPABILITIES.APPLICATIONS_DECIDE);
      expect(held).toContain(FLEET_CAPABILITIES.ROSTER_IMPORT);
      expect(held).toContain(FLEET_CAPABILITIES.CHAT_MODERATE);
      expect(held).not.toContain(FLEET_CAPABILITIES.SCOPE_SETTINGS_MANAGE);
      expect(held).not.toContain(FLEET_CAPABILITIES.SCOPE_OWNERSHIP_TRANSFER);
      expect(held).not.toContain(FLEET_CAPABILITIES.SCOPE_CLOSE);
      expect(held).not.toContain(FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE);
    });

    it('makes the Community owner Owner everywhere in their Community', async () => {
      for (const ref of [communityScope, fleetScope, armadaScope]) {
        const authorisation = await world.authorisation.authorise(OWNER, ref);

        expect([...(authorisation?.roles ?? [])]).toEqual([
          FleetScopeRole.OWNER,
        ]);
        expect(
          authorisation?.capabilities.has(
            FLEET_CAPABILITIES.SCOPE_OWNERSHIP_TRANSFER,
          ),
        ).toBe(true);
      }
    });
  });

  describe('AC4: own, sibling and cross-community checks use one policy', () => {
    it('does not let a Fleet role reach a sibling Fleet', async () => {
      expect(await capabilitiesOf(FLEET_ADMIN, fleetScope)).not.toEqual([]);
      expect(await capabilitiesOf(FLEET_ADMIN, SIBLING())).toEqual([]);
    });

    it('does not let an Armada role reach the Fleets placed in it', async () => {
      expect(await capabilitiesOf(ARMADA_ADMIN, armadaScope)).toContain(
        FLEET_CAPABILITIES.ARMADA_MANAGE,
      );
      expect(await capabilitiesOf(ARMADA_ADMIN, fleetScope)).toEqual([]);
    });

    it('does not let a Fleet role reach the Armada', async () => {
      expect(await capabilitiesOf(FLEET_ADMIN, armadaScope)).toEqual([]);
    });

    it('lets a Community role reach both Fleets and Armadas', async () => {
      expect(await capabilitiesOf(COMMUNITY_ADMIN, fleetScope)).toContain(
        FLEET_CAPABILITIES.ROSTER_IMPORT,
      );
      expect(await capabilitiesOf(COMMUNITY_ADMIN, SIBLING())).toContain(
        FLEET_CAPABILITIES.ROSTER_IMPORT,
      );
      expect(await capabilitiesOf(COMMUNITY_ADMIN, armadaScope)).toContain(
        FLEET_CAPABILITIES.ARMADA_MANAGE,
      );
    });

    it('gives an owner nothing in another Community', async () => {
      expect(
        await capabilitiesOf(OWNER, {
          kind: FleetScopeKind.FLEET,
          id: RIVAL_FLEET,
        }),
      ).toEqual([]);
    });

    it('refuses a Fleet identifier forged into another Community route', async () => {
      await expect(
        world.authorisation.resolveScope({
          kind: FleetScopeKind.FLEET,
          id: RIVAL_FLEET,
          withinCommunityId: COMMUNITY,
        }),
      ).resolves.toBeNull();
    });

    it('refuses an Armada identifier forged into another Community route', async () => {
      await expect(
        world.authorisation.resolveScope({
          kind: FleetScopeKind.ARMADA,
          id: ARMADA,
          withinCommunityId: RIVAL_COMMUNITY,
        }),
      ).resolves.toBeNull();
    });

    it('refuses a Community identifier that contradicts the route', async () => {
      await expect(
        world.authorisation.resolveScope({
          kind: FleetScopeKind.COMMUNITY,
          id: COMMUNITY,
          withinCommunityId: RIVAL_COMMUNITY,
        }),
      ).resolves.toBeNull();
    });

    it('accepts a nested route whose Community is the right one', async () => {
      const scope = await world.authorisation.resolveScope({
        kind: FleetScopeKind.FLEET,
        id: FLEET,
        withinCommunityId: COMMUNITY,
      });

      expect(scope?.communityId).toBe(COMMUNITY);
    });

    it('reports a forged identifier as absent rather than forbidden', async () => {
      await expect(
        world.authorisation.assertCapability(
          OWNER,
          {
            kind: FleetScopeKind.FLEET,
            id: RIVAL_FLEET,
            withinCommunityId: COMMUNITY,
          },
          FLEET_CAPABILITIES.ROSTER_VIEW,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reports a scope that exists but is closed to the caller as forbidden', async () => {
      await expect(
        world.authorisation.assertCapability(
          STRANGER,
          fleetScope,
          FLEET_CAPABILITIES.ROSTER_VIEW,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('names an anonymous caller when it refuses them', async () => {
      await expect(
        world.authorisation.assertCapability(
          null,
          fleetScope,
          FLEET_CAPABILITIES.ROSTER_VIEW,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('anonymous'));
    });

    // An Officer here was delegated imports and not investigation.
    it('accepts any one of several alternatives', async () => {
      const authorisation = await world.authorisation.assertCapability(
        OFFICER,
        fleetScope,
        [
          FLEET_CAPABILITIES.ROSTER_INVESTIGATE,
          FLEET_CAPABILITIES.ROSTER_IMPORT,
        ],
      );

      expect(authorisation.scope.id).toBe(FLEET);
    });

    it('refuses somebody holding none of the alternatives, naming them all', async () => {
      await expect(
        world.authorisation.assertCapability(MEMBER, fleetScope, [
          FLEET_CAPABILITIES.ROSTER_IMPORT,
          FLEET_CAPABILITIES.ROSTER_INVESTIGATE,
        ]),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "lacks 'roster.import' or 'roster.investigate'",
        ),
      );
    });

    it('returns the authorisation when the capability is held', async () => {
      const authorisation = await world.authorisation.assertCapability(
        OWNER,
        fleetScope,
        FLEET_CAPABILITIES.ROSTER_VIEW,
      );

      expect(authorisation.scope.id).toBe(FLEET);
    });

    it('does not resolve a Fleet held only as an unregistered observation target', async () => {
      const ref = { kind: FleetScopeKind.FLEET, id: UNREGISTERED_FLEET };

      await expect(world.authorisation.resolveScope(ref)).resolves.toBeNull();
      await expect(
        world.authorisation.authorise(OWNER, ref),
      ).resolves.toBeNull();
      await expect(
        world.authorisation.hasCapability(
          OWNER,
          ref,
          FLEET_CAPABILITIES.ROSTER_VIEW,
        ),
      ).resolves.toBe(false);
    });

    it('does not resolve a scope whose Community has been deleted', async () => {
      world.rows.communities[0].deletedAt = new Date('2026-09-01T00:00:00Z');

      await expect(
        world.authorisation.resolveScope(fleetScope),
      ).resolves.toBeNull();
    });

    it.each([
      [FleetScopeKind.COMMUNITY, 'community-missing'],
      [FleetScopeKind.FLEET, 'fleet-missing'],
      [FleetScopeKind.ARMADA, 'armada-missing'],
    ])('does not resolve a %s that does not exist', async (kind, id) => {
      await expect(
        world.authorisation.resolveScope({ kind, id }),
      ).resolves.toBeNull();
    });
  });

  describe('scope lifecycle', () => {
    const heldFleet: ScopeRef = { kind: FleetScopeKind.FLEET, id: HELD_FLEET };

    it('keeps reading capabilities and withdraws writing ones when a scope is held', async () => {
      const held = await capabilitiesOf(OWNER, heldFleet);

      expect(held).toContain(FLEET_CAPABILITIES.ROSTER_VIEW);
      expect(held).toContain(FLEET_CAPABILITIES.REPORTS_VIEW);
      expect(held).not.toContain(FLEET_CAPABILITIES.ROSTER_IMPORT);
      expect(held).not.toContain(FLEET_CAPABILITIES.NEWS_WRITE);
      expect(held).not.toContain(FLEET_CAPABILITIES.SCOPE_CLOSE);
    });

    it('lets a closed Community close everything inside it', async () => {
      world.rows.communities[0].status = FleetScopeStatus.CLOSED;

      const scope = await world.authorisation.resolveScope(fleetScope);

      expect(scope?.status).toBe(FleetScopeStatus.ACTIVE);
      expect(scope?.effectiveStatus).toBe(FleetScopeStatus.CLOSED);
      expect(await capabilitiesOf(OWNER, fleetScope)).not.toContain(
        FLEET_CAPABILITIES.NEWS_WRITE,
      );
    });

    it('keeps a held Fleet held inside an active Community', async () => {
      const scope = await world.authorisation.resolveScope(heldFleet);

      expect(scope?.effectiveStatus).toBe(FleetScopeStatus.SUSPENDED);
    });

    it('never confers a capability the scope kind cannot carry', async () => {
      expect(await capabilitiesOf(OWNER, fleetScope)).not.toContain(
        FLEET_CAPABILITIES.ARMADA_MANAGE,
      );
      expect(await capabilitiesOf(OWNER, armadaScope)).not.toContain(
        FLEET_CAPABILITIES.ROSTER_VIEW,
      );
    });
  });

  describe('audience matrix', () => {
    const cases: Array<{
      name: string;
      audience: FleetAudience;
      viewer: string | null;
      ref: ScopeRef;
      expected: boolean;
    }> = [
      {
        name: 'public content is visible to a signed-out visitor',
        audience: FleetAudience.PUBLIC,
        viewer: null,
        ref: fleetScope,
        expected: true,
      },
      {
        name: 'public content is visible to a signed-in stranger',
        audience: FleetAudience.PUBLIC,
        viewer: STRANGER,
        ref: fleetScope,
        expected: true,
      },
      {
        name: 'Community content is hidden from a signed-out visitor',
        audience: FleetAudience.COMMUNITY,
        viewer: null,
        ref: communityScope,
        expected: false,
      },
      {
        name: 'Community content is visible to a follower',
        audience: FleetAudience.COMMUNITY,
        viewer: FOLLOWER,
        ref: communityScope,
        expected: true,
      },
      {
        name: "a Fleet's Community content is visible to a follower of its Community",
        audience: FleetAudience.COMMUNITY,
        viewer: FOLLOWER,
        ref: fleetScope,
        expected: true,
      },
      {
        name: 'Community content is hidden from a stranger',
        audience: FleetAudience.COMMUNITY,
        viewer: STRANGER,
        ref: communityScope,
        expected: false,
      },
      {
        name: 'Community content is visible to an approved Fleet member',
        audience: FleetAudience.COMMUNITY,
        viewer: MEMBER,
        ref: fleetScope,
        expected: true,
      },
      {
        name: 'Community content is visible to a Community Admin',
        audience: FleetAudience.COMMUNITY,
        viewer: COMMUNITY_ADMIN,
        ref: fleetScope,
        expected: true,
      },
      {
        name: 'Community content is hidden from a suspended member',
        audience: FleetAudience.COMMUNITY,
        viewer: SUSPENDED,
        ref: fleetScope,
        expected: false,
      },
      {
        name: 'member-only content is visible to an approved member',
        audience: FleetAudience.FLEET_MEMBERS,
        viewer: MEMBER,
        ref: fleetScope,
        expected: true,
      },
      {
        name: 'member-only content is visible to an Officer of the Fleet',
        audience: FleetAudience.FLEET_MEMBERS,
        viewer: OFFICER,
        ref: fleetScope,
        expected: true,
      },
      {
        name: 'member-only content is hidden from a Community follower',
        audience: FleetAudience.FLEET_MEMBERS,
        viewer: FOLLOWER,
        ref: fleetScope,
        expected: false,
      },
      {
        name: 'member-only content is hidden from an approved Community member',
        audience: FleetAudience.FLEET_MEMBERS,
        viewer: COMMUNITY_MEMBER,
        ref: fleetScope,
        expected: false,
      },
      {
        name: 'member-only content is visible to a Community Admin',
        audience: FleetAudience.FLEET_MEMBERS,
        viewer: COMMUNITY_ADMIN,
        ref: fleetScope,
        expected: true,
      },
      {
        name: "member-only content is hidden from another Fleet's member",
        audience: FleetAudience.FLEET_MEMBERS,
        viewer: MEMBER,
        ref: SIBLING(),
        expected: false,
      },
      {
        name: 'member-only content is hidden from a signed-out visitor',
        audience: FleetAudience.FLEET_MEMBERS,
        viewer: null,
        ref: fleetScope,
        expected: false,
      },
      {
        name: 'private content is visible to the Community owner',
        audience: FleetAudience.PRIVATE,
        viewer: OWNER,
        ref: fleetScope,
        expected: true,
      },
      {
        name: 'private content is hidden from a Community Admin',
        audience: FleetAudience.PRIVATE,
        viewer: COMMUNITY_ADMIN,
        ref: fleetScope,
        expected: false,
      },
      {
        name: 'private content is hidden from an approved member',
        audience: FleetAudience.PRIVATE,
        viewer: MEMBER,
        ref: fleetScope,
        expected: false,
      },
      {
        name: 'private content is hidden from a signed-out visitor',
        audience: FleetAudience.PRIVATE,
        viewer: null,
        ref: fleetScope,
        expected: false,
      },
    ];

    it.each(cases)('$name', async ({ audience, viewer, ref, expected }) => {
      await expect(world.audience.canView(audience, ref, viewer)).resolves.toBe(
        expected,
      );
    });

    it('treats content in an unresolvable scope as invisible', async () => {
      await expect(
        world.audience.canView(
          FleetAudience.COMMUNITY,
          { kind: FleetScopeKind.FLEET, id: UNREGISTERED_FLEET },
          OWNER,
        ),
      ).resolves.toBe(false);
    });

    it('reports content the viewer may not see as absent', async () => {
      await expect(
        world.audience.assertCanView(
          FleetAudience.FLEET_MEMBERS,
          fleetScope,
          FOLLOWER,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('raises nothing when the viewer may see it', async () => {
      await expect(
        world.audience.assertCanView(
          FleetAudience.FLEET_MEMBERS,
          fleetScope,
          MEMBER,
        ),
      ).resolves.toBeUndefined();
    });

    it('counts somebody who left the Community as no longer following', async () => {
      world.rows.subscriptions[0].leftAt = new Date('2026-09-01T00:00:00Z');

      await expect(
        world.audience.canView(
          FleetAudience.COMMUNITY,
          communityScope,
          FOLLOWER,
        ),
      ).resolves.toBe(false);
    });
  });

  /**
   * Returns the Fleet scope named as a reference.
   *
   * Written as a function rather than a constant so it can be used inside the
   * `it.each` table, which is built before `beforeEach` has run.
   *
   * @returns The sibling Fleet's scope reference.
   */
  function SIBLING(): ScopeRef {
    return { kind: FleetScopeKind.FLEET, id: SIBLING_FLEET };
  }

  /**
   * Lists the modules the policy service imports.
   *
   * Two acceptance criteria are about what the policy *cannot* consult, which
   * is a property of its dependencies rather than of any one call. Reading the
   * import statements rather than the whole file keeps the assertion about the
   * code and away from the prose, which discusses rosters at length precisely
   * because it does not read them.
   *
   * @returns The imported module specifiers.
   */
  function serviceImports(): string[] {
    const source = readFileSync(
      join(__dirname, '..', 'fleet-authorisation.service.ts'),
      'utf8',
    );

    return [...source.matchAll(/^import[^;]*?from '([^']+)';$/gm)].map(
      match => match[1],
    );
  }
});
