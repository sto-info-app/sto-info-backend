import { jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserProfileEntity } from '../user/entities/user-profile.entity';
import { AccountEntity } from '../sto/account/entities/account.entity';
import { PublicMemberService } from './public-member.service';

/**
 * A chainable query-builder test double whose terminal methods are settable.
 */
interface MockQueryBuilder {
  select: jest.Mock;
  addSelect: jest.Mock;
  innerJoin: jest.Mock;
  innerJoinAndSelect: jest.Mock;
  leftJoin: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  groupBy: jest.Mock;
  getOne: jest.Mock<() => Promise<unknown>>;
  getMany: jest.Mock<() => Promise<unknown[]>>;
  getRawMany: jest.Mock<() => Promise<unknown[]>>;
}

/**
 * Builds a self-returning query-builder mock.
 *
 * @returns A chainable query-builder test double.
 */
function createQueryBuilderMock(): MockQueryBuilder {
  const queryBuilder = {} as MockQueryBuilder;

  const chainable = [
    'select',
    'addSelect',
    'innerJoin',
    'innerJoinAndSelect',
    'leftJoin',
    'where',
    'andWhere',
    'groupBy',
  ] as const;

  for (const method of chainable) {
    queryBuilder[method] = jest.fn(() => queryBuilder);
  }

  queryBuilder.getOne = jest.fn(() => Promise.resolve(null as unknown));
  queryBuilder.getMany = jest.fn(() => Promise.resolve([] as unknown[]));
  queryBuilder.getRawMany = jest.fn(() => Promise.resolve([] as unknown[]));

  return queryBuilder;
}

/**
 * Builds a profile fixture carrying the private fields that must never leak.
 *
 * @param overrides - Fields to override on the fixture.
 * @returns A profile-shaped test fixture.
 */
function buildProfile(
  overrides: Partial<UserProfileEntity> = {},
): UserProfileEntity {
  return {
    userId: 'user-1',
    username: 'captain.picard',
    firstName: 'Jean-Luc',
    lastName: 'Picard',
    profilePictureId: 'pic-1',
    profilePicture100: 'https://imagedelivery.net/hash/pic-1/square100',
    profilePicture300: 'https://imagedelivery.net/hash/pic-1/square300',
    publiclyVisible: true,
    createdAt: new Date('2026-01-14T09:21:00.000Z'),
    user: {
      id: 'user-1',
      email: 'picard@example.com',
      lastLoginAt: new Date('2026-08-01T12:00:00.000Z'),
    },
    ...overrides,
  } as unknown as UserProfileEntity;
}

