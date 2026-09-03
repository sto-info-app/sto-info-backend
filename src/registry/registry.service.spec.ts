import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { jest } from '@jest/globals';

import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { BlockService } from '../community/block.service';
import { RelationshipDto } from '../community/dto/friendship.dto';
import { RelationshipStatus } from '../community/enums/relationship-status.enum';
import { FriendshipService } from '../community/friendship.service';
import {
  PublicMemberService,
  PublicMemberStats,
} from '../community/public-member.service';
import { AccountEntity } from '../sto/account/entities/account.entity';
import { CharacterEntity } from '../sto/character/entities/character.entity';
import { PlatformLauncherEntity } from '../sto/platform-launcher/entities/platform-launcher.entity';
import { RegistrySort } from './enums/registry-sort.enum';
import { RegistryService } from './registry.service';

const VALID_ICON_URL = 'https://imagedelivery.net/hash/icon-id/public';

/**
 * The platform-launcher fields the registry reads when resolving card art.
 */
interface PlatformLauncherImageRow {
  platformId: string | null;
  launcherId: string | null;
  backgroundImageUrl: string | null;
}

/**
 * A chainable query-builder test double whose terminal methods are settable.
 */
interface MockQueryBuilder {
  select: jest.Mock;
  addSelect: jest.Mock;
  innerJoin: jest.Mock;
  innerJoinAndSelect: jest.Mock;
  leftJoin: jest.Mock;
  leftJoinAndSelect: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  groupBy: jest.Mock;
  skip: jest.Mock;
  take: jest.Mock;
  getOne: jest.Mock<() => Promise<unknown>>;
  getManyAndCount: jest.Mock<() => Promise<[unknown[], number]>>;
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
    'leftJoinAndSelect',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'groupBy',
    'skip',
    'take',
  ] as const;

  for (const method of chainable) {
    queryBuilder[method] = jest.fn(() => queryBuilder);
  }

  queryBuilder.getOne = jest.fn(() => Promise.resolve(null as unknown));
  queryBuilder.getManyAndCount = jest.fn(() =>
    Promise.resolve([[], 0] as [unknown[], number]),
  );
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

/**
 * Builds an account fixture carrying the private fields that must never leak.
 *
 * @param overrides - Fields to override on the fixture.
 * @returns An account-shaped test fixture.
 */
function buildAccount(overrides: Partial<AccountEntity> = {}): AccountEntity {
  return {
    id: 'account-1',
    userId: 'user-1',
    handle: 'SteveX#1234',
    handleSlug: 'SteveX~1234',
    username: 'launcher-login',
    email: 'account@example.com',
    notes: 'private account notes',
    platformId: 'platform-1',
    launcherId: 'launcher-1',
    platform: { name: 'Steam' },
    launcher: { name: 'Arc' },
    lifetimeSubscription: true,
    accountCreatedDate: new Date('2015-03-04T00:00:00.000Z'),
    publiclyVisible: true,
    ...overrides,
  } as unknown as AccountEntity;
}

/**
 * Builds a character fixture carrying the private fields that must never leak.
 *
 * @param overrides - Fields to override on the fixture.
 * @returns A character-shaped test fixture.
 */
function buildCharacter(
  overrides: Partial<CharacterEntity> = {},
): CharacterEntity {
  return {
    id: 'character-1',
    accountId: 'account-1',
    handle: 'Rex',
    fullHandleSlug: 'Rex@SteveX~1234',
    level: 65,
    rank: {
      title: 'Fleet Admiral',
      iconUrl: VALID_ICON_URL,
      levelRange: 'Level 65',
    },
    species: { name: 'Vulcan', iconUrl: VALID_ICON_URL },
    class: { name: 'Tactical', iconUrl: null },
    sex: { name: 'Male', iconUrl: null },
    faction: { name: 'Starfleet (2409)', iconUrl: null },
    generalFaction: { name: 'Federation', iconUrl: null },
    recruitType: { name: 'Standard', iconUrl: null },
    profilePicture100: 'https://imagedelivery.net/hash/char-1/square100',
    profilePicture300: 'https://imagedelivery.net/hash/char-1/square300',
    firstName: 'Rex',
    middleName: null,
    lastName: 'Sorek',
    biography: 'A long and storied career.',
    notes: 'private captain notes',
    createdDate: new Date('2020-06-01T00:00:00.000Z'),
    publiclyVisible: true,
    ...overrides,
  } as unknown as CharacterEntity;
}

