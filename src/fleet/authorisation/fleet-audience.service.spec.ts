import { NotFoundException } from '@nestjs/common';

import {
  AuthorisationWorld,
  createAuthorisationWorld,
} from '../../../test/fleet-authorisation-world';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';
import { FleetInvitationStatus } from '../recruitment/enums/fleet-invitation-status.enum';
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
  const INVITEE = 'user-invitee';

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
        { id: INVITEE, isAccountDisabled: false },
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
        {
          id: 'fleet-private',
          communityId: OPEN_COMMUNITY,
          status: FleetScopeStatus.ACTIVE,
          revision: 1,
          visibility: FleetAudience.PRIVATE,
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

  /**
   * FC-021: a Fleet nobody outside it can see reaches a person only by
   * inviting them, so an open invitation shows the invitee the Fleet — and
   * nothing more.
   */
  describe('with an invitation', () => {
    const DAY = 24 * 60 * 60 * 1000;

    const invite = (
      fleetId: string,
      status = FleetInvitationStatus.PENDING,
      expiresAt = new Date(Date.now() + DAY),
    ): void => {
      world.rows.invitations.push({
        id: `invitation-${world.rows.invitations.length}`,
        fleetId,
        invitedUserId: INVITEE,
        status,
        expiresAt,
      });
    };

    it.each([
      ["a Community's Fleet", 'fleet-community'],
      ['a private Fleet', 'fleet-private'],
      // The invitation reaches past the Community's audience too, since the
      // Fleet cannot be seen without it.
      ['a Fleet in a Community for its followers', 'fleet-public-in-closed'],
    ])('shows the invitee %s while it is open', async (_name, fleetId) => {
      invite(fleetId);

      await expect(
        world.audience.canViewScope(
          scope(FleetScopeKind.FLEET, fleetId),
          INVITEE,
        ),
      ).resolves.toBe(true);
    });

    it.each([
      ['lapsed', FleetInvitationStatus.PENDING, new Date(Date.now() - DAY)],
      ['declined', FleetInvitationStatus.DECLINED, undefined],
      ['withdrawn', FleetInvitationStatus.WITHDRAWN, undefined],
      ['accepted', FleetInvitationStatus.ACCEPTED, undefined],
    ])(
      'shows nothing once the invitation is %s',
      async (_name, status, expiresAt) => {
        invite('fleet-community', status, expiresAt);

        await expect(
          world.audience.canViewScope(
            scope(FleetScopeKind.FLEET, 'fleet-community'),
            INVITEE,
          ),
        ).resolves.toBe(false);
      },
    );

    it('shows no other Fleet', async () => {
      invite('fleet-community');

      await expect(
        world.audience.canViewScope(
          scope(FleetScopeKind.FLEET, 'fleet-private'),
          INVITEE,
        ),
      ).resolves.toBe(false);
    });

    it('does not show the Community itself', async () => {
      invite('fleet-public-in-closed');

      await expect(
        world.audience.canViewScope(
          scope(FleetScopeKind.COMMUNITY, CLOSED_COMMUNITY),
          INVITEE,
        ),
      ).resolves.toBe(false);
    });

    /**
     * Seeing the Fleet is not being in it: content published to its members
     * stays theirs.
     */
    it("opens nothing published to the Fleet's members", async () => {
      invite('fleet-community');

      await expect(
        world.audience.canView(
          FleetAudience.FLEET_MEMBERS,
          scope(FleetScopeKind.FLEET, 'fleet-community'),
          INVITEE,
        ),
      ).resolves.toBe(false);
    });
  });

  describe('assertCanViewFleet', () => {
    const fleet = (id: string, visibility: FleetAudience) => ({
      id,
      visibility,
    });

    const CLOSED = {
      id: CLOSED_COMMUNITY,
      visibility: FleetAudience.COMMUNITY,
    };

    it('lets through somebody the audiences allow', async () => {
      await expect(
        world.audience.assertCanViewFleet(
          fleet('fleet-public', FleetAudience.PUBLIC),
          null,
          { id: OPEN_COMMUNITY, visibility: FleetAudience.PUBLIC },
        ),
      ).resolves.toBeUndefined();
    });

    it("reads the Fleet's audience alone when given no Community", async () => {
      await expect(
        world.audience.assertCanViewFleet(
          fleet('fleet-public-in-closed', FleetAudience.PUBLIC),
          STRANGER,
        ),
      ).resolves.toBeUndefined();
    });

    it("refuses somebody the Community's audience shuts out", async () => {
      await expect(
        world.audience.assertCanViewFleet(
          fleet('fleet-public-in-closed', FleetAudience.PUBLIC),
          STRANGER,
          CLOSED,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("refuses somebody the Fleet's audience shuts out", async () => {
      await expect(
        world.audience.assertCanViewFleet(
          fleet('fleet-community', FleetAudience.COMMUNITY),
          null,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets through an invitee past both audiences', async () => {
      world.rows.invitations.push({
        id: 'invitation-closed',
        fleetId: 'fleet-public-in-closed',
        invitedUserId: INVITEE,
        status: FleetInvitationStatus.PENDING,
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(
        world.audience.assertCanViewFleet(
          fleet('fleet-public-in-closed', FleetAudience.PUBLIC),
          INVITEE,
          CLOSED,
        ),
      ).resolves.toBeUndefined();
    });
  });
});
