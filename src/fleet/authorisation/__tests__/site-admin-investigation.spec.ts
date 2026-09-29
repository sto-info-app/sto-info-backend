import {
  AuthorisationWorld,
  createAuthorisationWorld,
} from '../../../../test/fleet-authorisation-world';
import { FleetAudience } from '../../enums/fleet-audience.enum';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { FLEET_CAPABILITIES } from '../fleet-capability.constants';
import { ScopeRef } from '../scope-authorisation.interface';

const HOUR = 3_600_000;

/**
 * A site admin's look into a private Fleet's imports (FC-036), asked of the
 * real authorisation and audience services over a described world.
 *
 * The grant row is the whole of it: while it runs, the admin reads what an
 * investigator reads at that one Fleet and can open it and its Community;
 * before it, after it, and anywhere else, they are nobody.
 */
describe('Fleet authorisation: a site admin looking into a Fleet', () => {
  const ADMIN = 'user-site-admin';
  const DISABLED = 'user-disabled-admin';
  const COMMUNITY = 'community-1';
  const FLEET = 'fleet-1';
  const SIBLING = 'fleet-2';

  const fleet: ScopeRef = { kind: FleetScopeKind.FLEET, id: FLEET };
  const sibling: ScopeRef = { kind: FleetScopeKind.FLEET, id: SIBLING };
  const community: ScopeRef = { kind: FleetScopeKind.COMMUNITY, id: COMMUNITY };

  /**
   * A private Community with two private Fleets, and the grants given.
   *
   * @param expiresAt - When the admin's grant for the first Fleet ends, if
   *   there is one.
   * @returns The world.
   */
  const buildWorld = (expiresAt?: Date): AuthorisationWorld =>
    createAuthorisationWorld({
      users: [
        { id: ADMIN, isAccountDisabled: false },
        { id: DISABLED, isAccountDisabled: true },
      ],
      communities: [
        {
          id: COMMUNITY,
          ownerUserId: 'user-owner',
          status: FleetScopeStatus.ACTIVE,
          visibility: FleetAudience.PRIVATE,
          revision: 1,
        },
      ],
      fleets: [FLEET, SIBLING].map(id => ({
        id,
        communityId: COMMUNITY,
        status: FleetScopeStatus.ACTIVE,
        visibility: FleetAudience.PRIVATE,
        revision: 1,
      })),
      investigations:
        expiresAt === undefined
          ? []
          : [ADMIN, DISABLED].map(adminUserId => ({
              adminUserId,
              communityId: COMMUNITY,
              fleetId: FLEET,
              expiresAt,
            })),
    });

  /**
   * What somebody holds at a scope.
   *
   * @param world - The world.
   * @param userId - Who.
   * @param ref - Where.
   * @returns Their capabilities.
   */
  const capabilitiesOf = async (
    world: AuthorisationWorld,
    userId: string,
    ref: ScopeRef,
  ): Promise<string[]> => [
    ...((await world.authorisation.authorise(userId, ref))?.capabilities ?? []),
  ];

  it('gives nothing, and shows nothing, before a purpose is given', async () => {
    const world = buildWorld();

    expect(await capabilitiesOf(world, ADMIN, fleet)).toEqual([]);
    expect(await world.audience.canViewScope(fleet, ADMIN)).toBe(false);
    expect(await world.audience.canViewScope(community, ADMIN)).toBe(false);
  });

  it('reads that Fleet’s imports, and changes nothing, while the look runs', async () => {
    const world = buildWorld(new Date(Date.now() + HOUR));

    expect(await capabilitiesOf(world, ADMIN, fleet)).toEqual([
      FLEET_CAPABILITIES.ROSTER_INVESTIGATE_READ,
    ]);
    expect(await world.audience.canViewScope(fleet, ADMIN)).toBe(true);
    // The Community's page is on the way to the Fleet's.
    expect(await world.audience.canViewScope(community, ADMIN)).toBe(true);
  });

  it('reaches no sibling Fleet, and nothing at the Community', async () => {
    const world = buildWorld(new Date(Date.now() + HOUR));

    expect(await capabilitiesOf(world, ADMIN, sibling)).toEqual([]);
    expect(await world.audience.canViewScope(sibling, ADMIN)).toBe(false);
    expect(await capabilitiesOf(world, ADMIN, community)).toEqual([]);
  });

  it('ends with its 24 hours', async () => {
    const world = buildWorld(new Date(Date.now() - 1));

    expect(await capabilitiesOf(world, ADMIN, fleet)).toEqual([]);
    expect(await world.audience.canViewScope(fleet, ADMIN)).toBe(false);
  });

  it('gives a disabled account nothing, grant or not', async () => {
    const world = buildWorld(new Date(Date.now() + HOUR));

    expect(await capabilitiesOf(world, DISABLED, fleet)).toEqual([]);
  });

  it('shows a signed-out visitor nothing', async () => {
    const world = buildWorld(new Date(Date.now() + HOUR));

    expect(await world.audience.canViewScope(community, null)).toBe(false);
  });
});
