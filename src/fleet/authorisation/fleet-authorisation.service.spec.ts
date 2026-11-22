import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';

import {
  AuthorisationWorld,
  createAuthorisationWorld,
} from '../../../test/fleet-authorisation-world';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../enums/fleet-scope-role.enum';
import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';
import { ScopeMembershipStatus } from '../enums/scope-membership-status.enum';
import { FLEET_CAPABILITIES } from './fleet-capability.constants';
import { ScopeRef } from './scope-authorisation.interface';

/**
 * The per-request memoisation, which the matrix spec deliberately runs without.
 *
 * Memoisation is the one part of the policy whose behaviour depends on the
 * request rather than on the rows, so it is tested where the rows are held
 * still and the request context is the variable.
 */
describe('FleetAuthorisationService memoisation', () => {
  const COMMUNITY = 'community-1';
  const FLEET = 'fleet-1';
  const SIBLING = 'fleet-2';
  const USER = 'user-1';

  const communityRef = { kind: FleetScopeKind.COMMUNITY, id: COMMUNITY };
  const fleetRef = { kind: FleetScopeKind.FLEET, id: FLEET };

  /**
   * Builds a world in which the user owns the Community.
   *
   * @param clsActive - Whether a request context is active.
   * @returns The wired services and rows.
   */
  const buildWorld = (clsActive: boolean) =>
    createAuthorisationWorld(
      {
        users: [{ id: USER, isAccountDisabled: false }],
        communities: [
          {
            id: COMMUNITY,
            ownerUserId: USER,
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
            id: SIBLING,
            communityId: COMMUNITY,
            status: FleetScopeStatus.ACTIVE,
            revision: 1,
          },
        ],
      },
      clsActive,
    );

  it('answers a repeated question from the request rather than the rows', async () => {
    const world = buildWorld(true);

    await world.authorisation.authorise(USER, fleetRef);
    world.rows.communities[0].ownerUserId = 'somebody-else';

    const again = await world.authorisation.authorise(USER, fleetRef);

    expect(again?.capabilities.has(FLEET_CAPABILITIES.ROSTER_VIEW)).toBe(true);
  });

  it('re-reads the rows when there is no request context', async () => {
    const world = buildWorld(false);

    await world.authorisation.authorise(USER, fleetRef);
    world.rows.communities[0].ownerUserId = 'somebody-else';

    const again = await world.authorisation.authorise(USER, fleetRef);

    expect(again?.capabilities.size).toBe(0);
  });

  it('keeps one scope’s answer out of another’s', async () => {
    const world = buildWorld(true);

    await world.authorisation.authorise(USER, fleetRef);
    world.rows.communities[0].ownerUserId = 'somebody-else';

    const sibling = await world.authorisation.authorise(USER, {
      kind: FleetScopeKind.FLEET,
      id: SIBLING,
    });

    expect(sibling?.capabilities.size).toBe(0);
  });

  /**
   * The same Fleet reached through a nested route is a different question: one
   * of the two answers is "and it is in that Community", and serving it for the
   * other would make the Community segment decorative again.
   */
  it('keeps a nested-route answer out of a bare one', async () => {
    const world = buildWorld(true);

    await world.authorisation.authorise(USER, fleetRef);

    await expect(
      world.authorisation.authorise(USER, {
        ...fleetRef,
        withinCommunityId: 'community-other',
      }),
    ).resolves.toBeNull();
  });

  it('memoises an anonymous answer separately from a signed-in one', async () => {
    const world = buildWorld(true);

    const anonymous = await world.authorisation.authorise(null, fleetRef);
    const signedIn = await world.authorisation.authorise(USER, fleetRef);

    expect(anonymous?.capabilities.size).toBe(0);
    expect(signedIn?.capabilities.size).toBeGreaterThan(0);
  });

  it('does not memoise a scope that did not resolve', async () => {
    const world = buildWorld(true);
    const ref = { kind: FleetScopeKind.FLEET, id: 'fleet-missing' };

    await expect(world.authorisation.authorise(USER, ref)).resolves.toBeNull();

    world.rows.fleets.push({
      id: 'fleet-missing',
      communityId: COMMUNITY,
      status: FleetScopeStatus.ACTIVE,
      revision: 1,
      deletedAt: null,
    });

    await expect(
      world.authorisation.authorise(USER, ref),
    ).resolves.not.toBeNull();
  });

  it('forgets an answer when the scope is invalidated', async () => {
    const world = buildWorld(true);

    await world.authorisation.authorise(USER, fleetRef);
    world.rows.communities[0].ownerUserId = 'somebody-else';
    world.authorisation.invalidate(FleetScopeKind.FLEET, FLEET);

    const again = await world.authorisation.authorise(USER, fleetRef);

    expect(again?.capabilities.size).toBe(0);
  });

  it('shrugs at an invalidation for a scope nobody asked about', async () => {
    const world = buildWorld(true);

    await world.authorisation.authorise(USER, communityRef);

    expect(() =>
      world.authorisation.invalidate(FleetScopeKind.FLEET, FLEET),
    ).not.toThrow();
  });

  it('shrugs at an invalidation before any question has been asked', () => {
    const world = buildWorld(true);

    expect(() =>
      world.authorisation.invalidate(FleetScopeKind.FLEET, FLEET),
    ).not.toThrow();
  });

  it('shrugs at an invalidation outside a request', () => {
    const world = buildWorld(false);

    expect(() =>
      world.authorisation.invalidate(FleetScopeKind.FLEET, FLEET),
    ).not.toThrow();
  });
});

