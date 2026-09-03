import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { jest } from '@jest/globals';
import { IsNull } from 'typeorm';

import { NotificationSeverity } from '../notification/enums/notification-severity.enum';
import { NotificationTarget } from '../notification/enums/notification-target.enum';
import { NotificationService } from '../notification/notification.service';
import { UserProfileEntity } from '../user/entities/user-profile.entity';
import { BlockService } from './block.service';
import { CommunityMemberDto } from './dto/community-member.dto';
import { FriendshipEntity } from './entities/friendship.entity';
import { FriendRequestDirection } from './enums/friend-request-direction.enum';
import { FriendshipStatus } from './enums/friendship-status.enum';
import { RelationshipStatus } from './enums/relationship-status.enum';
import { FriendshipService } from './friendship.service';
import { PublicMemberService } from './public-member.service';

const VIEWER_ID = 'viewer-1';
const TARGET_ID = 'target-1';

/**
 * A chainable query-builder test double whose terminal methods are settable.
 */
interface MockQueryBuilder {
  innerJoin: jest.Mock;
  addSelect: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  setParameters: jest.Mock;
  skip: jest.Mock;
  take: jest.Mock;
  getOne: jest.Mock<() => Promise<unknown>>;
  getCount: jest.Mock<() => Promise<number>>;
  getMany: jest.Mock<() => Promise<unknown[]>>;
  getManyAndCount: jest.Mock<() => Promise<[unknown[], number]>>;
}

/**
 * Builds a self-returning query-builder mock.
 *
 * @returns A chainable query-builder test double.
 */
function createQueryBuilderMock(): MockQueryBuilder {
  const queryBuilder = {} as MockQueryBuilder;

  const chainable = [
    'innerJoin',
    'addSelect',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'setParameters',
    'skip',
    'take',
  ] as const;

  for (const method of chainable) {
    queryBuilder[method] = jest.fn(() => queryBuilder);
  }

  queryBuilder.getOne = jest.fn(() => Promise.resolve(null as unknown));
  queryBuilder.getCount = jest.fn(() => Promise.resolve(0));
  queryBuilder.getMany = jest.fn(() => Promise.resolve([] as unknown[]));
  queryBuilder.getManyAndCount = jest.fn(() =>
    Promise.resolve([[], 0] as [unknown[], number]),
  );

  return queryBuilder;
}

/**
 * Builds a member summary fixture.
 *
 * @param overrides - Fields to override on the fixture.
 * @returns A member summary.
 */
function buildMember(
  overrides: Partial<CommunityMemberDto> = {},
): CommunityMemberDto {
  return {
    username: 'captain.picard',
    profilePicture100: null,
    profilePicture300: null,
    joinedAt: new Date('2026-01-14T09:21:00.000Z'),
    lastActiveAt: null,
    playingSince: null,
    publicAccountCount: 0,
    publicCharacterCount: 0,
    publiclyVisible: true,
    ...overrides,
  };
}

/**
 * Builds a friendship fixture, including the entity's `otherUserId` helper
 * that the service relies on.
 *
 * @param overrides - Fields to override on the fixture.
 * @returns A friendship-shaped test fixture.
 */
