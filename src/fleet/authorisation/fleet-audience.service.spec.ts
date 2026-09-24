import {
  AuthorisationWorld,
  createAuthorisationWorld,
} from '../../../test/fleet-authorisation-world';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';
import { ScopeRef } from './scope-authorisation.interface';

/**
 * Whether somebody may see a scope at all, asked of the real services.
 *
 * The answer has to match what the page reads decide, because the guard uses
 * it to word a refusal: a scope this says is invisible is reported as absent.
 */
describe('FleetAudienceService: seeing a scope', () => {
  const OWNER = 'user-owner';
  const FOLLOWER = 'user-follower';
  const STRANGER = 'user-stranger';

  const OPEN_COMMUNITY = 'community-open';
  const CLOSED_COMMUNITY = 'community-closed';

  let world: AuthorisationWorld;

  const scope = (kind: FleetScopeKind, id: string): ScopeRef => ({ kind, id });

  beforeEach(() => {
    world = createAuthorisationWorld({
      users: [
        { id: OWNER, isAccountDisabled: false },
        { id: FOLLOWER, isAccountDisabled: false },
        { id: STRANGER, isAccountDisabled: false },
      ],
      communities: [
        {
          id: OPEN_COMMUNITY,
          ownerUserId: OWNER,
          status: FleetScopeStatus.ACTIVE,
          revision: 1,
          visibility: FleetAudience.PUBLIC,
        },
        {
          id: CLOSED_COMMUNITY,
          ownerUserId: OWNER,
          status: FleetScopeStatus.ACTIVE,
          revision: 1,
          visibility: FleetAudience.COMMUNITY,
        },
      ],
      fleets: [
        {
          id: 'fleet-public',
          communityId: OPEN_COMMUNITY,
          status: FleetScopeStatus.ACTIVE,
          revision: 1,
          visibility: FleetAudience.PUBLIC,
        },
        {
          id: 'fleet-community',
          communityId: OPEN_COMMUNITY,
          status: FleetScopeStatus.ACTIVE,
          revision: 1,
          visibility: FleetAudience.COMMUNITY,
        },
        {
          id: 'fleet-public-in-closed',
          communityId: CLOSED_COMMUNITY,
          status: FleetScopeStatus.ACTIVE,
          revision: 1,
          visibility: FleetAudience.PUBLIC,
        },
      ],
      armadas: [
        {
          id: 'armada-open',
          communityId: OPEN_COMMUNITY,
          status: FleetScopeStatus.ACTIVE,
          revision: 1,
        },
        {
          id: 'armada-closed',
          communityId: CLOSED_COMMUNITY,
          status: FleetScopeStatus.ACTIVE,
          revision: 1,
        },
      ],
      subscriptions: [
        { id: 'sub-1', communityId: OPEN_COMMUNITY, userId: FOLLOWER },
        { id: 'sub-2', communityId: CLOSED_COMMUNITY, userId: FOLLOWER },
      ],
    });
  });

  it.each([
    ['a public Fleet', FleetScopeKind.FLEET, 'fleet-public', null, true],
    ['a public Fleet', FleetScopeKind.FLEET, 'fleet-public', STRANGER, true],
    // What the end-to-end run found: the page denied this Fleet to a
    // stranger while the import routes confirmed it.
    [
      "a Community's Fleet",
      FleetScopeKind.FLEET,
      'fleet-community',
      STRANGER,
      false,
    ],
    [
      "a Community's Fleet",
      FleetScopeKind.FLEET,
      'fleet-community',
      FOLLOWER,
      true,
    ],
    [
      "a Community's Fleet",
      FleetScopeKind.FLEET,
      'fleet-community',
      OWNER,
      true,
    ],
    // A Fleet cannot be seen more widely than the Community that holds it.
    [
      'a public Fleet in a Community for its followers',
      FleetScopeKind.FLEET,
      'fleet-public-in-closed',
      STRANGER,
      false,
    ],
    [
      'a public Fleet in a Community for its followers',
      FleetScopeKind.FLEET,
      'fleet-public-in-closed',
      FOLLOWER,
      true,
    ],
    [
      'a public Community',
      FleetScopeKind.COMMUNITY,
      OPEN_COMMUNITY,
      STRANGER,
      true,
    ],
    [
      'a Community for its followers',
      FleetScopeKind.COMMUNITY,
      CLOSED_COMMUNITY,
      STRANGER,
      false,
    ],
    [
      'a Community for its followers',
      FleetScopeKind.COMMUNITY,
      CLOSED_COMMUNITY,
      FOLLOWER,
      true,
    ],
    // An Armada carries no audience, so its Community's is the whole of it.
    [
      'an Armada in a public Community',
      FleetScopeKind.ARMADA,
      'armada-open',
      STRANGER,
      true,
    ],
    [
      'an Armada in a Community for its followers',
      FleetScopeKind.ARMADA,
      'armada-closed',
      STRANGER,
      false,
    ],
    [
      'an Armada in a Community for its followers',
      FleetScopeKind.ARMADA,
      'armada-closed',
      FOLLOWER,
      true,
    ],
  ])(
    'answers for %s (%s %s) asked by %s: %s',
    async (_name, kind, id, userId, expected) => {
      await expect(
        world.audience.canViewScope(scope(kind, id), userId),
      ).resolves.toBe(expected);
    },
  );

  it('sees nothing of a scope that does not exist', async () => {
    await expect(
      world.audience.canViewScope(
        scope(FleetScopeKind.FLEET, 'fleet-missing'),
        OWNER,
      ),
    ).resolves.toBe(false);
  });

  it('sees nothing of a scope the route placed in the wrong Community', async () => {
    await expect(
      world.audience.canViewScope(
        {
          kind: FleetScopeKind.FLEET,
          id: 'fleet-public',
          withinCommunityId: CLOSED_COMMUNITY,
        },
        STRANGER,
      ),
    ).resolves.toBe(false);
  });
});
