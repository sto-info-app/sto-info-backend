import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { jest } from '@jest/globals';
import { IsNull } from 'typeorm';

import { BlockService } from './block.service';
import { CommunityMemberDto } from './dto/community-member.dto';
import { FriendshipEntity } from './entities/friendship.entity';
import { UserBlockEntity } from './entities/user-block.entity';
import { PublicMemberService } from './public-member.service';

const VIEWER_ID = 'viewer-1';
const TARGET_ID = 'target-1';

/**
 * A chainable query-builder test double whose terminal methods are settable.
 */
interface MockQueryBuilder {
  select: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  getMany: jest.Mock<() => Promise<unknown[]>>;
  getExists: jest.Mock<() => Promise<boolean>>;
}

/**
 * Builds a self-returning query-builder mock.
 *
 * @returns A chainable query-builder test double.
 */
function createQueryBuilderMock(): MockQueryBuilder {
  const queryBuilder = {} as MockQueryBuilder;

  for (const method of ['select', 'where', 'andWhere'] as const) {
    queryBuilder[method] = jest.fn(() => queryBuilder);
  }

  queryBuilder.getMany = jest.fn(() => Promise.resolve([] as unknown[]));
  queryBuilder.getExists = jest.fn(() => Promise.resolve(false));

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
 * Builds a block fixture.
 *
 * @param overrides - Fields to override on the fixture.
 * @returns A block-shaped test fixture.
 */
function buildBlock(overrides: Partial<UserBlockEntity> = {}): UserBlockEntity {
  return {
    id: 'block-1',
    blockerId: VIEWER_ID,
    blockedId: TARGET_ID,
    reason: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as UserBlockEntity;
}

describe('BlockService', () => {
  let service: BlockService;
  let blockQb: MockQueryBuilder;
  let friendshipQb: MockQueryBuilder;
  let blockRepository: {
    findOne: jest.Mock<() => Promise<UserBlockEntity | null>>;
    find: jest.Mock<() => Promise<UserBlockEntity[]>>;
    create: jest.Mock;
    save: jest.Mock<(entity: unknown) => Promise<UserBlockEntity>>;
    softRemove: jest.Mock;
    count: jest.Mock<() => Promise<number>>;
    createQueryBuilder: jest.Mock;
  };
  let friendshipRepository: {
    createQueryBuilder: jest.Mock;
    softRemove: jest.Mock;
  };
  let publicMemberService: {
    requireActiveMember: jest.Mock<() => Promise<{ userId: string }>>;
    findMembersByUserIds: jest.Mock<
      () => Promise<Map<string, CommunityMemberDto>>
    >;
  };

  beforeEach(async () => {
    blockQb = createQueryBuilderMock();
    friendshipQb = createQueryBuilderMock();

    blockRepository = {
      findOne: jest.fn(() => Promise.resolve(null as UserBlockEntity | null)),
      find: jest.fn(() => Promise.resolve([] as UserBlockEntity[])),
      create: jest.fn((values: unknown) => values),
      save: jest.fn((entity: unknown) =>
        Promise.resolve(entity as UserBlockEntity),
      ),
      softRemove: jest.fn(() => Promise.resolve(undefined)),
      count: jest.fn(() => Promise.resolve(0)),
      createQueryBuilder: jest.fn(() => blockQb),
    };
    friendshipRepository = {
      createQueryBuilder: jest.fn(() => friendshipQb),
      softRemove: jest.fn(() => Promise.resolve(undefined)),
    };
    publicMemberService = {
      requireActiveMember: jest.fn(() =>
        Promise.resolve({ userId: TARGET_ID }),
      ),
      findMembersByUserIds: jest.fn(() =>
        Promise.resolve(new Map([[TARGET_ID, buildMember()]])),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlockService,
        {
          provide: getRepositoryToken(UserBlockEntity),
          useValue: blockRepository,
        },
        {
          provide: getRepositoryToken(FriendshipEntity),
          useValue: friendshipRepository,
        },
        { provide: PublicMemberService, useValue: publicMemberService },
      ],
    }).compile();

    service = module.get<BlockService>(BlockService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('blockMember', () => {
    it('should refuse a member blocking themselves', async () => {
      publicMemberService.requireActiveMember.mockResolvedValue({
        userId: VIEWER_ID,
      });

      await expect(
        service.blockMember(VIEWER_ID, { username: 'self' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create the block with the private note', async () => {
      const result = await service.blockMember(VIEWER_ID, {
        username: 'captain.picard',
        reason: 'Harassment',
      });

      expect(blockRepository.create).toHaveBeenCalledWith({
        blockerId: VIEWER_ID,
        blockedId: TARGET_ID,
        reason: 'Harassment',
      });
      expect(result.member.username).toBe('captain.picard');
    });

    it('should default the note to null when none is given', async () => {
      await service.blockMember(VIEWER_ID, { username: 'captain.picard' });

      expect(blockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ reason: null }),
      );
    });

    it('should revive a previously lifted block rather than insert a second row', async () => {
      const lifted = buildBlock({
        deletedAt: new Date('2026-07-01T00:00:00.000Z'),
        reason: 'Old note',
      });
      blockRepository.findOne.mockResolvedValue(lifted);

      await service.blockMember(VIEWER_ID, { username: 'captain.picard' });

      expect(blockRepository.create).not.toHaveBeenCalled();
      expect(blockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'block-1', deletedAt: null }),
      );
    });

    it('should keep the existing note when the repeat block supplies none', async () => {
      blockRepository.findOne.mockResolvedValue(buildBlock({ reason: 'Old' }));

      await service.blockMember(VIEWER_ID, { username: 'captain.picard' });

      expect(blockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'Old' }),
      );
    });

    it('should replace the note when the repeat block supplies one', async () => {
      blockRepository.findOne.mockResolvedValue(buildBlock({ reason: 'Old' }));

      await service.blockMember(VIEWER_ID, {
        username: 'captain.picard',
        reason: 'New',
      });

      expect(blockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'New' }),
      );
    });

    it('should tear down an existing friendship in either direction', async () => {
      const friendship = { id: 'friendship-1' } as FriendshipEntity;
      friendshipQb.getMany.mockResolvedValue([friendship]);

      await service.blockMember(VIEWER_ID, { username: 'captain.picard' });

      expect(friendshipQb.where).toHaveBeenCalledWith(
        expect.stringContaining('friendship.requesterId = :userId'),
        { userId: VIEWER_ID, otherUserId: TARGET_ID },
      );
      expect(friendshipRepository.softRemove).toHaveBeenCalledWith([
        friendship,
      ]);
    });

    it('should not touch the friendship table when the pair has none', async () => {
      friendshipQb.getMany.mockResolvedValue([]);

      await service.blockMember(VIEWER_ID, { username: 'captain.picard' });

      expect(friendshipRepository.softRemove).not.toHaveBeenCalled();
    });

    it('should throw when the blocked member is no longer resolvable', async () => {
      publicMemberService.findMembersByUserIds.mockResolvedValue(new Map());

      await expect(
        service.blockMember(VIEWER_ID, { username: 'captain.picard' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('unblockMember', () => {
    it('should throw when the caller has no such live block', async () => {
      blockRepository.findOne.mockResolvedValue(null);

      await expect(service.unblockMember(VIEWER_ID, 'block-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should scope the lookup to the caller and soft-delete the row', async () => {
      const block = buildBlock();
      blockRepository.findOne.mockResolvedValue(block);

      await service.unblockMember(VIEWER_ID, 'block-1');

      expect(blockRepository.findOne).toHaveBeenCalledWith({
        where: {
          id: 'block-1',
          blockerId: VIEWER_ID,
          deletedAt: IsNull(),
        },
      });
      expect(blockRepository.softRemove).toHaveBeenCalledWith(block);
    });
  });

  describe('findBlockedMembers', () => {
    it('should list the caller blocks newest first', async () => {
      blockRepository.find.mockResolvedValue([
        buildBlock({ reason: 'Harassment' }),
      ]);

      const result = await service.findBlockedMembers(VIEWER_ID);

      expect(blockRepository.find).toHaveBeenCalledWith({
        where: { blockerId: VIEWER_ID, deletedAt: IsNull() },
        order: { createdAt: 'DESC' },
      });
      expect(result).toEqual([
        {
          id: 'block-1',
          member: buildMember(),
          blockedAt: new Date('2026-08-01T00:00:00.000Z'),
          reason: 'Harassment',
        },
      ]);
    });

    it('should drop a block whose member is no longer active', async () => {
      blockRepository.find.mockResolvedValue([buildBlock()]);
      publicMemberService.findMembersByUserIds.mockResolvedValue(new Map());

      const result = await service.findBlockedMembers(VIEWER_ID);

      expect(result).toEqual([]);
    });
  });

  describe('getBlockedUserIds', () => {
    it('should return nothing for an anonymous caller', async () => {
      const result = await service.getBlockedUserIds(null);

      expect(result).toEqual([]);
      expect(blockRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should return the other party from blocks in both directions', async () => {
      blockQb.getMany.mockResolvedValue([
        { blockerId: VIEWER_ID, blockedId: 'user-a' },
        { blockerId: 'user-b', blockedId: VIEWER_ID },
      ]);

      const result = await service.getBlockedUserIds(VIEWER_ID);

      expect(result).toEqual(['user-a', 'user-b']);
    });

    it('should de-duplicate a member who blocked and was blocked', async () => {
      blockQb.getMany.mockResolvedValue([
        { blockerId: VIEWER_ID, blockedId: 'user-a' },
        { blockerId: 'user-a', blockedId: VIEWER_ID },
      ]);

      const result = await service.getBlockedUserIds(VIEWER_ID);

      expect(result).toEqual(['user-a']);
    });
  });

  describe('isBlockedBetween', () => {
    it('should report a block held in either direction', async () => {
      blockQb.getExists.mockResolvedValue(true);

      await expect(
        service.isBlockedBetween(VIEWER_ID, TARGET_ID),
      ).resolves.toBe(true);
      expect(blockQb.where).toHaveBeenCalledWith(
        expect.stringContaining('block.blockerId = :userId'),
        { userId: VIEWER_ID, otherUserId: TARGET_ID },
      );
    });

    it('should report no block when the pair is unrelated', async () => {
      blockQb.getExists.mockResolvedValue(false);

      await expect(
        service.isBlockedBetween(VIEWER_ID, TARGET_ID),
      ).resolves.toBe(false);
    });
  });

  describe('findOwnBlock', () => {
    it('should only look for a block the caller holds', async () => {
      const block = buildBlock();
      blockRepository.findOne.mockResolvedValue(block);

      await expect(service.findOwnBlock(VIEWER_ID, TARGET_ID)).resolves.toBe(
        block,
      );
      expect(blockRepository.findOne).toHaveBeenCalledWith({
        where: {
          blockerId: VIEWER_ID,
          blockedId: TARGET_ID,
          deletedAt: IsNull(),
        },
      });
    });
  });

  describe('countBlocked', () => {
    it('should count only the caller live blocks', async () => {
      blockRepository.count.mockResolvedValue(4);

      await expect(service.countBlocked(VIEWER_ID)).resolves.toBe(4);
      expect(blockRepository.count).toHaveBeenCalledWith({
        where: { blockerId: VIEWER_ID, deletedAt: IsNull() },
      });
    });
  });
});
