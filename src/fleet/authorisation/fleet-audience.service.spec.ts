import { NotFoundException } from '@nestjs/common';

import {
  AuthorisationWorld,
  createAuthorisationWorld,
} from '../../../test/fleet-authorisation-world';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';
import { ScopeMembershipStatus } from '../enums/scope-membership-status.enum';
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

/**
 * FC-050, Steve's decision of 30 September 2026: a Community's own audience
 * counts the approved members of every Fleet in it, whether it is set to its
 * followers and members or to its members alone. So a Fleet's members reach
 * their own Fleet without following, and nobody else is let in.
 */
describe("FleetAudienceService: a Community's Fleet members", () => {
  const OWNER = 'user-owner';
  const MEMBER = 'user-member';
  const FOLLOWER = 'user-follower';
  const STRANGER = 'user-stranger';
  const OUTSIDER = 'user-outsider';
  const HELD = 'user-held';

  const MEMBERS_COMMUNITY = 'community-members';
  const FLEET_MEMBERS_COMMUNITY = 'community-fleet-members';
  const OTHER_COMMUNITY = 'community-other';

  let world: AuthorisationWorld;

  const community = (id: string): ScopeRef => ({
    kind: FleetScopeKind.COMMUNITY,
    id,
  });
  const fleet = (id: string): ScopeRef => ({ kind: FleetScopeKind.FLEET, id });

  /**
   * Gives somebody a membership of a Fleet.
   *
   * @param userId - The person.
   * @param communityId - The Fleet's Community.
   * @param fleetId - The Fleet.
   * @param status - The membership's status.
   */
  const join = (
    userId: string,
    communityId: string,
    fleetId: string,
    status = ScopeMembershipStatus.APPROVED,
  ): void => {
    world.rows.memberships.push({
      communityId,
      fleetId,
      armadaId: null,
      userId,
      status,
      deletedAt: null,
    });
  };

  /**
   * Describes a Community and two Fleets in it: one for the Community's
   * followers and members, one for its own members.
   *
   * @param id - The Community.
   * @param visibility - Its audience.
   * @returns The Community's row and its Fleets' rows.
   */
  const communityWith = (id: string, visibility: FleetAudience) => ({
    community: {
      id,
      ownerUserId: OWNER,
      status: FleetScopeStatus.ACTIVE,
      revision: 1,
      visibility,
    },
    fleets: [
      {
        id: `${id}-fleet`,
        communityId: id,
        status: FleetScopeStatus.ACTIVE,
        revision: 1,
        visibility: FleetAudience.COMMUNITY,
      },
      {
        id: `${id}-members-fleet`,
        communityId: id,
        status: FleetScopeStatus.ACTIVE,
        revision: 1,
        visibility: FleetAudience.FLEET_MEMBERS,
      },
    ],
  });

  const members = communityWith(MEMBERS_COMMUNITY, FleetAudience.COMMUNITY);
  const fleetMembers = communityWith(
    FLEET_MEMBERS_COMMUNITY,
    FleetAudience.FLEET_MEMBERS,
  );
  const other = communityWith(OTHER_COMMUNITY, FleetAudience.PUBLIC);

  beforeEach(() => {
    world = createAuthorisationWorld({
      users: [OWNER, MEMBER, FOLLOWER, STRANGER, OUTSIDER, HELD].map(id => ({
        id,
        isAccountDisabled: false,
      })),
      communities: [members.community, fleetMembers.community, other.community],
      fleets: [...members.fleets, ...fleetMembers.fleets, ...other.fleets],
      armadas: [
        {
          id: 'armada-fleet-members',
          communityId: FLEET_MEMBERS_COMMUNITY,
          status: FleetScopeStatus.ACTIVE,
          revision: 1,
        },
      ],
      subscriptions: [
        { id: 'sub-1', communityId: MEMBERS_COMMUNITY, userId: FOLLOWER },
        { id: 'sub-2', communityId: FLEET_MEMBERS_COMMUNITY, userId: FOLLOWER },
      ],
    });

    for (const { community: row } of [members, fleetMembers]) {
      join(MEMBER, row.id, `${row.id}-fleet`);
      join(HELD, row.id, `${row.id}-fleet`, ScopeMembershipStatus.SUSPENDED);
    }

    // A member of a Fleet elsewhere is a stranger here.
    join(OUTSIDER, OTHER_COMMUNITY, `${OTHER_COMMUNITY}-fleet`);
  });

  describe.each([
    ['its followers and members', MEMBERS_COMMUNITY, FleetAudience.COMMUNITY],
    ['its members', FLEET_MEMBERS_COMMUNITY, FleetAudience.FLEET_MEMBERS],
  ])('set to %s', (_name, communityId, visibility) => {
    const ownFleet = `${communityId}-fleet`;

    it('shows the Community to a Fleet member who does not follow it', async () => {
      await expect(
        world.audience.canViewScope(community(communityId), MEMBER),
      ).resolves.toBe(true);
      await expect(
        world.audience.canView(visibility, community(communityId), MEMBER),
      ).resolves.toBe(true);
    });

    it('lets a Fleet member who does not follow open their own Fleet', async () => {
      await expect(
        world.audience.canViewScope(fleet(ownFleet), MEMBER),
      ).resolves.toBe(true);
      await expect(
        world.audience.assertCanViewFleet(
          { id: ownFleet, visibility: FleetAudience.COMMUNITY },
          MEMBER,
          { id: communityId, visibility },
        ),
      ).resolves.toBeUndefined();
    });

    it('still asks a sibling Fleet its own audience', async () => {
      await expect(
        world.audience.canViewScope(
          fleet(`${communityId}-members-fleet`),
          MEMBER,
        ),
      ).resolves.toBe(false);
    });

    it.each([
      ['a signed-in stranger', STRANGER],
      ["a member of another Community's Fleet", OUTSIDER],
      ['a suspended Fleet member', HELD],
      ['a signed-out visitor', null],
    ])('shows %s neither the Community nor the Fleet', async (_who, userId) => {
      await expect(
        world.audience.canViewScope(community(communityId), userId),
      ).resolves.toBe(false);
      await expect(
        world.audience.canViewScope(fleet(ownFleet), userId),
      ).resolves.toBe(false);
    });

    it.each([
      ScopeMembershipStatus.PENDING,
      ScopeMembershipStatus.REJECTED,
      ScopeMembershipStatus.LEFT,
      ScopeMembershipStatus.REVOKED,
    ])('does not count a %s Fleet membership', async status => {
      join(STRANGER, communityId, ownFleet, status);

      await expect(
        world.audience.canViewScope(community(communityId), STRANGER),
      ).resolves.toBe(false);
    });

    it('does not count a deleted Fleet membership', async () => {
      join(STRANGER, communityId, ownFleet);
      world.rows.memberships[world.rows.memberships.length - 1].deletedAt =
        new Date();

      await expect(
        world.audience.canViewScope(community(communityId), STRANGER),
      ).resolves.toBe(false);
    });

    it('counts a member suspended in one Fleet through another, without opening the first', async () => {
      join(HELD, communityId, `${communityId}-members-fleet`);

      await expect(
        world.audience.canViewScope(community(communityId), HELD),
      ).resolves.toBe(true);
      await expect(
        world.audience.canViewScope(fleet(ownFleet), HELD),
      ).resolves.toBe(false);
    });

    it('refuses a Fleet member the Community itself has suspended', async () => {
      world.rows.memberships.push({
        communityId,
        fleetId: null,
        armadaId: null,
        userId: MEMBER,
        status: ScopeMembershipStatus.SUSPENDED,
        deletedAt: null,
      });

      await expect(
        world.audience.canViewScope(community(communityId), MEMBER),
      ).resolves.toBe(false);
    });

    /**
     * Lists and filters ask {@link FleetAudienceService.canView} of the
     * Community's audience — the followed list, and the audiences a news
     * page or an event list filters its rows by — while a page asks
     * {@link FleetAudienceService.canViewScope}. Both must answer everybody
     * alike.
     */
    it.each([OWNER, MEMBER, FOLLOWER, STRANGER, OUTSIDER, HELD, null])(
      'answers %s alike for the page and for a list',
      async userId => {
        const page = await world.audience.canViewScope(
          community(communityId),
          userId,
        );

        await expect(
          world.audience.canView(visibility, community(communityId), userId),
        ).resolves.toBe(page);
      },
    );
  });

  it('shows a follower a Community set to its followers and members', async () => {
    await expect(
      world.audience.canViewScope(community(MEMBERS_COMMUNITY), FOLLOWER),
    ).resolves.toBe(true);
  });

  it('shows a follower nothing of a Community set to its members', async () => {
    await expect(
      world.audience.canViewScope(community(FLEET_MEMBERS_COMMUNITY), FOLLOWER),
    ).resolves.toBe(false);
  });

  it("lets a Fleet member open their Fleet's members-only pages in a members-only Community", async () => {
    join(
      MEMBER,
      FLEET_MEMBERS_COMMUNITY,
      `${FLEET_MEMBERS_COMMUNITY}-members-fleet`,
    );

    await expect(
      world.audience.canViewScope(
        fleet(`${FLEET_MEMBERS_COMMUNITY}-members-fleet`),
        MEMBER,
      ),
    ).resolves.toBe(true);
  });

  /**
   * An Armada has no audience of its own, so its page follows its
   * Community's; what it keeps for its members stays theirs, which is its
   * placed Fleets' members.
   */
  it('shows the Armada page but nothing an Armada keeps for its own members', async () => {
    const armada: ScopeRef = {
      kind: FleetScopeKind.ARMADA,
      id: 'armada-fleet-members',
    };

    await expect(world.audience.canViewScope(armada, MEMBER)).resolves.toBe(
      true,
    );
    await expect(
      world.audience.canView(FleetAudience.FLEET_MEMBERS, armada, MEMBER),
    ).resolves.toBe(false);
  });

  /**
   * Nothing holds the answer past the question: leaving a Fleet is seen by
   * the next question in the same request, although only the Fleet's
   * revision moves.
   */
  it('stops counting a member who leaves, within the same request', async () => {
    world = createAuthorisationWorld(
      {
        users: [{ id: MEMBER, isAccountDisabled: false }],
        communities: [fleetMembers.community],
        fleets: fleetMembers.fleets,
        memberships: [
          {
            communityId: FLEET_MEMBERS_COMMUNITY,
            fleetId: `${FLEET_MEMBERS_COMMUNITY}-fleet`,
            userId: MEMBER,
            status: ScopeMembershipStatus.APPROVED,
          },
        ],
      },
      true,
    );

    await expect(
      world.audience.canViewScope(community(FLEET_MEMBERS_COMMUNITY), MEMBER),
    ).resolves.toBe(true);

    world.rows.memberships[0].status = ScopeMembershipStatus.LEFT;
    await world.revision.bump(
      FleetScopeKind.FLEET,
      `${FLEET_MEMBERS_COMMUNITY}-fleet`,
    );

    await expect(
      world.audience.canViewScope(community(FLEET_MEMBERS_COMMUNITY), MEMBER),
    ).resolves.toBe(false);
  });
});

