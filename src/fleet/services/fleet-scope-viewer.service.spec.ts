import { Repository } from 'typeorm';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { UserRole } from 'src/user/enums/user-role.enum';

import { FleetAuthorisationService } from '../authorisation/fleet-authorisation.service';
import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { ScopeAuthorisation } from '../authorisation/scope-authorisation.interface';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetScopeRelationship } from '../enums/fleet-scope-relationship.enum';
import { ScopeMembershipStatus } from '../enums/scope-membership-status.enum';
import { CommunitySubscriptionService } from './community-subscription.service';
import { FleetScopeViewerService } from './fleet-scope-viewer.service';

const USER_ID = '30000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '30000000-0000-4000-8000-000000000002';
const FLEET_ID = '30000000-0000-4000-8000-000000000003';
const COMMUNITY_ID = '30000000-0000-4000-8000-000000000004';

const FLEET_REF = { kind: FleetScopeKind.FLEET, id: FLEET_ID };

/** Nothing held, nothing followed, nothing counted. */
const NOTHING = {
  capabilities: [],
  mayManageBanner: false,
  mayManageEmblem: false,
  relationship: FleetScopeRelationship.NONE,
  isFollowingCommunity: false,
  followerCount: null,
};

/**
 * Builds an authorisation holding the given capabilities.
 *
 * @param capabilities - What the caller holds at the scope.
 * @param membership - Their membership at the scope, when they have one.
 * @returns The authorisation.
 */
function authorisation(
  capabilities: string[],
  membership: ScopeMembershipStatus | null = null,
): ScopeAuthorisation {
  return {
    capabilities: new Set(capabilities),
    scope: { communityId: COMMUNITY_ID },
    membershipStatus: membership,
    isApprovedMember: membership === ScopeMembershipStatus.APPROVED,
  } as unknown as ScopeAuthorisation;
}

