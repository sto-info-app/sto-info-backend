import { createAuthorisationWorld } from '../../../test/fleet-authorisation-world';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';
import { FLEET_CAPABILITIES } from './fleet-capability.constants';

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
