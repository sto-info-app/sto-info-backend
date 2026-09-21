import { Logger } from '@nestjs/common';

import {
  AuthorisationWorld,
  createAuthorisationWorld,
} from '../../../../test/fleet-authorisation-world';
import { FleetAudience } from '../../enums/fleet-audience.enum';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeRelationship } from '../../enums/fleet-scope-relationship.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import { ScopeRef } from '../scope-authorisation.interface';

/**
 * The follow, apply and membership matrix FC-015 is validated against.
 *
 * FC-005 proved that the three records confer what they should. This asks the
 * question the reader sees instead: given the same world, what is each person
 * *called*, what may they *see*, and does the second ever follow from the
 * first. The two halves are asserted side by side in most cases here, because
 * the failure worth catching is not a wrong badge or a wrong refusal — it is
 * the day they stop agreeing, and a follower is shown a roster because
 * something read the badge as permission.
 *
 * Nothing here mocks the services. A world of Communities, Fleets, people,
 * memberships and subscriptions is described, and the real viewer, audience
 * and authorisation services are asked about it.
 */
describe('Fleet following: relationship and access matrix', () => {
  const OWNER = 'user-owner';
  const FLEET_ADMIN = 'user-fleet-admin';
  const MEMBER = 'user-member';
  const FOLLOWING_MEMBER = 'user-following-member';
  const COMMUNITY_MEMBER = 'user-community-member';
  const FOLLOWER = 'user-follower';
  const APPLICANT = 'user-applicant';
  const SUSPENDED = 'user-suspended';
  const DEPARTED = 'user-departed';
  const STRANGER = 'user-stranger';

  const COMMUNITY = 'community-1';
  const FLEET = 'fleet-1';

  const fleetScope: ScopeRef = { kind: FleetScopeKind.FLEET, id: FLEET };
  const communityScope: ScopeRef = {
    kind: FleetScopeKind.COMMUNITY,
    id: COMMUNITY,
  };

  let world: AuthorisationWorld;

  /**
   * Builds the standing world every case starts from.
   *
   * One Community with one Fleet, and one person in each state the matrix
   * distinguishes. Three of them follow: a follower who is nothing else, a
   * member who also follows, and somebody who has since stopped.
   *
   * @returns The wired services.
   */
  const buildWorld = (): AuthorisationWorld =>
    createAuthorisationWorld({
      users: [
        { id: OWNER, isAccountDisabled: false },
        { id: FLEET_ADMIN, isAccountDisabled: false },
        { id: MEMBER, isAccountDisabled: false },
        { id: FOLLOWING_MEMBER, isAccountDisabled: false },
        { id: COMMUNITY_MEMBER, isAccountDisabled: false },
        { id: FOLLOWER, isAccountDisabled: false },
        { id: APPLICANT, isAccountDisabled: false },
        { id: SUSPENDED, isAccountDisabled: false },
        { id: DEPARTED, isAccountDisabled: false },
        { id: STRANGER, isAccountDisabled: false },
      ],
      communities: [
        {
          id: COMMUNITY,
          ownerUserId: OWNER,
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
      ],
      roles: [
        {
          communityId: COMMUNITY,
          fleetId: FLEET,
          userId: FLEET_ADMIN,
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
          userId: FOLLOWING_MEMBER,
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
          userId: APPLICANT,
          status: ScopeMembershipStatus.PENDING,
        },
        {
          communityId: COMMUNITY,
          fleetId: FLEET,
          userId: SUSPENDED,
          status: ScopeMembershipStatus.SUSPENDED,
        },
        {
          communityId: COMMUNITY,
          fleetId: FLEET,
          userId: DEPARTED,
          status: ScopeMembershipStatus.LEFT,
        },
      ],
      subscriptions: [
        { communityId: COMMUNITY, userId: FOLLOWER },
        { communityId: COMMUNITY, userId: FOLLOWING_MEMBER },
        // Followed once and stopped. The row stays, so "followed once" is
        // answerable, and none of it counts as following now.
        {
          communityId: COMMUNITY,
          userId: DEPARTED,
          leftAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    });

  /**
   * Asks the viewer service what a page should say about somebody.
   *
   * @param userId - The viewer, or null when signed out.
   * @param ref - The scope they are looking at.
   * @returns What the page is told.
   */
  const viewerFor = (userId: string | null, ref: ScopeRef) =>
    world.viewer.forScope({ userId, role: null }, ref);

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

  describe('what each person is called at the Fleet', () => {
    it.each([
      ['a stranger', STRANGER, FleetScopeRelationship.NONE],
      [
        'a follower of the Community',
        FOLLOWER,
        FleetScopeRelationship.FOLLOWER,
      ],
      ['an unanswered applicant', APPLICANT, FleetScopeRelationship.REQUESTED],
      ['an approved member', MEMBER, FleetScopeRelationship.MEMBER],
      ['a suspended member', SUSPENDED, FleetScopeRelationship.SUSPENDED],
      ['somebody who left', DEPARTED, FleetScopeRelationship.NONE],
    ])('calls %s %s', async (_name, userId, expected) => {
      const viewer = await viewerFor(userId, fleetScope);

      expect(viewer.relationship).toBe(expected);
    });

    it('reports nothing for a caller who is not signed in', async () => {
      const viewer = await viewerFor(null, fleetScope);

      expect(viewer.relationship).toBe(FleetScopeRelationship.NONE);
      expect(viewer.isFollowingCommunity).toBe(false);
    });

    /*
     * A Community membership is not a Fleet membership. The Fleet page says
     * so, rather than promoting somebody who joined the Community into a
     * roster they were never approved for.
     */
    it('does not call a Community member a member of its Fleet', async () => {
      const viewer = await viewerFor(COMMUNITY_MEMBER, fleetScope);

      expect(viewer.relationship).toBe(FleetScopeRelationship.NONE);
    });

    it('calls the same Community member a member of the Community', async () => {
      const viewer = await viewerFor(COMMUNITY_MEMBER, communityScope);

      expect(viewer.relationship).toBe(FleetScopeRelationship.MEMBER);
    });

    /*
     * Both are true and both are reported, because the badge and the follow
     * control are different questions. One field could not answer them.
     */
    it('reports a member who also follows as a member who follows', async () => {
      const viewer = await viewerFor(FOLLOWING_MEMBER, fleetScope);

      expect(viewer.relationship).toBe(FleetScopeRelationship.MEMBER);
      expect(viewer.isFollowingCommunity).toBe(true);
    });

    it('does not count somebody who stopped following as following', async () => {
      const viewer = await viewerFor(DEPARTED, fleetScope);

      expect(viewer.isFollowingCommunity).toBe(false);
    });
  });

  describe('following grants nothing', () => {
    /*
     * FC-015's first acceptance criterion, asked of the record that would
     * carry a roster. A follower is inside the Community audience and
     * outside the Fleet's, and no amount of following moves that line.
     */
    it('lets a follower see Community content and not the Fleet roster', async () => {
      await expect(
        world.audience.canView(FleetAudience.COMMUNITY, fleetScope, FOLLOWER),
      ).resolves.toBe(true);
      await expect(
        world.audience.canView(
          FleetAudience.FLEET_MEMBERS,
          fleetScope,
          FOLLOWER,
        ),
      ).resolves.toBe(false);
    });

    it('gives a follower no capability anywhere in the Community', async () => {
      const atFleet = await world.authorisation.authorise(FOLLOWER, fleetScope);
      const atCommunity = await world.authorisation.authorise(
        FOLLOWER,
        communityScope,
      );

      expect([...(atFleet?.capabilities ?? [])]).toEqual([]);
      expect([...(atCommunity?.capabilities ?? [])]).toEqual([]);
      expect(atFleet?.isApprovedMember).toBe(false);
    });

    it('offers a follower neither picture and no management', async () => {
      const viewer = await viewerFor(FOLLOWER, fleetScope);

      expect(viewer.capabilities).toEqual([]);
      expect(viewer.mayManageBanner).toBe(false);
      expect(viewer.mayManageEmblem).toBe(false);
    });

    /*
     * An unanswered request is not access either, and saying so on the page
     * is the whole point of distinguishing it from membership.
     */
    it('gives an applicant no more than a stranger while they wait', async () => {
      await expect(
        world.audience.canView(
          FleetAudience.FLEET_MEMBERS,
          fleetScope,
          APPLICANT,
        ),
      ).resolves.toBe(false);
    });

    /*
     * A suspension denies outright rather than falling back to whatever the
     * person would otherwise have been.
     */
    it('shuts a suspended member out of Community content as well', async () => {
      await expect(
        world.audience.canView(FleetAudience.COMMUNITY, fleetScope, SUSPENDED),
      ).resolves.toBe(false);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('the follower count', () => {
    /*
     * Two live subscriptions and one that ended. A count over the wrong set
     * would be the only number anybody is given about followers, and it
     * would be wrong for everybody.
     */
    it('counts the live followers and not the ones who left', async () => {
      await expect(world.subscription.countFollowers(COMMUNITY)).resolves.toBe(
        2,
      );
    });

    it('is the same number whoever asks', async () => {
      const counts = await Promise.all(
        [null, STRANGER, FOLLOWER, MEMBER, OWNER].map(
          async userId => (await viewerFor(userId, fleetScope)).followerCount,
        ),
      );

      expect(counts).toEqual([2, 2, 2, 2, 2]);
    });

    /*
     * The count is a number and stays one. Nobody is told who is in it, so
     * there is no route to leak and nothing for a cross-scope read to carry.
     */
    it('tells nobody who the followers are', async () => {
      const viewer = await viewerFor(OWNER, communityScope);

      expect(Object.keys(viewer)).toEqual([
        'capabilities',
        'mayManageBanner',
        'mayManageEmblem',
        'relationship',
        'isFollowingCommunity',
        'followerCount',
      ]);
    });
  });

  describe('what authority is called', () => {
    /*
     * Authority is not a relationship. An owner and an appointed
     * administrator hold roles, not memberships, and the page reports the
     * record that is there rather than inferring one from what they can do
     * — which is also why nothing is ever authorised from the relationship.
     * A page that wants to say "you run this" has the capabilities for it.
     */
    it.each([
      ['the Community owner', OWNER],
      ['a Fleet administrator', FLEET_ADMIN],
    ])('does not turn the role of %s into a membership', async (_n, userId) => {
      const viewer = await viewerFor(userId, fleetScope);

      expect(viewer.relationship).toBe(FleetScopeRelationship.NONE);
      expect(viewer.capabilities.length).toBeGreaterThan(0);
    });

    it('calls an owner who follows their own Community a follower', async () => {
      world.rows.subscriptions.push({
        communityId: COMMUNITY,
        userId: OWNER,
        leftAt: null,
        deletedAt: null,
      });

      const viewer = await viewerFor(OWNER, fleetScope);

      expect(viewer.relationship).toBe(FleetScopeRelationship.FOLLOWER);
      expect(viewer.isFollowingCommunity).toBe(true);
    });
  });
});