describe('RegistryService', () => {
  let service: RegistryService;
  let profileQb: MockQueryBuilder;
  let accountQb: MockQueryBuilder;
  let characterQb: MockQueryBuilder;
  let accountRepository: {
    createQueryBuilder: jest.Mock;
    find: jest.Mock<() => Promise<AccountEntity[]>>;
  };
  let characterRepository: {
    createQueryBuilder: jest.Mock;
    find: jest.Mock<() => Promise<CharacterEntity[]>>;
  };
  let platformLauncherRepository: {
    find: jest.Mock<() => Promise<PlatformLauncherImageRow[]>>;
  };
  let publicMemberService: {
    getPublicMemberStats: jest.Mock<
      () => Promise<Map<string, PublicMemberStats>>
    >;
  };
  let blockService: { getBlockedUserIds: jest.Mock<() => Promise<string[]>> };
  let friendshipService: {
    getRelationship: jest.Mock<() => Promise<RelationshipDto>>;
    getRelationships: jest.Mock<() => Promise<Map<string, RelationshipDto>>>;
  };
  const originalImagesHash = process.env.CLOUDFLARE_IMAGES_HASH;

  beforeEach(async () => {
    delete process.env.CLOUDFLARE_IMAGES_HASH;

    profileQb = createQueryBuilderMock();
    accountQb = createQueryBuilderMock();
    characterQb = createQueryBuilderMock();

    accountRepository = {
      createQueryBuilder: jest.fn(() => accountQb),
      find: jest.fn(() => Promise.resolve([] as AccountEntity[])),
    };
    characterRepository = {
      createQueryBuilder: jest.fn(() => characterQb),
      find: jest.fn(() => Promise.resolve([] as CharacterEntity[])),
    };
    platformLauncherRepository = {
      find: jest.fn(() => Promise.resolve([] as PlatformLauncherImageRow[])),
    };
    publicMemberService = {
      getPublicMemberStats: jest.fn(() =>
        Promise.resolve(new Map<string, PublicMemberStats>()),
      ),
    };
    blockService = {
      getBlockedUserIds: jest.fn(() => Promise.resolve([] as string[])),
    };
    friendshipService = {
      getRelationship: jest.fn(() =>
        Promise.resolve({
          status: RelationshipStatus.NONE,
          friendshipId: null,
          blockId: null,
        }),
      ),
      getRelationships: jest.fn(() =>
        Promise.resolve(new Map<string, RelationshipDto>()),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegistryService,
        {
          provide: getRepositoryToken(UserProfileEntity),
          useValue: { createQueryBuilder: jest.fn(() => profileQb) },
        },
        {
          provide: getRepositoryToken(AccountEntity),
          useValue: accountRepository,
        },
        {
          provide: getRepositoryToken(CharacterEntity),
          useValue: characterRepository,
        },
        {
          provide: getRepositoryToken(PlatformLauncherEntity),
          useValue: platformLauncherRepository,
        },
        { provide: PublicMemberService, useValue: publicMemberService },
        { provide: BlockService, useValue: blockService },
        { provide: FriendshipService, useValue: friendshipService },
      ],
    }).compile();

    service = module.get<RegistryService>(RegistryService);
  });

  afterEach(() => {
    if (originalImagesHash === undefined) {
      delete process.env.CLOUDFLARE_IMAGES_HASH;
    } else {
      process.env.CLOUDFLARE_IMAGES_HASH = originalImagesHash;
    }
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('visibility predicate', () => {
    it('should require a visible, non-deleted profile on an active account', async () => {
      await service.findProfiles({});

      const conditions = profileQb.andWhere.mock.calls.map(call => call[0]);
      expect(profileQb.where).toHaveBeenCalledWith(
        'profile.publiclyVisible = true',
      );
      expect(conditions).toContain('profile.deletedAt IS NULL');
      expect(conditions).toContain('user.deletedAt IS NULL');
      expect(conditions).toContain('user.isAccountDisabled = false');
    });

    it('should fall back to innerJoin when innerJoinAndSelect is unavailable', async () => {
      (
        profileQb as unknown as { innerJoinAndSelect?: jest.Mock }
      ).innerJoinAndSelect = undefined;

      await service.findProfiles({});

      expect(profileQb.innerJoin).toHaveBeenCalledWith('profile.user', 'user');
      expect(profileQb.addSelect).toHaveBeenCalledWith('user.lastLoginAt');
    });

    it('should require visible, non-deleted accounts when resolving a slug', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountQb.getOne.mockResolvedValue(null);

      await expect(service.findAccount('captain.picard', 'x')).rejects.toThrow(
        NotFoundException,
      );

      const conditions = accountQb.andWhere.mock.calls.map(call => call[0]);
      expect(conditions).toContain('account.publiclyVisible = true');
      expect(conditions).toContain('account.deletedAt IS NULL');
    });

    it('should require visible, non-deleted captains when resolving a slug', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountQb.getOne.mockResolvedValue(buildAccount());
      characterQb.getOne.mockResolvedValue(null);

      await expect(
        service.findCharacter('captain.picard', 'SteveX~1234', 'Rex'),
      ).rejects.toThrow(NotFoundException);

      const conditions = characterQb.andWhere.mock.calls.map(call => call[0]);
      expect(conditions).toContain('character.publiclyVisible = true');
      expect(conditions).toContain('character.deletedAt IS NULL');
    });

    it('should only list publicly visible captains for an account', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountQb.getOne.mockResolvedValue(buildAccount());

      await service.findAccount('captain.picard', 'SteveX~1234');

      expect(characterRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { accountId: 'account-1', publiclyVisible: true },
        }),
      );
    });

    it('should only list publicly visible accounts for a profile', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());

      await service.findProfileByUsername('captain.picard');

      expect(accountRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', publiclyVisible: true },
        }),
      );
    });
  });

  describe('findProfiles', () => {
    it('should default to page 1 with a page size of 12', async () => {
      await service.findProfiles({});

      expect(profileQb.skip).toHaveBeenCalledWith(0);
      expect(profileQb.take).toHaveBeenCalledWith(12);
    });

    it('should clamp the page size to the 50 item maximum', async () => {
      await service.findProfiles({ pageSize: 500 });

      expect(profileQb.take).toHaveBeenCalledWith(50);
    });

    it('should fall back to the default page size when given zero', async () => {
      await service.findProfiles({ pageSize: 0 });

      expect(profileQb.take).toHaveBeenCalledWith(12);
    });

    it('should fall back to page 1 when given a non-positive page', async () => {
      await service.findProfiles({ page: 0 });

      expect(profileQb.skip).toHaveBeenCalledWith(0);
    });

    it('should offset by page size for later pages', async () => {
      await service.findProfiles({ page: 3, pageSize: 10 });

      expect(profileQb.skip).toHaveBeenCalledWith(20);
    });

    it('should return the reported total and echo the paging inputs', async () => {
      profileQb.getManyAndCount.mockResolvedValue([[buildProfile()], 37]);

      const result = await service.findProfiles({ page: 2, pageSize: 10 });

      expect(result.total).toBe(37);
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(10);
      expect(result.items).toHaveLength(1);
    });

    it('should order alphabetically by default', async () => {
      await service.findProfiles({});

      // Ordered by a select alias rather than a bare `LOWER(profile.username)`
      // expression, which TypeORM misreads as an entity alias and rejects.
      expect(profileQb.addSelect).toHaveBeenCalledWith(
        'LOWER(profile.username)',
        'profile_username_lower',
      );
      expect(profileQb.orderBy).toHaveBeenCalledWith(
        'profile_username_lower',
        'ASC',
      );
      expect(profileQb.addOrderBy).toHaveBeenCalledWith(
        'profile.userId',
        'ASC',
      );
    });

    it('should order by profile creation date for recently joined', async () => {
      await service.findProfiles({ sort: RegistrySort.RECENTLY_JOINED });

      expect(profileQb.orderBy).toHaveBeenCalledWith(
        'profile.createdAt',
        'DESC',
      );
    });

    it('should order by last login for recently active, nulls last', async () => {
      await service.findProfiles({ sort: RegistrySort.RECENTLY_ACTIVE });

      expect(profileQb.orderBy).toHaveBeenCalledWith(
        'user.lastLoginAt',
        'DESC',
        'NULLS LAST',
      );
    });

    it('should not filter when no search term is supplied', async () => {
      await service.findProfiles({});

      const conditions = profileQb.andWhere.mock.calls.map(call => call[0]);
      expect(conditions).not.toContain('LOWER(profile.username) LIKE :search');
    });

    it('should not filter when the search term is only whitespace', async () => {
      await service.findProfiles({ search: '   ' });

      const conditions = profileQb.andWhere.mock.calls.map(call => call[0]);
      expect(conditions).not.toContain('LOWER(profile.username) LIKE :search');
    });

    it('should match the search term case-insensitively', async () => {
      await service.findProfiles({ search: 'PiCard' });

      expect(profileQb.andWhere).toHaveBeenCalledWith(
        'LOWER(profile.username) LIKE :search',
        { search: '%picard%' },
      );
    });

    it('should escape LIKE wildcards so they match literally', async () => {
      await service.findProfiles({ search: '100%_a\\b' });

      expect(profileQb.andWhere).toHaveBeenCalledWith(
        'LOWER(profile.username) LIKE :search',
        { search: '%100\\%\\_a\\\\b%' },
      );
    });

    it('should return an empty page when no profiles matched', async () => {
      profileQb.getManyAndCount.mockResolvedValue([[], 0]);

      const result = await service.findProfiles({});

      expect(result.items).toEqual([]);
      expect(publicMemberService.getPublicMemberStats).toHaveBeenCalledWith([]);
    });

    it('should attach public account and captain counts to each member', async () => {
      profileQb.getManyAndCount.mockResolvedValue([[buildProfile()], 1]);
      publicMemberService.getPublicMemberStats.mockResolvedValue(
        new Map([
          [
            'user-1',
            {
              accountCount: 2,
              characterCount: 11,
              playingSince: new Date('2015-03-04T00:00:00.000Z'),
            },
          ],
        ]),
      );

      const result = await service.findProfiles({});

      expect(result.items[0].publicAccountCount).toBe(2);
      expect(result.items[0].publicCharacterCount).toBe(11);
      expect(result.items[0].playingSince).toEqual(
        new Date('2015-03-04T00:00:00.000Z'),
      );
    });

    it('should report zero counts for a member with no visible accounts', async () => {
      profileQb.getManyAndCount.mockResolvedValue([[buildProfile()], 1]);
      publicMemberService.getPublicMemberStats.mockResolvedValue(new Map());

      const result = await service.findProfiles({});

      expect(result.items[0].publicAccountCount).toBe(0);
      expect(result.items[0].publicCharacterCount).toBe(0);
      expect(result.items[0].playingSince).toBeNull();
    });

    it('should report a null last active date when the member never signed in', async () => {
      profileQb.getManyAndCount.mockResolvedValue([
        [buildProfile({ user: undefined })],
        1,
      ]);

      const result = await service.findProfiles({});

      expect(result.items[0].lastActiveAt).toBeNull();
    });
  });

  describe('findProfileByUsername', () => {
    it('should throw when no publicly visible member matches', async () => {
      profileQb.getOne.mockResolvedValue(null);

      await expect(service.findProfileByUsername('ghost')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should match the username case-insensitively', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());

      await service.findProfileByUsername('CAPTAIN.PICARD');

      expect(profileQb.andWhere).toHaveBeenCalledWith(
        'LOWER(profile.username) = LOWER(:username)',
        { username: 'CAPTAIN.PICARD' },
      );
    });

    it('should map the member and their visible accounts', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountRepository.find.mockResolvedValue([buildAccount()]);
      characterQb.getRawMany.mockResolvedValue([
        { accountId: 'account-1', characterCount: '4' },
      ]);

      const result = await service.findProfileByUsername('captain.picard');

      expect(result.username).toBe('captain.picard');
      expect(result.joinedAt).toEqual(new Date('2026-01-14T09:21:00.000Z'));
      expect(result.lastActiveAt).toEqual(new Date('2026-08-01T12:00:00.000Z'));
      expect(result.accounts).toHaveLength(1);
      expect(result.accounts[0].handle).toBe('SteveX#1234');
      expect(result.accounts[0].slug).toBe('SteveX~1234');
      expect(result.accounts[0].platformName).toBe('Steam');
      expect(result.accounts[0].launcherName).toBe('Arc');
      expect(result.accounts[0].publicCharacterCount).toBe(4);
    });

    it('should report the date the member has been playing since', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      publicMemberService.getPublicMemberStats.mockResolvedValue(
        new Map([
          [
            'user-1',
            {
              accountCount: 1,
              characterCount: 4,
              playingSince: new Date('2015-03-04T00:00:00.000Z'),
            },
          ],
        ]),
      );

      const result = await service.findProfileByUsername('captain.picard');

      expect(result.playingSince).toEqual(new Date('2015-03-04T00:00:00.000Z'));
    });

    it('should report a zero captain count for an account with none visible', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountRepository.find.mockResolvedValue([buildAccount()]);
      characterQb.getRawMany.mockResolvedValue([]);

      const result = await service.findProfileByUsername('captain.picard');

      expect(result.accounts[0].publicCharacterCount).toBe(0);
    });

    it('should null out platform and launcher names when not set', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountRepository.find.mockResolvedValue([
        buildAccount({ platform: undefined, launcher: undefined }),
      ]);

      const result = await service.findProfileByUsername('captain.picard');

      expect(result.accounts[0].platformName).toBeNull();
      expect(result.accounts[0].launcherName).toBeNull();
    });

    it('should skip the captain count query when the member has no accounts', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountRepository.find.mockResolvedValue([]);

      const result = await service.findProfileByUsername('captain.picard');

      expect(result.accounts).toEqual([]);
      expect(characterRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should resolve the account background image from the mapping table', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountRepository.find.mockResolvedValue([buildAccount()]);
      platformLauncherRepository.find.mockResolvedValue([
        {
          platformId: 'platform-1',
          launcherId: 'launcher-1',
          backgroundImageUrl: 'https://imagedelivery.net/hash/bg-id/public',
        },
      ]);

      const result = await service.findProfileByUsername('captain.picard');

      expect(result.accounts[0].accountTypeImageUrl).toBe(
        'https://imagedelivery.net/hash/bg-id/public',
      );
    });
  });

  describe('findAccount', () => {
    it('should throw when the owning member is not public', async () => {
      profileQb.getOne.mockResolvedValue(null);

      await expect(service.findAccount('ghost', 'SteveX~1234')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw when the account is not public', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountQb.getOne.mockResolvedValue(null);

      await expect(
        service.findAccount('captain.picard', 'hidden'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should match the account slug case-insensitively', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountQb.getOne.mockResolvedValue(buildAccount());

      await service.findAccount('captain.picard', 'stevex~1234');

      expect(accountQb.andWhere).toHaveBeenCalledWith(
        'LOWER(account.handleSlug) = LOWER(:accountSlug)',
        { accountSlug: 'stevex~1234' },
      );
    });

    it('should map the account and its visible captains', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountQb.getOne.mockResolvedValue(buildAccount());
      characterRepository.find.mockResolvedValue([buildCharacter()]);

      const result = await service.findAccount('captain.picard', 'SteveX~1234');

      expect(result.handle).toBe('SteveX#1234');
      expect(result.lifetimeSubscription).toBe(true);
      expect(result.accountCreatedDate).toEqual(
        new Date('2015-03-04T00:00:00.000Z'),
      );
      expect(result.publicCharacterCount).toBe(1);
      expect(result.characters).toHaveLength(1);
      expect(result.characters[0].handle).toBe('Rex');
      expect(result.characters[0].slug).toBe('Rex@SteveX~1234');
      expect(result.characters[0].level).toBe(65);
      expect(result.characters[0].species).toEqual({
        name: 'Vulcan',
        iconUrl: VALID_ICON_URL,
      });
    });

    it('should order captains by level then handle', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountQb.getOne.mockResolvedValue(buildAccount());

      await service.findAccount('captain.picard', 'SteveX~1234');

      expect(characterRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { level: 'DESC', handle: 'ASC' } }),
      );
    });
  });

  describe('findCharacter', () => {
    it('should throw when the owning member is not public', async () => {
      profileQb.getOne.mockResolvedValue(null);

      await expect(
        service.findCharacter('ghost', 'SteveX~1234', 'Rex'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw when the owning account is not public', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountQb.getOne.mockResolvedValue(null);

      await expect(
        service.findCharacter('captain.picard', 'hidden', 'Rex'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw when the captain is not public', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountQb.getOne.mockResolvedValue(buildAccount());
      characterQb.getOne.mockResolvedValue(null);

      await expect(
        service.findCharacter('captain.picard', 'SteveX~1234', 'hidden'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should match the captain slug case-insensitively', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountQb.getOne.mockResolvedValue(buildAccount());
      characterQb.getOne.mockResolvedValue(buildCharacter());

      await service.findCharacter(
        'captain.picard',
        'SteveX~1234',
        'rex@stevex~1234',
      );

      expect(characterQb.andWhere).toHaveBeenCalledWith(
        'LOWER(character.fullHandleSlug) = LOWER(:characterSlug)',
        { characterSlug: 'rex@stevex~1234' },
      );
    });

    it('should scope the lookup to the resolved account', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountQb.getOne.mockResolvedValue(buildAccount());
      characterQb.getOne.mockResolvedValue(buildCharacter());

      await service.findCharacter('captain.picard', 'SteveX~1234', 'Rex');

      expect(characterQb.where).toHaveBeenCalledWith(
        'character.accountId = :accountId',
        { accountId: 'account-1' },
      );
    });

    it('should include the in-character name, biography and creation date', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountQb.getOne.mockResolvedValue(buildAccount());
      characterQb.getOne.mockResolvedValue(buildCharacter());

      const result = await service.findCharacter(
        'captain.picard',
        'SteveX~1234',
        'Rex',
      );

      expect(result.firstName).toBe('Rex');
      expect(result.middleName).toBeNull();
      expect(result.lastName).toBe('Sorek');
      expect(result.biography).toBe('A long and storied career.');
      expect(result.createdDate).toEqual(new Date('2020-06-01T00:00:00.000Z'));
    });

    it('should map the derived rank', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountQb.getOne.mockResolvedValue(buildAccount());
      characterQb.getOne.mockResolvedValue(buildCharacter());

      const result = await service.findCharacter(
        'captain.picard',
        'SteveX~1234',
        'Rex',
      );

      expect(result.rank).toEqual({
        title: 'Fleet Admiral',
        iconUrl: VALID_ICON_URL,
        levelRange: 'Level 65',
      });
    });

    it('should return a null rank when none resolves', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountQb.getOne.mockResolvedValue(buildAccount());
      characterQb.getOne.mockResolvedValue(buildCharacter({ rank: null }));

      const result = await service.findCharacter(
        'captain.picard',
        'SteveX~1234',
        'Rex',
      );

      expect(result.rank).toBeNull();
    });

    it('should return a null level when the captain has none recorded', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountQb.getOne.mockResolvedValue(buildAccount());
      characterQb.getOne.mockResolvedValue(
        buildCharacter({ level: null as unknown as number }),
      );

      const result = await service.findCharacter(
        'captain.picard',
        'SteveX~1234',
        'Rex',
      );

      expect(result.level).toBeNull();
    });

    it('should null out reference lookups that are not loaded', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountQb.getOne.mockResolvedValue(buildAccount());
      characterQb.getOne.mockResolvedValue(
        buildCharacter({
          species: undefined,
          class: undefined,
          sex: undefined,
          faction: undefined,
          generalFaction: undefined,
          recruitType: undefined,
        }),
      );

      const result = await service.findCharacter(
        'captain.picard',
        'SteveX~1234',
        'Rex',
      );

      expect(result.species).toBeNull();
      expect(result.class).toBeNull();
      expect(result.sex).toBeNull();
      expect(result.faction).toBeNull();
      expect(result.generalFaction).toBeNull();
      expect(result.recruitType).toBeNull();
    });

    it('should drop icon URLs that are not valid Cloudflare image URLs', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountQb.getOne.mockResolvedValue(buildAccount());
      characterQb.getOne.mockResolvedValue(
        buildCharacter({
          species: { name: 'Vulcan', iconUrl: 'javascript:alert(1)' },
          rank: {
            title: 'Fleet Admiral',
            iconUrl: 'http://evil.example.com/x.png',
            levelRange: 'Level 65',
          },
        } as unknown as Partial<CharacterEntity>),
      );

      const result = await service.findCharacter(
        'captain.picard',
        'SteveX~1234',
        'Rex',
      );

      expect(result.species?.iconUrl).toBeNull();
      expect(result.rank?.iconUrl).toBeNull();
    });
  });

  describe('blocking', () => {
    it('should not filter the listing for an anonymous caller', async () => {
      await service.findProfiles({});

      expect(blockService.getBlockedUserIds).toHaveBeenCalledWith(null);
      const conditions = profileQb.andWhere.mock.calls.map(call => call[0]);
      expect(conditions).not.toContain(
        'profile.userId NOT IN (:...blockedUserIds)',
      );
    });

    it('should not add an exclusion when the caller has no blocks', async () => {
      blockService.getBlockedUserIds.mockResolvedValue([]);

      await service.findProfiles({}, 'viewer-1');

      const conditions = profileQb.andWhere.mock.calls.map(call => call[0]);
      expect(conditions).not.toContain(
        'profile.userId NOT IN (:...blockedUserIds)',
      );
    });

    it('should exclude members blocked in either direction from the listing', async () => {
      blockService.getBlockedUserIds.mockResolvedValue(['user-9', 'user-8']);

      await service.findProfiles({}, 'viewer-1');

      expect(blockService.getBlockedUserIds).toHaveBeenCalledWith('viewer-1');
      expect(profileQb.andWhere).toHaveBeenCalledWith(
        'profile.userId NOT IN (:...blockedUserIds)',
        { blockedUserIds: ['user-9', 'user-8'] },
      );
    });

    it('should exclude a blocked member from a direct profile lookup', async () => {
      blockService.getBlockedUserIds.mockResolvedValue(['user-1']);
      // The exclusion is applied in SQL, so a blocked member simply does not
      // come back — indistinguishable from one who never existed.
      profileQb.getOne.mockResolvedValue(null);

      await expect(
        service.findProfileByUsername('captain.picard', 'viewer-1'),
      ).rejects.toThrow(NotFoundException);

      expect(profileQb.andWhere).toHaveBeenCalledWith(
        'profile.userId NOT IN (:...blockedUserIds)',
        { blockedUserIds: ['user-1'] },
      );
    });

    it('should apply the exclusion to account lookups', async () => {
      blockService.getBlockedUserIds.mockResolvedValue(['user-1']);
      profileQb.getOne.mockResolvedValue(null);

      await expect(
        service.findAccount('captain.picard', 'SteveX~1234', 'viewer-1'),
      ).rejects.toThrow(NotFoundException);

      expect(blockService.getBlockedUserIds).toHaveBeenCalledWith('viewer-1');
    });

    it('should apply the exclusion to captain lookups', async () => {
      blockService.getBlockedUserIds.mockResolvedValue(['user-1']);
      profileQb.getOne.mockResolvedValue(null);

      await expect(
        service.findCharacter(
          'captain.picard',
          'SteveX~1234',
          'Rex',
          'viewer-1',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(blockService.getBlockedUserIds).toHaveBeenCalledWith('viewer-1');
    });
  });

  describe('relationship', () => {
    it('should omit the relationship for an anonymous caller', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());

      const result = await service.findProfileByUsername('captain.picard');

      expect(result.relationship).toBeNull();
      expect(friendshipService.getRelationship).not.toHaveBeenCalled();
    });

    it('should omit the relationship from every listed member for an anonymous caller', async () => {
      profileQb.getManyAndCount.mockResolvedValue([[buildProfile()], 1]);

      const result = await service.findProfiles({});

      expect(result.items[0].relationship).toBeNull();
      expect(friendshipService.getRelationships).not.toHaveBeenCalled();
    });

    it('should resolve the whole listing relationships in one call', async () => {
      profileQb.getManyAndCount.mockResolvedValue([
        [buildProfile(), buildProfile({ userId: 'user-2' })],
        2,
      ]);
      friendshipService.getRelationships.mockResolvedValue(
        new Map([
          [
            'user-1',
            {
              status: RelationshipStatus.FRIENDS,
              friendshipId: 'friendship-1',
              blockId: null,
            },
          ],
        ]),
      );

      const result = await service.findProfiles({}, 'viewer-1');

      expect(friendshipService.getRelationships).toHaveBeenCalledTimes(1);
      expect(friendshipService.getRelationships).toHaveBeenCalledWith(
        'viewer-1',
        ['user-1', 'user-2'],
      );
      expect(result.items[0].relationship?.status).toBe(
        RelationshipStatus.FRIENDS,
      );
    });

    it('should report a null relationship for a member the batch did not cover', async () => {
      profileQb.getManyAndCount.mockResolvedValue([[buildProfile()], 1]);
      friendshipService.getRelationships.mockResolvedValue(new Map());

      const result = await service.findProfiles({}, 'viewer-1');

      expect(result.items[0].relationship).toBeNull();
    });

    it('should report how an authenticated caller relates to the member', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      friendshipService.getRelationship.mockResolvedValue({
        status: RelationshipStatus.FRIENDS,
        friendshipId: 'friendship-1',
        blockId: null,
      });

      const result = await service.findProfileByUsername(
        'captain.picard',
        'viewer-1',
      );

      expect(friendshipService.getRelationship).toHaveBeenCalledWith(
        'viewer-1',
        'user-1',
      );
      expect(result.relationship).toEqual({
        status: RelationshipStatus.FRIENDS,
        friendshipId: 'friendship-1',
        blockId: null,
      });
    });
  });

  describe('private field exposure', () => {
    it('should not expose the member email, id, or real name', async () => {
      profileQb.getManyAndCount.mockResolvedValue([[buildProfile()], 1]);

      const result = await service.findProfiles({});
      const keys = Object.keys(result.items[0]);

      expect(keys).not.toContain('email');
      expect(keys).not.toContain('userId');
      expect(keys).not.toContain('id');
      expect(keys).not.toContain('firstName');
      expect(keys).not.toContain('lastName');
      expect(keys).not.toContain('user');
      expect(keys).not.toContain('profilePictureId');
      expect(keys).not.toContain('publiclyVisible');
    });

    it('should not expose the account email, launcher username, notes or ids', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountQb.getOne.mockResolvedValue(buildAccount());

      const result = await service.findAccount('captain.picard', 'SteveX~1234');
      const keys = Object.keys(result);

      expect(keys).not.toContain('email');
      expect(keys).not.toContain('username');
      expect(keys).not.toContain('notes');
      expect(keys).not.toContain('id');
      expect(keys).not.toContain('userId');
      expect(keys).not.toContain('platformId');
      expect(keys).not.toContain('launcherId');
      expect(keys).not.toContain('publiclyVisible');
    });

    it('should not expose the captain notes or ids', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountQb.getOne.mockResolvedValue(buildAccount());
      characterQb.getOne.mockResolvedValue(buildCharacter());

      const result = await service.findCharacter(
        'captain.picard',
        'SteveX~1234',
        'Rex',
      );
      const keys = Object.keys(result);

      expect(keys).not.toContain('notes');
      expect(keys).not.toContain('id');
      expect(keys).not.toContain('accountId');
      expect(keys).not.toContain('publiclyVisible');
    });

    it('should not expose captain notes on the account listing either', async () => {
      profileQb.getOne.mockResolvedValue(buildProfile());
      accountQb.getOne.mockResolvedValue(buildAccount());
      characterRepository.find.mockResolvedValue([buildCharacter()]);

      const result = await service.findAccount('captain.picard', 'SteveX~1234');
      const keys = Object.keys(result.characters[0]);

      expect(keys).not.toContain('notes');
      expect(keys).not.toContain('biography');
      expect(keys).not.toContain('id');
      expect(keys).not.toContain('accountId');
    });
  });
});