function buildFriendship(
  overrides: Partial<FriendshipEntity> = {},
): FriendshipEntity {
  const friendship = {
    id: 'friendship-1',
    requesterId: VIEWER_ID,
    addresseeId: TARGET_ID,
    status: FriendshipStatus.PENDING,
    respondedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as FriendshipEntity;

  friendship.otherUserId = (userId: string) =>
    friendship.requesterId === userId
      ? friendship.addresseeId
      : friendship.requesterId;

  return friendship;
}

/**
 * Builds a profile fixture for the request recipient.
 *
 * @param overrides - Fields to override on the fixture.
 * @returns A profile-shaped test fixture.
 */
function buildTargetProfile(
  overrides: Partial<UserProfileEntity> = {},
): UserProfileEntity {
  return {
    userId: TARGET_ID,
    username: 'captain.picard',
    publiclyVisible: true,
    ...overrides,
  } as UserProfileEntity;
}

describe('FriendshipService', () => {
  let service: FriendshipService;
  let friendshipQb: MockQueryBuilder;
  let friendshipRepository: {
    findOne: jest.Mock<() => Promise<FriendshipEntity | null>>;
    find: jest.Mock<() => Promise<FriendshipEntity[]>>;
    create: jest.Mock;
    save: jest.Mock<(entity: unknown) => Promise<FriendshipEntity>>;
    softRemove: jest.Mock;
    count: jest.Mock<() => Promise<number>>;
    createQueryBuilder: jest.Mock;
  };
  let publicMemberService: {
    requireActiveMember: jest.Mock<() => Promise<UserProfileEntity>>;
    findMembersByUserIds: jest.Mock<
      () => Promise<Map<string, CommunityMemberDto>>
    >;
  };
  let blockService: {
    isBlockedBetween: jest.Mock<() => Promise<boolean>>;
    findOwnBlock: jest.Mock<() => Promise<{ id: string } | null>>;
    countBlocked: jest.Mock<() => Promise<number>>;
  };
  let notificationService: { createNotification: jest.Mock };
  const originalFrontendUrl = process.env.APP_FRONTEND_URL;

  beforeEach(async () => {
    process.env.APP_FRONTEND_URL = 'https://sto.example';

    friendshipQb = createQueryBuilderMock();

    friendshipRepository = {
      findOne: jest.fn(() => Promise.resolve(null as FriendshipEntity | null)),
      find: jest.fn(() => Promise.resolve([] as FriendshipEntity[])),
      create: jest.fn((values: unknown) => buildFriendship(values as object)),
      save: jest.fn((entity: unknown) =>
        Promise.resolve(entity as FriendshipEntity),
      ),
      softRemove: jest.fn(() => Promise.resolve(undefined)),
      count: jest.fn(() => Promise.resolve(0)),
      createQueryBuilder: jest.fn(() => friendshipQb),
    };
    publicMemberService = {
      requireActiveMember: jest.fn(() => Promise.resolve(buildTargetProfile())),
      findMembersByUserIds: jest.fn(() =>
        Promise.resolve(
          new Map([
            [TARGET_ID, buildMember()],
            [VIEWER_ID, buildMember({ username: 'captain.sisko' })],
          ]),
        ),
      ),
    };
    blockService = {
      isBlockedBetween: jest.fn(() => Promise.resolve(false)),
      findOwnBlock: jest.fn(() => Promise.resolve(null)),
      countBlocked: jest.fn(() => Promise.resolve(0)),
    };
    notificationService = {
      createNotification: jest.fn(() => Promise.resolve({})),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FriendshipService,
        {
          provide: getRepositoryToken(FriendshipEntity),
          useValue: friendshipRepository,
        },
        { provide: PublicMemberService, useValue: publicMemberService },
        { provide: BlockService, useValue: blockService },
        { provide: NotificationService, useValue: notificationService },
      ],
    }).compile();

    service = module.get<FriendshipService>(FriendshipService);
  });

  afterEach(() => {
    if (originalFrontendUrl === undefined) {
      delete process.env.APP_FRONTEND_URL;
    } else {
      process.env.APP_FRONTEND_URL = originalFrontendUrl;
    }
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendRequest', () => {
    it('should refuse a member adding themselves', async () => {
      publicMemberService.requireActiveMember.mockResolvedValue(
        buildTargetProfile({ userId: VIEWER_ID }),
      );

      await expect(
        service.sendRequest(VIEWER_ID, { username: 'self' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should refuse a member who has no public record', async () => {
      publicMemberService.requireActiveMember.mockResolvedValue(
        buildTargetProfile({ publiclyVisible: false }),
      );

      await expect(
        service.sendRequest(VIEWER_ID, { username: 'private.member' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should refuse when a block stands between the two', async () => {
      blockService.isBlockedBetween.mockResolvedValue(true);

      await expect(
        service.sendRequest(VIEWER_ID, { username: 'captain.picard' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should create a pending request and notify the recipient', async () => {
      const result = await service.sendRequest(VIEWER_ID, {
        username: 'captain.picard',
      });

      expect(friendshipRepository.create).toHaveBeenCalledWith({
        requesterId: VIEWER_ID,
        addresseeId: TARGET_ID,
        status: FriendshipStatus.PENDING,
      });
      expect(notificationService.createNotification).toHaveBeenCalledWith({
        target: NotificationTarget.USER,
        userId: TARGET_ID,
        severity: NotificationSeverity.INFO,
        title: 'New friend request',
        body: 'captain.sisko would like to add you as a friend.',
        linkUrl: 'https://sto.example/community/friends',
      });
      expect(result).toEqual(
        expect.objectContaining({
          direction: FriendRequestDirection.OUTGOING,
        }),
      );
    });

    it('should omit the deep link when the frontend URL is unset', async () => {
      delete process.env.APP_FRONTEND_URL;

      await service.sendRequest(VIEWER_ID, { username: 'captain.picard' });

      expect(notificationService.createNotification).toHaveBeenCalledWith(
        expect.not.objectContaining({ linkUrl: expect.anything() }),
      );
    });

    it('should still create the friendship when the notification fails', async () => {
      notificationService.createNotification.mockImplementation(() => {
        throw new Error('inbox unavailable');
      });

      await expect(
        service.sendRequest(VIEWER_ID, { username: 'captain.picard' }),
      ).resolves.toBeDefined();
    });

    it('should fall back to neutral copy when the sender cannot be named', async () => {
      publicMemberService.findMembersByUserIds.mockImplementation(
        (...args: unknown[]) => {
          const [userIds] = args as [string[]];
          return Promise.resolve(
            userIds.includes(TARGET_ID)
              ? new Map([[TARGET_ID, buildMember()]])
              : new Map<string, CommunityMemberDto>(),
          );
        },
      );

      await service.sendRequest(VIEWER_ID, { username: 'captain.picard' });

      expect(notificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          body: 'A member would like to add you as a friend.',
        }),
      );
    });

    it('should reject a repeat request when the pair is already friends', async () => {
      friendshipQb.getOne.mockResolvedValue(
        buildFriendship({ status: FriendshipStatus.ACCEPTED }),
      );

      await expect(
        service.sendRequest(VIEWER_ID, { username: 'captain.picard' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject a repeat request the caller already sent', async () => {
      friendshipQb.getOne.mockResolvedValue(buildFriendship());

      await expect(
        service.sendRequest(VIEWER_ID, { username: 'captain.picard' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should accept the pending request when the recipient asked first', async () => {
      friendshipQb.getOne.mockResolvedValue(
        buildFriendship({
          requesterId: TARGET_ID,
          addresseeId: VIEWER_ID,
        }),
      );

      const result = await service.sendRequest(VIEWER_ID, {
        username: 'captain.picard',
      });

      expect(friendshipRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: FriendshipStatus.ACCEPTED }),
      );
      expect(notificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TARGET_ID,
          title: 'Friend request accepted',
        }),
      );
      expect(result).toEqual(expect.objectContaining({ id: 'friendship-1' }));
    });

    it('should revive a declined row in the caller direction', async () => {
      friendshipQb.getOne.mockResolvedValue(
        buildFriendship({
          requesterId: TARGET_ID,
          addresseeId: VIEWER_ID,
          status: FriendshipStatus.DECLINED,
          respondedAt: new Date('2026-07-01T00:00:00.000Z'),
        }),
      );

      const result = await service.sendRequest(VIEWER_ID, {
        username: 'captain.picard',
      });

      expect(friendshipRepository.create).not.toHaveBeenCalled();
      expect(friendshipRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          requesterId: VIEWER_ID,
          addresseeId: TARGET_ID,
          status: FriendshipStatus.PENDING,
          respondedAt: null,
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          direction: FriendRequestDirection.OUTGOING,
        }),
      );
    });

    it('should throw when the new request member cannot be resolved', async () => {
      publicMemberService.findMembersByUserIds.mockResolvedValue(new Map());

      await expect(
        service.sendRequest(VIEWER_ID, { username: 'captain.picard' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('acceptRequest', () => {
    it('should throw when the caller has no such pending request', async () => {
      friendshipRepository.findOne.mockResolvedValue(null);

      await expect(
        service.acceptRequest(VIEWER_ID, 'friendship-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should only match a pending request addressed to the caller', async () => {
      friendshipRepository.findOne.mockResolvedValue(
        buildFriendship({ requesterId: TARGET_ID, addresseeId: VIEWER_ID }),
      );

      await service.acceptRequest(VIEWER_ID, 'friendship-1');

      expect(friendshipRepository.findOne).toHaveBeenCalledWith({
        where: {
          id: 'friendship-1',
          addresseeId: VIEWER_ID,
          status: FriendshipStatus.PENDING,
          deletedAt: IsNull(),
        },
      });
    });

    it('should refuse a request that a later block now covers', async () => {
      friendshipRepository.findOne.mockResolvedValue(
        buildFriendship({ requesterId: TARGET_ID, addresseeId: VIEWER_ID }),
      );
      blockService.isBlockedBetween.mockResolvedValue(true);

      await expect(
        service.acceptRequest(VIEWER_ID, 'friendship-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should mark the friendship accepted and notify the requester', async () => {
      friendshipRepository.findOne.mockResolvedValue(
        buildFriendship({ requesterId: TARGET_ID, addresseeId: VIEWER_ID }),
      );

      const result = await service.acceptRequest(VIEWER_ID, 'friendship-1');

      expect(friendshipRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: FriendshipStatus.ACCEPTED,
          respondedAt: expect.any(Date),
        }),
      );
      expect(notificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TARGET_ID,
          title: 'Friend request accepted',
          body: 'captain.sisko accepted your friend request.',
        }),
      );
      expect(result.id).toBe('friendship-1');
    });

    it('should throw when the new friend cannot be resolved', async () => {
      friendshipRepository.findOne.mockResolvedValue(
        buildFriendship({ requesterId: TARGET_ID, addresseeId: VIEWER_ID }),
      );
      publicMemberService.findMembersByUserIds.mockResolvedValue(new Map());

      await expect(
        service.acceptRequest(VIEWER_ID, 'friendship-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('declineRequest', () => {
    it('should throw when the caller has no such pending request', async () => {
      friendshipRepository.findOne.mockResolvedValue(null);

      await expect(
        service.declineRequest(VIEWER_ID, 'friendship-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should keep the row as declined and tell nobody', async () => {
      friendshipRepository.findOne.mockResolvedValue(
        buildFriendship({ requesterId: TARGET_ID, addresseeId: VIEWER_ID }),
      );

      await service.declineRequest(VIEWER_ID, 'friendship-1');

      expect(friendshipRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: FriendshipStatus.DECLINED,
          respondedAt: expect.any(Date),
        }),
      );
      expect(friendshipRepository.softRemove).not.toHaveBeenCalled();
      expect(notificationService.createNotification).not.toHaveBeenCalled();
    });
  });

  describe('cancelRequest', () => {
    it('should throw when the caller sent no such pending request', async () => {
      friendshipRepository.findOne.mockResolvedValue(null);

      await expect(
        service.cancelRequest(VIEWER_ID, 'friendship-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should soft-delete the row so the pair can ask again', async () => {
      const friendship = buildFriendship();
      friendshipRepository.findOne.mockResolvedValue(friendship);

      await service.cancelRequest(VIEWER_ID, 'friendship-1');

      expect(friendshipRepository.findOne).toHaveBeenCalledWith({
        where: {
          id: 'friendship-1',
          requesterId: VIEWER_ID,
          status: FriendshipStatus.PENDING,
          deletedAt: IsNull(),
        },
      });
      expect(friendshipRepository.softRemove).toHaveBeenCalledWith(friendship);
    });
  });

  describe('removeFriend', () => {
    it('should throw when the caller has no such friendship', async () => {
      friendshipQb.getOne.mockResolvedValue(null);

      await expect(
        service.removeFriend(VIEWER_ID, 'friendship-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should let either party end the friendship', async () => {
      const friendship = buildFriendship({
        status: FriendshipStatus.ACCEPTED,
        requesterId: TARGET_ID,
        addresseeId: VIEWER_ID,
      });
      friendshipQb.getOne.mockResolvedValue(friendship);

      await service.removeFriend(VIEWER_ID, 'friendship-1');

      expect(friendshipQb.andWhere).toHaveBeenCalledWith(
        '(friendship.requesterId = :userId OR friendship.addresseeId = :userId)',
        { userId: VIEWER_ID },
      );
      expect(friendshipRepository.softRemove).toHaveBeenCalledWith(friendship);
    });
  });

  describe('findFriends', () => {
    it('should default to page 1 with a page size of 12', async () => {
      await service.findFriends(VIEWER_ID, {});

      expect(friendshipQb.skip).toHaveBeenCalledWith(0);
      expect(friendshipQb.take).toHaveBeenCalledWith(12);
    });

    it('should clamp the page size to the 50 item maximum', async () => {
      await service.findFriends(VIEWER_ID, { pageSize: 500 });

      expect(friendshipQb.take).toHaveBeenCalledWith(50);
    });

    it('should fall back to the default page size when given zero', async () => {
      await service.findFriends(VIEWER_ID, { pageSize: 0 });

      expect(friendshipQb.take).toHaveBeenCalledWith(12);
    });

    it('should fall back to page 1 when given a non-positive page', async () => {
      await service.findFriends(VIEWER_ID, { page: 0 });

      expect(friendshipQb.skip).toHaveBeenCalledWith(0);
    });

    it('should offset by page size for later pages', async () => {
      await service.findFriends(VIEWER_ID, { page: 3, pageSize: 10 });

      expect(friendshipQb.skip).toHaveBeenCalledWith(20);
    });

    it('should order alphabetically by the other member username', async () => {
      await service.findFriends(VIEWER_ID, {});

      expect(friendshipQb.addSelect).toHaveBeenCalledWith(
        expect.stringContaining('addresseeProfile.username'),
        'friend_username_lower',
      );
      expect(friendshipQb.orderBy).toHaveBeenCalledWith(
        'friend_username_lower',
        'ASC',
      );
      expect(friendshipQb.addOrderBy).toHaveBeenCalledWith(
        'friendship.id',
        'ASC',
      );
    });

    it('should not filter when no search term is supplied', async () => {
      await service.findFriends(VIEWER_ID, {});

      const conditions = friendshipQb.andWhere.mock.calls.map(call => call[0]);
      expect(
        conditions.some(
          condition =>
            typeof condition === 'string' && condition.includes('LIKE :search'),
        ),
      ).toBe(false);
    });

    it('should not filter when the search term is only whitespace', async () => {
      await service.findFriends(VIEWER_ID, { search: '   ' });

      const conditions = friendshipQb.andWhere.mock.calls.map(call => call[0]);
      expect(
        conditions.some(
          condition =>
            typeof condition === 'string' && condition.includes('LIKE :search'),
        ),
      ).toBe(false);
    });

    it('should escape LIKE wildcards so they match literally', async () => {
      await service.findFriends(VIEWER_ID, { search: '100%_a\\b' });

      expect(friendshipQb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('LIKE :search'),
        { search: '%100\\%\\_a\\\\b%' },
      );
    });

    it('should map each friendship onto the other member', async () => {
      friendshipQb.getManyAndCount.mockResolvedValue([
        [
          buildFriendship({
            status: FriendshipStatus.ACCEPTED,
            respondedAt: new Date('2026-08-02T00:00:00.000Z'),
          }),
        ],
        1,
      ]);

      const result = await service.findFriends(VIEWER_ID, { page: 2 });

      expect(result).toEqual({
        items: [
          {
            id: 'friendship-1',
            member: buildMember(),
            friendsSince: new Date('2026-08-02T00:00:00.000Z'),
          },
        ],
        total: 1,
        page: 2,
        pageSize: 12,
      });
    });

    it('should drop a friendship whose other member is no longer active', async () => {
      friendshipQb.getManyAndCount.mockResolvedValue([
        [buildFriendship({ status: FriendshipStatus.ACCEPTED })],
        1,
      ]);
      publicMemberService.findMembersByUserIds.mockResolvedValue(new Map());

      const result = await service.findFriends(VIEWER_ID, {});

      expect(result.items).toEqual([]);
    });
  });

  describe('findRequests', () => {
    it('should scope incoming requests to the addressee', async () => {
      await service.findRequests(VIEWER_ID, FriendRequestDirection.INCOMING);

      expect(friendshipRepository.find).toHaveBeenCalledWith({
        where: {
          addresseeId: VIEWER_ID,
          status: FriendshipStatus.PENDING,
          deletedAt: IsNull(),
        },
        order: { createdAt: 'DESC' },
      });
    });

    it('should scope outgoing requests to the requester', async () => {
      await service.findRequests(VIEWER_ID, FriendRequestDirection.OUTGOING);

      expect(friendshipRepository.find).toHaveBeenCalledWith({
        where: {
          requesterId: VIEWER_ID,
          status: FriendshipStatus.PENDING,
          deletedAt: IsNull(),
        },
        order: { createdAt: 'DESC' },
      });
    });

    it('should map each request onto the other member', async () => {
      friendshipRepository.find.mockResolvedValue([buildFriendship()]);

      const result = await service.findRequests(
        VIEWER_ID,
        FriendRequestDirection.OUTGOING,
      );

      expect(result).toEqual([
        {
          id: 'friendship-1',
          direction: FriendRequestDirection.OUTGOING,
          member: buildMember(),
          requestedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ]);
    });

    it('should drop a request whose other member is no longer active', async () => {
      friendshipRepository.find.mockResolvedValue([buildFriendship()]);
      publicMemberService.findMembersByUserIds.mockResolvedValue(new Map());

      const result = await service.findRequests(
        VIEWER_ID,
        FriendRequestDirection.INCOMING,
      );

      expect(result).toEqual([]);
    });
  });

  describe('getSummary', () => {
    it('should report the friend, request and block counts', async () => {
      friendshipQb.getCount.mockResolvedValue(17);
      friendshipRepository.count
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1);
      blockService.countBlocked.mockResolvedValue(3);

      const result = await service.getSummary(VIEWER_ID);

      expect(result).toEqual({
        friendCount: 17,
        incomingRequestCount: 2,
        outgoingRequestCount: 1,
        blockedCount: 3,
      });
    });
  });

  describe('getRelationship', () => {
    it('should report the caller looking at their own record', async () => {
      const result = await service.getRelationship(VIEWER_ID, VIEWER_ID);

      expect(result).toEqual({
        status: RelationshipStatus.SELF,
        friendshipId: null,
        blockId: null,
      });
    });

    it('should report a block the caller holds, with the row to lift it', async () => {
      blockService.findOwnBlock.mockResolvedValue({ id: 'block-1' });

      const result = await service.getRelationship(VIEWER_ID, TARGET_ID);

      expect(result).toEqual({
        status: RelationshipStatus.BLOCKED,
        friendshipId: null,
        blockId: 'block-1',
      });
    });

    it('should report no relationship when the pair has no row', async () => {
      friendshipQb.getOne.mockResolvedValue(null);

      const result = await service.getRelationship(VIEWER_ID, TARGET_ID);

      expect(result).toEqual({
        status: RelationshipStatus.NONE,
        friendshipId: null,
        blockId: null,
      });
    });

    it('should report no relationship for a declined row', async () => {
      friendshipQb.getOne.mockResolvedValue(
        buildFriendship({ status: FriendshipStatus.DECLINED }),
      );

      const result = await service.getRelationship(VIEWER_ID, TARGET_ID);

      expect(result.status).toBe(RelationshipStatus.NONE);
      expect(result.friendshipId).toBeNull();
    });

    it('should report a request the caller sent', async () => {
      friendshipQb.getOne.mockResolvedValue(buildFriendship());

      const result = await service.getRelationship(VIEWER_ID, TARGET_ID);

      expect(result).toEqual({
        status: RelationshipStatus.REQUEST_SENT,
        friendshipId: 'friendship-1',
        blockId: null,
      });
    });

    it('should report a request the caller received', async () => {
      friendshipQb.getOne.mockResolvedValue(
        buildFriendship({ requesterId: TARGET_ID, addresseeId: VIEWER_ID }),
      );

      const result = await service.getRelationship(VIEWER_ID, TARGET_ID);

      expect(result.status).toBe(RelationshipStatus.REQUEST_RECEIVED);
    });

    it('should report an accepted friendship', async () => {
      friendshipQb.getOne.mockResolvedValue(
        buildFriendship({ status: FriendshipStatus.ACCEPTED }),
      );

      const result = await service.getRelationship(VIEWER_ID, TARGET_ID);

      expect(result.status).toBe(RelationshipStatus.FRIENDS);
    });
  });

  describe('getRelationships', () => {
    it('should return an empty map without querying for no IDs', async () => {
      const result = await service.getRelationships(VIEWER_ID, []);

      expect(result.size).toBe(0);
      expect(friendshipQb.getMany).not.toHaveBeenCalled();
    });

    it('should report no relationship for a member with no friendship row', async () => {
      friendshipQb.getMany.mockResolvedValue([]);

      const result = await service.getRelationships(VIEWER_ID, [TARGET_ID]);

      expect(result.get(TARGET_ID)).toEqual({
        status: RelationshipStatus.NONE,
        friendshipId: null,
        blockId: null,
      });
    });

    it('should report the caller own entry as self', async () => {
      friendshipQb.getMany.mockResolvedValue([]);

      const result = await service.getRelationships(VIEWER_ID, [
        VIEWER_ID,
        TARGET_ID,
      ]);

      expect(result.get(VIEWER_ID)?.status).toBe(RelationshipStatus.SELF);
    });

    it('should key each friendship by the other member', async () => {
      friendshipQb.getMany.mockResolvedValue([
        buildFriendship({ status: FriendshipStatus.ACCEPTED }),
        buildFriendship({
          id: 'friendship-2',
          requesterId: 'target-2',
          addresseeId: VIEWER_ID,
        }),
      ]);

      const result = await service.getRelationships(VIEWER_ID, [
        TARGET_ID,
        'target-2',
      ]);

      expect(result.get(TARGET_ID)).toEqual({
        status: RelationshipStatus.FRIENDS,
        friendshipId: 'friendship-1',
        blockId: null,
      });
      expect(result.get('target-2')).toEqual({
        status: RelationshipStatus.REQUEST_RECEIVED,
        friendshipId: 'friendship-2',
        blockId: null,
      });
    });

    it('should report a declined row as no relationship, so the caller may ask again', async () => {
      friendshipQb.getMany.mockResolvedValue([
        buildFriendship({ status: FriendshipStatus.DECLINED }),
      ]);

      const result = await service.getRelationships(VIEWER_ID, [TARGET_ID]);

      expect(result.get(TARGET_ID)).toEqual({
        status: RelationshipStatus.NONE,
        friendshipId: null,
        blockId: null,
      });
    });

    it('should resolve every member in one query', async () => {
      friendshipQb.getMany.mockResolvedValue([]);

      await service.getRelationships(VIEWER_ID, [TARGET_ID, 'target-2']);

      expect(friendshipRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(friendshipQb.where).toHaveBeenCalledWith(
        expect.stringContaining('friendship.addresseeId IN (:...otherUserIds)'),
        { userId: VIEWER_ID, otherUserIds: [TARGET_ID, 'target-2'] },
      );
    });

    it('should not consult blocking, which the listing has already excluded', async () => {
      friendshipQb.getMany.mockResolvedValue([]);

      await service.getRelationships(VIEWER_ID, [TARGET_ID]);

      expect(blockService.findOwnBlock).not.toHaveBeenCalled();
    });
  });

  describe('findFriendshipBetween', () => {
    it('should look the pair up in either direction', async () => {
      const friendship = buildFriendship();
      friendshipQb.getOne.mockResolvedValue(friendship);

      await expect(
        service.findFriendshipBetween(VIEWER_ID, TARGET_ID),
      ).resolves.toBe(friendship);
      expect(friendshipQb.where).toHaveBeenCalledWith(
        expect.stringContaining('friendship.requesterId = :otherUserId'),
        { userId: VIEWER_ID, otherUserId: TARGET_ID },
      );
    });
  });
});
