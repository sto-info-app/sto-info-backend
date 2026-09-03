import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository, SelectQueryBuilder } from 'typeorm';

import { isValidCloudflareImageUrl } from 'src/shared/constants/image.constants';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { BlockService } from '../community/block.service';
import { RelationshipDto } from '../community/dto/friendship.dto';
import { FriendshipService } from '../community/friendship.service';
import {
  PublicMemberService,
  PublicMemberStats,
} from '../community/public-member.service';
import { joinWithOptionalSelect } from '../shared/utilities/query-builder.utility';
import { escapeSqlLikeTerm } from '../shared/utilities/sql-like.utility';
import { AccountEntity } from '../sto/account/entities/account.entity';
import { CharacterEntity } from '../sto/character/entities/character.entity';
import { PlatformLauncherEntity } from '../sto/platform-launcher/entities/platform-launcher.entity';
import {
  buildAccountBackgroundImageLookup,
  resolveAccountTypeImageUrl,
} from '../sto/shared/account-image.utility';
import {
  RegistryAccountDto,
  RegistryAccountSummaryDto,
} from './dto/registry-account.dto';
import {
  RegistryCharacterDto,
  RegistryCharacterSummaryDto,
  RegistryLookupDto,
  RegistryRankDto,
} from './dto/registry-character.dto';
import {
  PaginatedRegistryProfilesDto,
  RegistryProfileDto,
  RegistryProfileSummaryDto,
} from './dto/registry-profile.dto';
import { RegistryQueryDto } from './dto/registry-query.dto';
import { RegistrySort } from './enums/registry-sort.enum';

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 50;
const MIN_PAGE_SIZE = 1;

/** Select alias for the case-insensitive username used by the default sort. */
const USERNAME_SORT_ALIAS = 'profile_username_lower';

/**
 * The relation set a character needs for its public detail view. `faction.ranks`
 * is required for the entity's `rank` getter to resolve.
 */
const CHARACTER_RELATIONS = {
  generalFaction: true,
  faction: { ranks: true },
  sex: true,
  class: true,
  recruitType: true,
  species: true,
} as const;

/**
 * Read-only access to the publicly visible slice of the member directory.
 *
 * Every query in this service asserts the full opt-in chain — profile, account
 * and character must each be flagged `publiclyVisible` and must not be
 * soft-deleted — and every response is mapped to an explicit DTO so no private
 * entity field can leak through the global serializer.
 *
 * Blocking narrows that public slice further for authenticated callers: a
 * member on either end of a block disappears from the listing and answers a
 * direct lookup with the same 404 as a member who never existed, so a block
 * cannot be detected by probing.
 */
@Injectable()
export class RegistryService {
  /**
   * Creates an instance of RegistryService.
   *
   * @param _userProfileRepository - The user profile repository.
   * @param _accountRepository - The account repository.
   * @param _characterRepository - The character repository.
   * @param _platformLauncherRepository - The platform-launcher repository.
   * @param _publicMemberService - Shared public-visibility counts.
   * @param _blockService - Resolves which members a caller may not see.
   * @param _friendshipService - Resolves the caller's relationship to a member.
   */
  constructor(
    @InjectRepository(UserProfileEntity)
    private readonly _userProfileRepository: Repository<UserProfileEntity>,
    @InjectRepository(AccountEntity)
    private readonly _accountRepository: Repository<AccountEntity>,
    @InjectRepository(CharacterEntity)
    private readonly _characterRepository: Repository<CharacterEntity>,
    @InjectRepository(PlatformLauncherEntity)
    private readonly _platformLauncherRepository: Repository<PlatformLauncherEntity>,
    private readonly _publicMemberService: PublicMemberService,
    private readonly _blockService: BlockService,
    private readonly _friendshipService: FriendshipService,
  ) {}

  /**
   * Lists publicly visible members, newest / most active / alphabetical.
   *
   * @param query - Search, sort and pagination options.
   * @param viewerId - The authenticated caller's user ID, or null when
   *   anonymous. Used to hide members they have blocked or been blocked by.
   * @returns A page of member summaries.
   */
  async findProfiles(
    query: RegistryQueryDto,
    viewerId: string | null = null,
  ): Promise<PaginatedRegistryProfilesDto> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = this.clampPageSize(query.pageSize);