describe('PublicMemberService', () => {
  let service: PublicMemberService;
  let profileQb: MockQueryBuilder;
  let accountQb: MockQueryBuilder;

  beforeEach(async () => {
    profileQb = createQueryBuilderMock();
    accountQb = createQueryBuilderMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublicMemberService,
        {
          provide: getRepositoryToken(UserProfileEntity),
          useValue: { createQueryBuilder: jest.fn(() => profileQb) },
        },
        {
          provide: getRepositoryToken(AccountEntity),
          useValue: { createQueryBuilder: jest.fn(() => accountQb) },
        },
      ],
    }).compile();

    service = module.get<PublicMemberService>(PublicMemberService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('requireActiveMember', () => {
    it('should throw when no active member matches', async () => {
      profileQb.getOne.mockResolvedValue(null);

      await expect(service.requireActiveMember('ghost')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should match the username case-insensitively', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());

      const result = await service.requireActiveMember('CAPTAIN.PICARD');

      expect(profileQb.where).toHaveBeenCalledWith(
        'LOWER(profile.username) = LOWER(:username)',
        { username: 'CAPTAIN.PICARD' },
      );
      expect(result.userId).toBe('user-1');
    });

    it('should not require a public record, so a private member can be blocked', async () => {
      profileQb.getOne.mockResolvedValue(
        buildProfile({ publiclyVisible: false }),
      );

      const result = await service.requireActiveMember('captain.picard');

      const conditions = profileQb.andWhere.mock.calls.map(call => call[0]);
      expect(conditions).not.toContain('profile.publiclyVisible = true');
      expect(result.publiclyVisible).toBe(false);
    });

    it('should exclude deleted and disabled members', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());

      await service.requireActiveMember('captain.picard');

      const conditions = profileQb.andWhere.mock.calls.map(call => call[0]);
      expect(conditions).toContain('profile.deletedAt IS NULL');
      expect(conditions).toContain('user.deletedAt IS NULL');
      expect(conditions).toContain('user.isAccountDisabled = false');
    });
  });

  describe('findMembersByUserIds', () => {
    it('should return an empty map without querying for no IDs', async () => {
      const result = await service.findMembersByUserIds([]);

      expect(result.size).toBe(0);
      expect(profileQb.getMany).not.toHaveBeenCalled();
    });

    it('should map each member onto its public summary', async () => {
      profileQb.getMany.mockResolvedValue([buildProfile()]);
      accountQb.getRawMany.mockResolvedValue([
        { userId: 'user-1', accountCount: '2', characterCount: '11' },
      ]);

      const result = await service.findMembersByUserIds(['user-1']);

      expect(result.get('user-1')).toEqual({
        username: 'captain.picard',
        profilePicture100: 'https://imagedelivery.net/hash/pic-1/square100',
        profilePicture300: 'https://imagedelivery.net/hash/pic-1/square300',
        joinedAt: new Date('2026-01-14T09:21:00.000Z'),
        lastActiveAt: new Date('2026-08-01T12:00:00.000Z'),
        publicAccountCount: 2,
        publicCharacterCount: 11,
        publiclyVisible: true,
      });
    });

    it('should omit a member whose account is gone', async () => {
      profileQb.getMany.mockResolvedValue([]);

      const result = await service.findMembersByUserIds(['user-1']);

      expect(result.has('user-1')).toBe(false);
    });

    it('should report zero counts for a member with no visible accounts', async () => {
      profileQb.getMany.mockResolvedValue([buildProfile()]);
      accountQb.getRawMany.mockResolvedValue([]);

      const result = await service.findMembersByUserIds(['user-1']);

      expect(result.get('user-1')?.publicAccountCount).toBe(0);
      expect(result.get('user-1')?.publicCharacterCount).toBe(0);
    });

    it('should report a null last active date when the member never signed in', async () => {
      profileQb.getMany.mockResolvedValue([buildProfile({ user: undefined })]);

      const result = await service.findMembersByUserIds(['user-1']);

      expect(result.get('user-1')?.lastActiveAt).toBeNull();
    });

    it('should flag a member who has since gone private', async () => {
      profileQb.getMany.mockResolvedValue([
        buildProfile({ publiclyVisible: false }),
      ]);

      const result = await service.findMembersByUserIds(['user-1']);

      expect(result.get('user-1')?.publiclyVisible).toBe(false);
    });
  });

  describe('countPublicEntitiesForUsers', () => {
    it('should return an empty map without querying for no IDs', async () => {
      const result = await service.countPublicEntitiesForUsers([]);

      expect(result.size).toBe(0);
      expect(accountQb.getRawMany).not.toHaveBeenCalled();
    });

    it('should only count visible, non-deleted accounts and captains', async () => {
      await service.countPublicEntitiesForUsers(['user-1']);

      const conditions = accountQb.andWhere.mock.calls.map(call => call[0]);
      expect(conditions).toContain('account.publiclyVisible = true');
      expect(conditions).toContain('account.deletedAt IS NULL');
      expect(accountQb.leftJoin).toHaveBeenCalledWith(
        'account.characters',
        'character',
        'character.publiclyVisible = true AND character.deletedAt IS NULL',
      );
    });

    it('should coerce the raw string counts to numbers', async () => {
      accountQb.getRawMany.mockResolvedValue([
        { userId: 'user-1', accountCount: '3', characterCount: '7' },
      ]);

      const result = await service.countPublicEntitiesForUsers(['user-1']);

      expect(result.get('user-1')).toEqual({
        accountCount: 3,
        characterCount: 7,
      });
    });
  });
});