/**
 * FC-050, Steve's decision of 30 September 2026: "Community members" means
 * the same wherever it is set inside a Community. On a Fleet, an Armada or
 * anything published in either, it admits the Community's followers and the
 * approved members of every Fleet in it, as it does on the Community itself.
 * "Fleet members" on a Fleet stays that Fleet's own.
 */
describe('FleetAudienceService: "Community members" inside a Community', () => {
  const OWNER = 'user-owner';
  const SIBLING = 'user-sibling';
  const OWN = 'user-own';
  const FOLLOWER = 'user-follower';
  const STRANGER = 'user-stranger';
  const OUTSIDER = 'user-outsider';

  const COMMUNITY_ID = 'community-shared';
  const OTHER_COMMUNITY = 'community-elsewhere';
  const SIBLING_FLEET = 'fleet-sibling';
  const SHARED_FLEET = 'fleet-shared';
  const ARMADA = 'armada-shared';

  const sharedFleet: ScopeRef = {
    kind: FleetScopeKind.FLEET,
    id: SHARED_FLEET,
  };
  const armada: ScopeRef = { kind: FleetScopeKind.ARMADA, id: ARMADA };

  let world: AuthorisationWorld;

  /**
   * Gives somebody a membership of a Fleet.
   *
   * @param userId - The person.
   * @param fleetId - The Fleet.
   * @param status - The membership's status.
   * @param communityId - The Fleet's Community.
   */
  const join = (
    userId: string,
    fleetId: string,
    status = ScopeMembershipStatus.APPROVED,
    communityId = COMMUNITY_ID,
  ): void => {
    world.rows.memberships.push({
      communityId,
      fleetId,
      armadaId: null,
      userId,
      status,
      deletedAt: null,
    });
  };

  beforeEach(() => {
    world = createAuthorisationWorld({
      users: [OWNER, SIBLING, OWN, FOLLOWER, STRANGER, OUTSIDER].map(id => ({
        id,
        isAccountDisabled: false,
      })),
      communities: [
        {
          id: COMMUNITY_ID,
          ownerUserId: OWNER,
          status: FleetScopeStatus.ACTIVE,
          revision: 1,
          visibility: FleetAudience.COMMUNITY,
        },
        {
          id: OTHER_COMMUNITY,
          ownerUserId: OWNER,
          status: FleetScopeStatus.ACTIVE,
          revision: 1,
          visibility: FleetAudience.PUBLIC,
        },
      ],
      fleets: [
        {
          id: SIBLING_FLEET,
          communityId: COMMUNITY_ID,
          status: FleetScopeStatus.ACTIVE,
          revision: 1,
          visibility: FleetAudience.FLEET_MEMBERS,
        },
        {
          id: SHARED_FLEET,
          communityId: COMMUNITY_ID,
          status: FleetScopeStatus.ACTIVE,
          revision: 1,
          visibility: FleetAudience.COMMUNITY,
        },
        {
          id: 'fleet-elsewhere',
          communityId: OTHER_COMMUNITY,
          status: FleetScopeStatus.ACTIVE,
          revision: 1,
          visibility: FleetAudience.PUBLIC,
        },
      ],
      armadas: [
        {
          id: ARMADA,
          communityId: COMMUNITY_ID,
          status: FleetScopeStatus.ACTIVE,
          revision: 1,
        },
      ],
      // Only the shared Fleet is placed, so the sibling's members are not
      // the Armada's.
      placements: [
        {
          communityId: COMMUNITY_ID,
          armadaId: ARMADA,
          fleetId: SHARED_FLEET,
          validTo: null,
          deletedAt: null,
        },
      ],
      subscriptions: [
        { id: 'sub-follower', communityId: COMMUNITY_ID, userId: FOLLOWER },
      ],
    });

    join(SIBLING, SIBLING_FLEET);
    join(OWN, SHARED_FLEET);
    join(
      OUTSIDER,
      'fleet-elsewhere',
      ScopeMembershipStatus.APPROVED,
      OTHER_COMMUNITY,
    );
  });

  it('lets a member of a sibling Fleet who does not follow see a Fleet set to "Community members"', async () => {
    await expect(
      world.audience.canViewScope(sharedFleet, SIBLING),
    ).resolves.toBe(true);
    await expect(
      world.audience.assertCanViewFleet(
        { id: SHARED_FLEET, visibility: FleetAudience.COMMUNITY },
        SIBLING,
        { id: COMMUNITY_ID, visibility: FleetAudience.COMMUNITY },
      ),
    ).resolves.toBeUndefined();
    await expect(
      world.audience.canView(FleetAudience.COMMUNITY, sharedFleet, SIBLING),
    ).resolves.toBe(true);
  });

  it('still shows a follower a Fleet set to "Community members"', async () => {
    await expect(
      world.audience.canViewScope(sharedFleet, FOLLOWER),
    ).resolves.toBe(true);
  });

  it.each([
    ['a signed-in stranger', STRANGER],
    ["a member of another Community's Fleet", OUTSIDER],
    ['a signed-out visitor', null],
  ])('shows %s nothing set to "Community members"', async (_who, userId) => {
    await expect(
      world.audience.canViewScope(sharedFleet, userId),
    ).resolves.toBe(false);
    await expect(
      world.audience.canView(FleetAudience.COMMUNITY, sharedFleet, userId),
    ).resolves.toBe(false);
    await expect(
      world.audience.canView(FleetAudience.COMMUNITY, armada, userId),
    ).resolves.toBe(false);
  });

  it.each([
    ScopeMembershipStatus.PENDING,
    ScopeMembershipStatus.SUSPENDED,
    ScopeMembershipStatus.REJECTED,
    ScopeMembershipStatus.LEFT,
    ScopeMembershipStatus.REVOKED,
  ])('does not count a %s membership of a sibling Fleet', async status => {
    join(STRANGER, SIBLING_FLEET, status);

    await expect(
      world.audience.canView(FleetAudience.COMMUNITY, sharedFleet, STRANGER),
    ).resolves.toBe(false);
    await expect(
      world.audience.canViewScope(sharedFleet, STRANGER),
    ).resolves.toBe(false);
  });

  it('does not count a deleted membership of a sibling Fleet', async () => {
    join(STRANGER, SIBLING_FLEET);
    world.rows.memberships[world.rows.memberships.length - 1].deletedAt =
      new Date();

    await expect(
      world.audience.canView(FleetAudience.COMMUNITY, sharedFleet, STRANGER),
    ).resolves.toBe(false);
  });

  it('refuses a sibling Fleet member the Fleet itself has suspended', async () => {
    join(SIBLING, SHARED_FLEET, ScopeMembershipStatus.SUSPENDED);

    await expect(
      world.audience.canView(FleetAudience.COMMUNITY, sharedFleet, SIBLING),
    ).resolves.toBe(false);
    await expect(
      world.audience.canViewScope(sharedFleet, SIBLING),
    ).resolves.toBe(false);
  });

  it('keeps "Fleet members" on a Fleet for its own members', async () => {
    await expect(
      world.audience.canView(FleetAudience.FLEET_MEMBERS, sharedFleet, OWN),
    ).resolves.toBe(true);
    await expect(
      world.audience.canView(FleetAudience.FLEET_MEMBERS, sharedFleet, SIBLING),
    ).resolves.toBe(false);
    await expect(
      world.audience.canView(
        FleetAudience.FLEET_MEMBERS,
        sharedFleet,
        FOLLOWER,
      ),
    ).resolves.toBe(false);
  });

  it('counts a sibling Fleet member for an Armada\'s "Community members" but not its own members', async () => {
    await expect(
      world.audience.canView(FleetAudience.COMMUNITY, armada, SIBLING),
    ).resolves.toBe(true);
    await expect(
      world.audience.canView(FleetAudience.FLEET_MEMBERS, armada, SIBLING),
    ).resolves.toBe(false);
    await expect(
      world.audience.canView(FleetAudience.FLEET_MEMBERS, armada, OWN),
    ).resolves.toBe(true);
  });

  /**
   * A Fleet page asks {@link FleetAudienceService.canViewScope}, while
   * what is published in it — news, events, activity, images — asks
   * {@link FleetAudienceService.canView} of the audience it carries, one
   * item at a time or across a list. Both must answer everybody alike.
   */
  it.each([OWNER, SIBLING, OWN, FOLLOWER, STRANGER, OUTSIDER, null])(
    'answers %s alike for the Fleet page and for its "Community members" content',
    async userId => {
      const page = await world.audience.canViewScope(sharedFleet, userId);

      await expect(
        world.audience.canView(FleetAudience.COMMUNITY, sharedFleet, userId),
      ).resolves.toBe(page);
    },
  );
});