    const queryBuilder = await this.visibleProfilesQuery(viewerId);
    this.applySearch(queryBuilder, query.search);
    this.applySort(queryBuilder, query.sort);

    const [profiles, total] = await queryBuilder
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    const userIds = profiles.map(profile => profile.userId);
    const stats = await this._publicMemberService.getPublicMemberStats(userIds);
    const relationships = viewerId
      ? await this._friendshipService.getRelationships(viewerId, userIds)
      : new Map<string, RelationshipDto>();

    return {
      items: profiles.map(profile =>
        this.toProfileSummary(
          profile,
          stats,
          relationships.get(profile.userId) ?? null,
        ),
      ),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Retrieves a single publicly visible member and their visible accounts.
   *
   * @param username - The member's profile username.
   * @param viewerId - The authenticated caller's user ID, or null when
   *   anonymous.
   * @returns The member's public profile.
   * @throws {NotFoundException} When no publicly visible member matches, or
   *   the caller is blocked from seeing them.
   */
  async findProfileByUsername(
    username: string,
    viewerId: string | null = null,
  ): Promise<RegistryProfileDto> {
    const profile = await this.requireProfile(username, viewerId);

    const accounts = await this.findPublicAccounts(profile.userId);
    const backgroundImageLookup = await this.loadBackgroundImageLookup();
    const characterCounts = await this.countPublicCharactersForAccounts(
      accounts.map(account => account.id),
    );
    const stats = await this._publicMemberService.getPublicMemberStats([
      profile.userId,
    ]);
    const relationship = viewerId
      ? await this._friendshipService.getRelationship(viewerId, profile.userId)
      : null;

    return {
      ...this.toProfileSummary(profile, stats, relationship),
      accounts: accounts.map(account =>
        this.toAccountSummary(
          account,
          backgroundImageLookup,
          characterCounts.get(account.id) ?? 0,
        ),
      ),
    };
  }

  /**
   * Retrieves a publicly visible account and its visible captains.
   *
   * @param username - The owning member's profile username.
   * @param accountSlug - The account's URL slug.
   * @param viewerId - The authenticated caller's user ID, or null when
   *   anonymous.
   * @returns The account's public detail view.
   * @throws {NotFoundException} When the member or account is not public.
   */
  async findAccount(
    username: string,
    accountSlug: string,
    viewerId: string | null = null,
  ): Promise<RegistryAccountDto> {
    const profile = await this.requireProfile(username, viewerId);
    const account = await this.requireAccount(profile.userId, accountSlug);

    const characters = await this._characterRepository.find({
      where: {
        accountId: account.id,
        publiclyVisible: true,
      },
      relations: CHARACTER_RELATIONS,
      order: { level: 'DESC', handle: 'ASC' },
    });

    const backgroundImageLookup = await this.loadBackgroundImageLookup();

    return {
      ...this.toAccountSummary(
        account,
        backgroundImageLookup,
        characters.length,
      ),
      characters: characters.map(character =>
        this.toCharacterSummary(character),
      ),
    };
  }

  /**
   * Retrieves a publicly visible captain.
   *
   * @param username - The owning member's profile username.
   * @param accountSlug - The owning account's URL slug.
   * @param characterSlug - The captain's URL slug.
   * @param viewerId - The authenticated caller's user ID, or null when
   *   anonymous.
   * @returns The captain's public detail view.
   * @throws {NotFoundException} When any level of the chain is not public.
   */
  async findCharacter(
    username: string,
    accountSlug: string,
    characterSlug: string,
    viewerId: string | null = null,
  ): Promise<RegistryCharacterDto> {
    const profile = await this.requireProfile(username, viewerId);
    const account = await this.requireAccount(profile.userId, accountSlug);

    const character = await this._characterRepository
      .createQueryBuilder('character')
      .leftJoinAndSelect('character.generalFaction', 'generalFaction')
      .leftJoinAndSelect('character.faction', 'faction')
      .leftJoinAndSelect('faction.ranks', 'ranks')
      .leftJoinAndSelect('character.sex', 'sex')
      .leftJoinAndSelect('character.class', 'class')
      .leftJoinAndSelect('character.recruitType', 'recruitType')
      .leftJoinAndSelect('character.species', 'species')
      .where('character.accountId = :accountId', { accountId: account.id })
      .andWhere('LOWER(character.fullHandleSlug) = LOWER(:characterSlug)', {
        characterSlug,
      })
      .andWhere('character.publiclyVisible = true')
      .andWhere('character.deletedAt IS NULL')
      .getOne();

    if (!character) {
      throw new NotFoundException('Captain not found');
    }

    return {
      ...this.toCharacterSummary(character),
      firstName: character.firstName,
      middleName: character.middleName,
      lastName: character.lastName,
      biography: character.biography,
      createdDate: character.createdDate,
    };
  }

  /**
   * Builds the profile query for a specific caller, excluding any member on
   * either end of a block with them.
   *
   * @param viewerId - The authenticated caller's user ID, or null when
   *   anonymous.
   * @returns A query builder filtered to the profiles that caller may see.
   */
  private async visibleProfilesQuery(
    viewerId: string | null,
  ): Promise<SelectQueryBuilder<UserProfileEntity>> {
    const queryBuilder = this.publicProfilesQuery();
    const blockedUserIds = await this._blockService.getBlockedUserIds(viewerId);

    if (blockedUserIds.length > 0) {
      queryBuilder.andWhere('profile.userId NOT IN (:...blockedUserIds)', {
        blockedUserIds,
      });
    }

    return queryBuilder;
  }

  /**
   * Builds the base query for publicly visible, active members.
   *
   * @returns A query builder filtered to visible profiles.
   */
  private publicProfilesQuery(): SelectQueryBuilder<UserProfileEntity> {
    const queryWithUser = joinWithOptionalSelect(
      this._userProfileRepository.createQueryBuilder('profile'),
      'profile.user',
      'user',
      'user.lastLoginAt',
    );

    return (
      queryWithUser
        // Selected as an alias because TypeORM's `orderBy` tries to resolve a
        // bare `LOWER(profile.username)` as an entity alias and fails.
        .addSelect('LOWER(profile.username)', USERNAME_SORT_ALIAS)
        .where('profile.publiclyVisible = true')
        .andWhere('profile.deletedAt IS NULL')
        .andWhere('user.deletedAt IS NULL')
        .andWhere('user.isAccountDisabled = false')
    );
  }

  /**
   * Applies a case-insensitive username search, if one was supplied.
   *
   * LIKE wildcards in the user-supplied term are escaped so a search for `%`
   * matches a literal percent sign rather than every member.
   *
   * @param queryBuilder - The query to narrow.
   * @param search - The raw search term.
   */
  private applySearch(
    queryBuilder: SelectQueryBuilder<UserProfileEntity>,
    search?: string,
  ): void {
    const term = search?.trim();
    if (!term) {
      return;
    }

    const escaped = escapeSqlLikeTerm(term);

    queryBuilder.andWhere('LOWER(profile.username) LIKE :search', {
      search: `%${escaped}%`,
    });
  }

  /**
   * Applies the requested ordering to the profile query.
   *
   * @param queryBuilder - The query to order.
   * @param sort - The requested sort, defaulting to username.
   */
  private applySort(
    queryBuilder: SelectQueryBuilder<UserProfileEntity>,
    sort?: RegistrySort,
  ): void {
    if (sort === RegistrySort.RECENTLY_JOINED) {
      queryBuilder.orderBy('profile.createdAt', 'DESC');
    } else if (sort === RegistrySort.RECENTLY_ACTIVE) {
      queryBuilder.orderBy('user.lastLoginAt', 'DESC', 'NULLS LAST');
    } else {
      queryBuilder.orderBy(USERNAME_SORT_ALIAS, 'ASC');
    }

    // Stable tie-break so paging cannot repeat or skip a member.
    queryBuilder.addOrderBy('profile.userId', 'ASC');
  }

  /**
   * Clamps a requested page size into the supported range.
   *
   * @param pageSize - The requested page size.
   * @returns A page size between 1 and 50.
   */
  private clampPageSize(pageSize?: number): number {
    if (!pageSize || pageSize < MIN_PAGE_SIZE) {
      return DEFAULT_PAGE_SIZE;
    }

    return Math.min(pageSize, MAX_PAGE_SIZE);
  }

  /**
   * Loads a publicly visible profile by username, case-insensitively.
   *
   * @param username - The profile username.
   * @param viewerId - The authenticated caller's user ID, or null when
   *   anonymous.
   * @returns The matching profile.
   * @throws {NotFoundException} When no publicly visible profile matches, or
   *   the caller is blocked from seeing it.
   */
  private async requireProfile(
    username: string,
    viewerId: string | null,
  ): Promise<UserProfileEntity> {
    const queryBuilder = await this.visibleProfilesQuery(viewerId);

    const profile = await queryBuilder
      .andWhere('LOWER(profile.username) = LOWER(:username)', { username })
      .getOne();

    if (!profile) {
      throw new NotFoundException('Member not found');
    }

    return profile;
  }

  /**
   * Loads a publicly visible account by owner and slug, case-insensitively.
   *
   * @param userId - The owning member's user ID.
   * @param accountSlug - The account's URL slug.
   * @returns The matching account.
   * @throws {NotFoundException} When no publicly visible account matches.
   */
  private async requireAccount(
    userId: string,
    accountSlug: string,
  ): Promise<AccountEntity> {
    const account = await this._accountRepository
      .createQueryBuilder('account')
      .leftJoinAndSelect('account.platform', 'platform')
      .leftJoinAndSelect('account.launcher', 'launcher')
      .where('account.userId = :userId', { userId })
      .andWhere('LOWER(account.handleSlug) = LOWER(:accountSlug)', {
        accountSlug,
      })
      .andWhere('account.publiclyVisible = true')
      .andWhere('account.deletedAt IS NULL')
      .getOne();

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    return account;
  }

  /**
   * Loads all publicly visible accounts owned by a member.
   *
   * @param userId - The owning member's user ID.
   * @returns The member's visible accounts.
   */
  private async findPublicAccounts(userId: string): Promise<AccountEntity[]> {
    return this._accountRepository.find({
      where: { userId, publiclyVisible: true },
      relations: { platform: true, launcher: true },
      order: { handle: 'ASC', createdAt: 'ASC' },
    });
  }

  /**
   * Loads the platform-launcher background image lookup.
   *
   * @returns A map from platform-launcher key to background image URL.
   */
  private async loadBackgroundImageLookup(): Promise<Map<string, string>> {
    const platformLaunchers = await this._platformLauncherRepository.find({
      select: {
        platformId: true,
        launcherId: true,
        backgroundImageUrl: true,
      },
    });

    return buildAccountBackgroundImageLookup(platformLaunchers);
  }

  /**
   * Counts publicly visible captains for each of the given accounts.
   *
   * @param accountIds - The account IDs to count for.
   * @returns A map from account ID to its public captain count.
   */
  private async countPublicCharactersForAccounts(
    accountIds: string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (accountIds.length === 0) {
      return counts;
    }

    const rows = await this._characterRepository
      .createQueryBuilder('character')
      .select('character.accountId', 'accountId')
      .addSelect('COUNT(character.id)', 'characterCount')
      .where('character.accountId IN (:...accountIds)', { accountIds })
      .andWhere('character.publiclyVisible = true')
      .andWhere('character.deletedAt IS NULL')
      .groupBy('character.accountId')
      .getRawMany<{ accountId: string; characterCount: string }>();

    for (const row of rows) {
      counts.set(row.accountId, Number(row.characterCount));
    }

    return counts;
  }

  /**
   * Maps a profile entity onto its public summary DTO.
   *
   * @param profile - The profile entity, with its user relation loaded.
   * @param stats - Public stats keyed by user ID.
   * @param relationship - The caller's relationship to this member, or null
   *   when the caller is anonymous.
   * @returns The public summary.
   */
  private toProfileSummary(
    profile: UserProfileEntity,
    stats: Map<string, PublicMemberStats>,
    relationship: RelationshipDto | null,
  ): RegistryProfileSummaryDto {
    const memberStats = stats.get(profile.userId);

    return {
      username: profile.username,
      profilePicture100: profile.profilePicture100,
      profilePicture300: profile.profilePicture300,
      joinedAt: profile.createdAt,
      lastActiveAt: profile.user?.lastLoginAt ?? null,
      playingSince: memberStats?.playingSince ?? null,
      publicAccountCount: memberStats?.accountCount ?? 0,
      publicCharacterCount: memberStats?.characterCount ?? 0,
      relationship,
    };
  }

  /**
   * Maps an account entity onto its public summary DTO.
   *
   * @param account - The account entity, with platform and launcher loaded.
   * @param backgroundImageLookup - The platform-launcher image lookup.
   * @param publicCharacterCount - Number of visible captains on the account.
   * @returns The public summary.
   */
  private toAccountSummary(
    account: AccountEntity,
    backgroundImageLookup: Map<string, string>,
    publicCharacterCount: number,
  ): RegistryAccountSummaryDto {
    return {
      handle: account.handle,
      slug: account.handleSlug,
      platformName: account.platform?.name ?? null,
      launcherName: account.launcher?.name ?? null,
      accountTypeImageUrl: resolveAccountTypeImageUrl(
        account,
        backgroundImageLookup,
      ),
      lifetimeSubscription: account.lifetimeSubscription,
      accountCreatedDate: account.accountCreatedDate,
      publicCharacterCount,
    };
  }

  /**
   * Maps a character entity onto its public summary DTO.
   *
   * @param character - The character entity with its lookups loaded.
   * @returns The public summary.
   */
  private toCharacterSummary(
    character: CharacterEntity,
  ): RegistryCharacterSummaryDto {
    return {
      handle: character.handle,
      slug: character.fullHandleSlug,
      level: character.level ?? null,
      rank: this.toRank(character),
      species: this.toLookup(character.species),
      class: this.toLookup(character.class),
      sex: this.toLookup(character.sex),
      faction: this.toLookup(character.faction),
      generalFaction: this.toLookup(character.generalFaction),
      recruitType: this.toLookup(character.recruitType),
      profilePicture100: character.profilePicture100,
      profilePicture300: character.profilePicture300,
    };
  }

  /**
   * Maps a character's derived rank onto its DTO, sanitizing the icon URL.
   *
   * @param character - The character entity.
   * @returns The rank DTO, or null when no rank resolves.
   */
  private toRank(character: CharacterEntity): RegistryRankDto | null {
    const rank = character.rank;
    if (!rank) {
      return null;
    }

    return {
      title: rank.title,
      iconUrl: this.sanitizeIconUrl(rank.iconUrl),
      levelRange: rank.levelRange,
    };
  }

  /**
   * Maps a reference lookup entity onto its DTO, sanitizing the icon URL.
   *
   * @param lookup - The lookup entity, if loaded.
   * @returns The lookup DTO, or null when the relation is absent.
   */
  private toLookup(
    lookup?: { name: string; iconUrl?: string | null } | null,
  ): RegistryLookupDto | null {
    if (!lookup) {
      return null;
    }

    return {
      name: lookup.name,
      iconUrl: this.sanitizeIconUrl(lookup.iconUrl),
    };
  }

  /**
   * Drops any stored icon URL that is not a valid Cloudflare image URL.
   *
   * @param iconUrl - The candidate icon URL.
   * @returns The URL when valid, otherwise null.
   */
  private sanitizeIconUrl(iconUrl?: string | null): string | null {
    return isValidCloudflareImageUrl(iconUrl) ? iconUrl : null;
  }
}
