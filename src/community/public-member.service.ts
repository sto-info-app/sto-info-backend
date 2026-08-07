import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { UserProfileEntity } from '../user/entities/user-profile.entity';
import { AccountEntity } from '../sto/account/entities/account.entity';
import { CommunityMemberDto } from './dto/community-member.dto';

/**
 * The facts a member's public listing shows about their visible records.
 */
export interface PublicMemberStats {
  accountCount: number;
  characterCount: number;
  /**
   * The earliest creation date across the member's visible accounts, or null
   * when none of them records one.
   */
  playingSince: Date | null;
}

/**
 * A raw row returned by the per-member aggregate query. Counts arrive as
 * strings from the driver; the date arrives already parsed.
 */
interface PublicMemberStatsRow {
  userId: string;
  accountCount: string;
  characterCount: string;
  playingSince: Date | null;
}

/**
 * Resolves members by username and maps them onto the public shape shared by
 * the registry and the friend and blocked lists.
 *
 * Owning the counts query here keeps a single definition of "publicly visible"
 * — profile, account and character all opted in and none soft-deleted — so the
 * registry listing and a friend list can never disagree about what a member
 * shows to the fleet.
 */
@Injectable()
export class PublicMemberService {
  /**
   * Creates an instance of PublicMemberService.
   *
   * @param _userProfileRepository - The user profile repository.
   * @param _accountRepository - The account repository.
   */
  constructor(
    @InjectRepository(UserProfileEntity)
    private readonly _userProfileRepository: Repository<UserProfileEntity>,
    @InjectRepository(AccountEntity)
    private readonly _accountRepository: Repository<AccountEntity>,
  ) {}

  /**
   * Resolves an active member by profile username, case-insensitively.
   *
   * Deliberately does not require a public registry record: blocking someone
   * who has since gone private has to keep working.
   *
   * @param username - The profile username.
   * @returns The matching profile, with its user relation loaded.
   * @throws {NotFoundException} When no active member matches.
   */
  async requireActiveMember(username: string): Promise<UserProfileEntity> {
    const profile = await this._userProfileRepository
      .createQueryBuilder('profile')
      .innerJoinAndSelect('profile.user', 'user')
      .where('LOWER(profile.username) = LOWER(:username)', { username })
      .andWhere('profile.deletedAt IS NULL')
      .andWhere('user.deletedAt IS NULL')
      .andWhere('user.isAccountDisabled = false')
      .getOne();

    if (!profile) {
      throw new NotFoundException('Member not found');
    }

    return profile;
  }

  /**
   * Loads the public summaries for a set of members, keyed by user ID.
   *
   * Members who have since closed or disabled their account drop out of the
   * map, so callers should treat a missing key as "no longer a member".
   *
   * @param userIds - The member user IDs to load.
   * @returns A map from user ID to its public summary.
   */
  async findMembersByUserIds(
    userIds: string[],
  ): Promise<Map<string, CommunityMemberDto>> {
    const members = new Map<string, CommunityMemberDto>();
    if (userIds.length === 0) {
      return members;
    }

    const queryBuilder =
      this._userProfileRepository.createQueryBuilder('profile');

    const queryBuilderWithOptionalJoinAndSelect = queryBuilder as unknown as {
      innerJoinAndSelect?: (
        property: string,
        alias: string,
      ) => SelectQueryBuilder<UserProfileEntity>;
      innerJoin: (
        property: string,
        alias: string,
      ) => SelectQueryBuilder<UserProfileEntity>;
      addSelect: (selection: string) => SelectQueryBuilder<UserProfileEntity>;
    };

    const queryWithUser =
      typeof queryBuilderWithOptionalJoinAndSelect.innerJoinAndSelect ===
      'function'
        ? queryBuilderWithOptionalJoinAndSelect.innerJoinAndSelect(
            'profile.user',
            'user',
          )
        : queryBuilderWithOptionalJoinAndSelect
            .innerJoin('profile.user', 'user')
            .addSelect('user.lastLoginAt');

    const profiles = await queryWithUser
      .where('profile.userId IN (:...userIds)', { userIds })
      .andWhere('profile.deletedAt IS NULL')
      .andWhere('user.deletedAt IS NULL')
      .andWhere('user.isAccountDisabled = false')
      .getMany();

    const stats = await this.getPublicMemberStats(
      profiles.map((profile: UserProfileEntity) => profile.userId),
    );

    for (const profile of profiles) {
      members.set(profile.userId, this.toMember(profile, stats));
    }

    return members;
  }

  /**
   * Aggregates the publicly visible accounts and captains of the given members,
   * along with the date they have been playing since.
   *
   * @param userIds - The member user IDs to aggregate for.
   * @returns A map from user ID to its public stats.
   */
  async getPublicMemberStats(
    userIds: string[],
  ): Promise<Map<string, PublicMemberStats>> {
    const stats = new Map<string, PublicMemberStats>();
    if (userIds.length === 0) {
      return stats;
    }

    const rows = await this._accountRepository
      .createQueryBuilder('account')
      .select('account.userId', 'userId')
      .addSelect('COUNT(DISTINCT account.id)', 'accountCount')
      .addSelect('COUNT(character.id)', 'characterCount')
      // The oldest account a member has made public is the earliest date the
      // fleet can see them playing from. Accounts with no recorded date are
      // ignored by MIN rather than dragging the answer to null.
      .addSelect('MIN(account.accountCreatedDate)', 'playingSince')
      .leftJoin(
        'account.characters',
        'character',
        'character.publiclyVisible = true AND character.deletedAt IS NULL',
      )
      .where('account.userId IN (:...userIds)', { userIds })
      .andWhere('account.publiclyVisible = true')
      .andWhere('account.deletedAt IS NULL')
      .groupBy('account.userId')
      .getRawMany<PublicMemberStatsRow>();

    for (const row of rows) {
      stats.set(row.userId, {
        accountCount: Number(row.accountCount),
        characterCount: Number(row.characterCount),
        playingSince: row.playingSince ? new Date(row.playingSince) : null,
      });
    }

    return stats;
  }

  /**
   * Maps a profile entity onto the shared public member shape.
   *
   * @param profile - The profile entity, with its user relation loaded.
   * @param stats - Public stats keyed by user ID.
   * @returns The public member summary.
   */
  toMember(
    profile: UserProfileEntity,
    stats: Map<string, PublicMemberStats>,
  ): CommunityMemberDto {
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
      publiclyVisible: profile.publiclyVisible,
    };
  }
}