describe('FleetScopeViewerService', () => {
  let service: FleetScopeViewerService;
  let authorise: jest.Mock;
  let resolveScope: jest.Mock;
  let findOne: jest.Mock;
  let countFollowers: jest.Mock;
  let isFollowing: jest.Mock;

  beforeEach(() => {
    authorise = jest.fn(() => Promise.resolve(authorisation([])));
    resolveScope = jest.fn(() =>
      Promise.resolve({ communityId: COMMUNITY_ID }),
    );
    findOne = jest.fn(() => Promise.resolve(null));
    countFollowers = jest.fn(() => Promise.resolve(0));
    isFollowing = jest.fn(() => Promise.resolve(false));

    service = new FleetScopeViewerService(
      { authorise, resolveScope } as unknown as FleetAuthorisationService,
      {
        countFollowers,
        isFollowing,
      } as unknown as CommunitySubscriptionService,
      { findOne } as unknown as Repository<FileAssetEntity>,
    );
  });

  describe('at a registered scope', () => {
    /*
     * Every capability requires a user, so putting a caller who has not
     * signed in through the policy could only confirm what the absent token
     * already said.
     */
    it('does not authorise a caller who is not signed in', async () => {
      await expect(
        service.forScope({ userId: null, role: null }, FLEET_REF),
      ).resolves.toEqual({ ...NOTHING, followerCount: 0 });
      expect(authorise).not.toHaveBeenCalled();
    });

    /*
     * The count is part of the page rather than part of the permission. A
     * visitor deciding whether a Community is worth following is exactly who
     * it is for, so it is taken for them too.
     */
    it('still counts followers for a caller who is not signed in', async () => {
      countFollowers.mockResolvedValue(42);

      await expect(
        service.forScope({ userId: null, role: null }, FLEET_REF),
      ).resolves.toEqual({ ...NOTHING, followerCount: 42 });
      expect(resolveScope).toHaveBeenCalledWith(FLEET_REF);
      expect(countFollowers).toHaveBeenCalledWith(COMMUNITY_ID);
    });

    it('counts nobody when a signed-out caller names no scope', async () => {
      resolveScope.mockResolvedValue(null);

      await expect(
        service.forScope({ userId: null, role: null }, FLEET_REF),
      ).resolves.toEqual(NOTHING);
      expect(countFollowers).not.toHaveBeenCalled();
    });

    it('reports the capabilities the caller holds there', async () => {
      authorise.mockResolvedValue(
        authorisation([
          FLEET_CAPABILITIES.SCOPE_IMAGES_MANAGE,
          FLEET_CAPABILITIES.MEMBERS_VIEW,
        ]),
      );

      await expect(
        service.forScope({ userId: USER_ID, role: null }, FLEET_REF),
      ).resolves.toEqual({
        ...NOTHING,
        capabilities: [
          FLEET_CAPABILITIES.SCOPE_IMAGES_MANAGE,
          FLEET_CAPABILITIES.MEMBERS_VIEW,
        ],
        mayManageBanner: true,
        mayManageEmblem: true,
        followerCount: 0,
      });
      expect(authorise).toHaveBeenCalledWith(USER_ID, FLEET_REF);
    });

    /*
     * One capability covers both slots at a registered scope. They are
     * answered separately all the same, because an unregistered Fleet
     * answers them separately and a single flag would have to be taken apart
     * again there.
     */
    it('offers neither picture without the artwork capability', async () => {
      authorise.mockResolvedValue(
        authorisation([FLEET_CAPABILITIES.MEMBERS_VIEW]),
      );

      await expect(
        service.forScope({ userId: USER_ID, role: null }, FLEET_REF),
      ).resolves.toEqual({
        ...NOTHING,
        capabilities: [FLEET_CAPABILITIES.MEMBERS_VIEW],
        followerCount: 0,
      });
    });

    /*
     * A scope that does not resolve is not an error here. Deciding what to
     * render is not the same question as deciding what to allow, and a page
     * that threw would tell a reader nothing they could act on.
     */
    it('offers nothing when the scope does not resolve', async () => {
      authorise.mockResolvedValue(null);

      await expect(
        service.forScope({ userId: USER_ID, role: null }, FLEET_REF),
      ).resolves.toEqual(NOTHING);
      expect(countFollowers).not.toHaveBeenCalled();
    });

    /*
     * A site-wide role confers nothing at a scope — FC-005's first
     * acceptance criterion. It widens only the unregistered rule below,
     * where there is no scope for it to be confused with.
     */
    it('gives a site administrator nothing they were not granted', async () => {
      await expect(
        service.forScope({ userId: USER_ID, role: UserRole.ADMIN }, FLEET_REF),
      ).resolves.toEqual({ ...NOTHING, followerCount: 0 });
    });
  });

  describe('how the caller stands to the scope', () => {
    it('counts the followers of the Community that owns it', async () => {
      countFollowers.mockResolvedValue(7);

      const viewer = await service.forScope(
        { userId: USER_ID, role: null },
        FLEET_REF,
      );

      expect(viewer.followerCount).toBe(7);
      expect(countFollowers).toHaveBeenCalledWith(COMMUNITY_ID);
      expect(isFollowing).toHaveBeenCalledWith(COMMUNITY_ID, USER_ID);
    });

    it('calls somebody who only follows a follower', async () => {
      isFollowing.mockResolvedValue(true);

      const viewer = await service.forScope(
        { userId: USER_ID, role: null },
        FLEET_REF,
      );

      expect(viewer.relationship).toBe(FleetScopeRelationship.FOLLOWER);
      expect(viewer.isFollowingCommunity).toBe(true);
    });

    it('calls an unanswered request a request', async () => {
      authorise.mockResolvedValue(
        authorisation([], ScopeMembershipStatus.PENDING),
      );

      const viewer = await service.forScope(
        { userId: USER_ID, role: null },
        FLEET_REF,
      );

      expect(viewer.relationship).toBe(FleetScopeRelationship.REQUESTED);
    });

    /*
     * Both can be true, which is why they are two fields: the badge says
     * member, and the follow control still has to know which way round it
     * is drawn.
     */
    it('reports a member who also follows as both', async () => {
      authorise.mockResolvedValue(
        authorisation([], ScopeMembershipStatus.APPROVED),
      );
      isFollowing.mockResolvedValue(true);

      const viewer = await service.forScope(
        { userId: USER_ID, role: null },
        FLEET_REF,
      );

      expect(viewer.relationship).toBe(FleetScopeRelationship.MEMBER);
      expect(viewer.isFollowingCommunity).toBe(true);
    });

    it('says so when a membership is suspended', async () => {
      authorise.mockResolvedValue(
        authorisation([], ScopeMembershipStatus.SUSPENDED),
      );

      const viewer = await service.forScope(
        { userId: USER_ID, role: null },
        FLEET_REF,
      );

      expect(viewer.relationship).toBe(FleetScopeRelationship.SUSPENDED);
    });

    /*
     * A membership that ended is history. The record stays for the audit
     * trail, but the page says what is true now rather than greeting
     * somebody with a refusal they already had.
     */
    it.each([
      ScopeMembershipStatus.LEFT,
      ScopeMembershipStatus.REJECTED,
      ScopeMembershipStatus.REVOKED,
    ])('reports a %s membership as nothing at all', async status => {
      authorise.mockResolvedValue(authorisation([], status));

      const viewer = await service.forScope(
        { userId: USER_ID, role: null },
        FLEET_REF,
      );

      expect(viewer.relationship).toBe(FleetScopeRelationship.NONE);
    });
  });

  describe('at a Fleet nobody has registered', () => {
    const empty = { bannerImageId: null, emblemImageId: null };

    it('offers nothing to a caller who is not signed in', async () => {
      await expect(
        service.forStandaloneFleet({ userId: null, role: null }, empty),
      ).resolves.toEqual(NOTHING);
      expect(findOne).not.toHaveBeenCalled();
    });

    /*
     * An empty slot is open to anybody signed in, which is what makes an
     * unregistered Fleet worth having artwork at all.
     */
    it('opens an empty slot to anybody signed in', async () => {
      await expect(
        service.forStandaloneFleet({ userId: USER_ID, role: null }, empty),
      ).resolves.toEqual({
        ...NOTHING,
        mayManageBanner: true,
        mayManageEmblem: true,
      });
      expect(findOne).not.toHaveBeenCalled();
    });

    it('offers a filled slot to whoever filled it', async () => {
      findOne.mockResolvedValue({ ownerUserId: USER_ID });

      await expect(
        service.forStandaloneFleet(
          { userId: USER_ID, role: null },
          { bannerImageId: 'banner-ref', emblemImageId: null },
        ),
      ).resolves.toEqual({
        ...NOTHING,
        mayManageBanner: true,
        mayManageEmblem: true,
      });
      expect(findOne).toHaveBeenCalledWith({
        where: { deliveryReference: 'banner-ref' },
      });
    });

    /*
     * The two slots are answered separately here, which is the whole reason
     * they are two fields: one may be free while the other is somebody
     * else's work.
     */
    it('answers each slot on its own', async () => {
      findOne.mockResolvedValue({ ownerUserId: OTHER_USER_ID });

      await expect(
        service.forStandaloneFleet(
          { userId: USER_ID, role: null },
          { bannerImageId: null, emblemImageId: 'emblem-ref' },
        ),
      ).resolves.toEqual({
        ...NOTHING,
        mayManageBanner: true,
        mayManageEmblem: false,
      });
    });

    /*
     * Nobody can be shown to own a picture whose asset has gone, and the
     * safe reading of that is not "therefore anybody may" — the same reading
     * the upload route takes.
     */
    it('treats a picture with no asset behind it as somebody else’s', async () => {
      findOne.mockResolvedValue(null);

      await expect(
        service.forStandaloneFleet(
          { userId: USER_ID, role: null },
          { bannerImageId: 'banner-ref', emblemImageId: 'emblem-ref' },
        ),
      ).resolves.toEqual(NOTHING);
    });

    it('lets a site administrator displace either picture', async () => {
      findOne.mockResolvedValue({ ownerUserId: OTHER_USER_ID });

      await expect(
        service.forStandaloneFleet(
          { userId: USER_ID, role: UserRole.ADMIN },
          { bannerImageId: 'banner-ref', emblemImageId: 'emblem-ref' },
        ),
      ).resolves.toEqual({
        ...NOTHING,
        mayManageBanner: true,
        mayManageEmblem: true,
      });
      expect(findOne).not.toHaveBeenCalled();
    });

    /*
     * Nothing to hold and nobody to follow. An unregistered Fleet is not a
     * scope: no Community owns it, so no role reaches it, no grant can name
     * it, and there is no subscription for anybody to have.
     */
    it('never reports a capability or a follower, whoever is asking', async () => {
      const viewer = await service.forStandaloneFleet(
        { userId: USER_ID, role: UserRole.ADMIN },
        empty,
      );

      expect(viewer.capabilities).toEqual([]);
      expect(viewer.followerCount).toBeNull();
      expect(authorise).not.toHaveBeenCalled();
      expect(countFollowers).not.toHaveBeenCalled();
    });
  });
});