/**
 * FC-043: the policy's edges a targeted mutation run found untested. Each
 * asks the real service a question whose answer would change if a rule were
 * loosened.
 */
describe('FleetAuthorisationService edges', () => {
  const COMMUNITY = 'community-1';
  const OTHER_COMMUNITY = 'community-2';
  const FLEET = 'fleet-1';
  const ARMADA = 'armada-1';
  const SIBLING_ARMADA = 'armada-2';
  const OWNER = 'user-owner';
  const USER = 'user-1';

  const communityRef: ScopeRef = {
    kind: FleetScopeKind.COMMUNITY,
    id: COMMUNITY,
  };
  const fleetRef: ScopeRef = { kind: FleetScopeKind.FLEET, id: FLEET };
  const armadaRef: ScopeRef = { kind: FleetScopeKind.ARMADA, id: ARMADA };

  /**
   * A Community with one Fleet placed in one of its two Armadas, and a user
   * holding whatever a test adds.
   *
   * @param clsActive - Whether a request context is active.
   * @returns The world.
   */
  const buildWorld = (clsActive = false): AuthorisationWorld =>
    createAuthorisationWorld(
      {
        users: [
          { id: OWNER, isAccountDisabled: false },
          { id: USER, isAccountDisabled: false },
        ],
        communities: [COMMUNITY, OTHER_COMMUNITY].map(id => ({
          id,
          ownerUserId: OWNER,
          status: FleetScopeStatus.ACTIVE,
          visibility: FleetAudience.PUBLIC,
          revision: 1,
        })),
        fleets: [
          {
            id: FLEET,
            communityId: COMMUNITY,
            status: FleetScopeStatus.ACTIVE,
            visibility: FleetAudience.PUBLIC,
            revision: 1,
          },
        ],
        armadas: [ARMADA, SIBLING_ARMADA].map(id => ({
          id,
          communityId: COMMUNITY,
          status: FleetScopeStatus.ACTIVE,
          revision: 1,
        })),
        placements: [
          { communityId: COMMUNITY, armadaId: ARMADA, fleetId: FLEET },
        ],
      },
      clsActive,
    );

  describe('refusing', () => {
    it('reports a scope that does not resolve as plainly not found', async () => {
      await expect(
        buildWorld().authorisation.assertCapability(
          USER,
          { kind: FleetScopeKind.FLEET, id: 'fleet-missing' },
          FLEET_CAPABILITIES.ROSTER_VIEW,
        ),
      ).rejects.toThrow(new NotFoundException('Not found'));
    });

    it('refuses a capability without saying which, and logs who asked', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      try {
        await expect(
          buildWorld().authorisation.assertCapability(
            null,
            fleetRef,
            FLEET_CAPABILITIES.ROSTER_VIEW,
          ),
        ).rejects.toThrow(new ForbiddenException('Insufficient permissions'));
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('user anonymous lacks'),
        );
      } finally {
        warn.mockRestore();
      }
    });
  });

  it('resolves a Community a route names inside itself', async () => {
    await expect(
      buildWorld().authorisation.authorise(OWNER, {
        ...communityRef,
        withinCommunityId: COMMUNITY,
      }),
    ).resolves.not.toBeNull();
  });

  it('counts a signed-out visitor as nobody’s member', async () => {
    const authorisation = await buildWorld().authorisation.authorise(
      null,
      fleetRef,
    );

    expect(authorisation).toMatchObject({
      isApprovedMember: false,
      isSuspended: false,
      membershipStatus: null,
    });
  });

  it.each([
    ScopeMembershipStatus.PENDING,
    ScopeMembershipStatus.REJECTED,
    ScopeMembershipStatus.LEFT,
  ])(
    'makes nobody an Armada member through a %s membership of a placed Fleet',
    async status => {
      const world = buildWorld();

      world.rows.memberships.push({
        communityId: COMMUNITY,
        fleetId: FLEET,
        armadaId: null,
        userId: USER,
        status,
        deletedAt: null,
      });

      const authorisation = await world.authorisation.authorise(
        USER,
        armadaRef,
      );

      expect(authorisation?.membershipStatus).toBeNull();
      expect(authorisation?.isApprovedMember).toBe(false);
    },
  );

  describe('where a role reaches', () => {
    /**
     * Adds an Officer appointment.
     *
     * @param world - The world.
     * @param where - The Fleet or Armada it names.
     */
    const appoint = (
      world: AuthorisationWorld,
      where: { fleetId?: string; armadaId?: string },
    ): void => {
      world.rows.roles.push({
        communityId: COMMUNITY,
        fleetId: null,
        armadaId: null,
        ...where,
        userId: USER,
        role: FleetScopeRole.OFFICER,
        validTo: null,
        deletedAt: null,
      });
    };

    /**
     * The roles the user holds at a scope.
     *
     * @param world - The world.
     * @param ref - The scope.
     * @returns The role labels.
     */
    const rolesAt = async (
      world: AuthorisationWorld,
      ref: ScopeRef,
    ): Promise<FleetScopeRole[]> => [
      ...((await world.authorisation.authorise(USER, ref))?.roles ?? []),
    ];

    it('keeps an Armada Officer an Officer of that Armada alone', async () => {
      const world = buildWorld();

      appoint(world, { armadaId: ARMADA });

      expect(await rolesAt(world, armadaRef)).toEqual([FleetScopeRole.OFFICER]);
      expect(
        await rolesAt(world, {
          kind: FleetScopeKind.ARMADA,
          id: SIBLING_ARMADA,
        }),
      ).toEqual([]);
      expect(await rolesAt(world, communityRef)).toEqual([]);
      expect(await rolesAt(world, fleetRef)).toEqual([]);
    });

    it('gives a Fleet Officer nothing at the Community', async () => {
      const world = buildWorld();

      appoint(world, { fleetId: FLEET });

      const atCommunity = await world.authorisation.authorise(
        USER,
        communityRef,
      );

      expect(await rolesAt(world, fleetRef)).toEqual([FleetScopeRole.OFFICER]);
      expect([...(atCommunity?.roles ?? [])]).toEqual([]);
      expect(atCommunity?.capabilities.size).toBe(0);
    });
  });

  describe('memoising within a request', () => {
    it('keeps one user’s answer from another', async () => {
      const world = buildWorld(true);

      await world.authorisation.authorise(OWNER, fleetRef);

      const other = await world.authorisation.authorise(USER, fleetRef);

      expect(other?.roles.size).toBe(0);
    });

    it('keeps the answer for one claimed Community from another’s', async () => {
      const world = buildWorld(true);

      await world.authorisation.authorise(OWNER, {
        ...fleetRef,
        withinCommunityId: COMMUNITY,
      });

      await expect(
        world.authorisation.authorise(OWNER, {
          ...fleetRef,
          withinCommunityId: OTHER_COMMUNITY,
        }),
      ).resolves.toBeNull();
    });
  });
});
