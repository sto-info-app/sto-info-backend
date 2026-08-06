import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserProfileEntity } from '../user/entities/user-profile.entity';
import { AccountEntity } from '../sto/account/entities/account.entity';
import { CommunityMemberDto } from './dto/community-member.dto';

/**
 * Public visibility counts for a single member.
 */
export interface PublicMemberCounts {
  accountCount: number;
  characterCount: number;
}

/**
 * A raw count row returned by the per-member aggregate query.
 */
interface PublicMemberCountRow {
  userId: string;
  accountCount: string;
  characterCount: string;
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

    const profiles = await this._userProfileRepository
      .createQueryBuilder('profile')
      .innerJoin('profile.user', 'user')
      .addSelect('user.lastLoginAt')
      .where('profile.userId IN (:...userIds)', { userIds })
      .andWhere('profile.deletedAt IS NULL')
      .andWhere('user.deletedAt IS NULL')
      .andWhere('user.isAccountDisabled = false')
      .getMany();

    const counts = await this.countPublicEntitiesForUsers(
      profiles.map(profile => profile.userId),
    );

    for (const profile of profiles) {
      members.set(profile.userId, this.toMember(profile, counts));
    }

    return members;
  }

  /**
   * Counts publicly visible accounts and captains for the given members.
   *
   * @param userIds - The member user IDs to count for.
   * @returns A map from user ID to its public counts.
   */
  async countPublicEntitiesForUsers(
    userIds: string[],
  ): Promise<Map<string, PublicMemberCounts>> {
    const counts = new Map<string, PublicMemberCounts>();
    if (userIds.length === 0) {
      return counts;
    }

    const rows = await this._accountRepository
      .createQueryBuilder('account')
      .select('account.userId', 'userId')
      .addSelect('COUNT(DISTINCT account.id)', 'accountCount')
      .addSelect('COUNT(character.id)', 'characterCount')
      .leftJoin(
        'account.characters',
        'character',
        'character.publiclyVisible = true AND character.deletedAt IS NULL',
      )
      .where('account.userId IN (:...userIds)', { userIds })
      .andWhere('account.publiclyVisible = true')
      .andWhere('account.deletedAt IS NULL')
      .groupBy('account.userId')
      .getRawMany<PublicMemberCountRow>();

    for (const row of rows) {
      counts.set(row.userId, {
        accountCount: Number(row.accountCount),
        characterCount: Number(row.characterCount),
      });
    }

    return counts;
  }

  /**
   * Maps a profile entity onto the shared public member shape.
   *
   * @param profile - The profile entity, with its user relation loaded.
   * @param counts - Public counts keyed by user ID.
   * @returns The public member summary.
   */
  toMember(
    profile: UserProfileEntity,
    counts: Map<string, PublicMemberCounts>,
  ): CommunityMemberDto {
    const memberCounts = counts.get(profile.userId);

    return {
      username: profile.username,
      profilePicture100: profile.profilePicture100,
      profilePicture300: profile.profilePicture300,
      joinedAt: profile.createdAt,
      lastActiveAt: profile.user?.lastLoginAt ?? null,
      publicAccountCount: memberCounts?.accountCount ?? 0,
      publicCharacterCount: memberCounts?.characterCount ?? 0,
      publiclyVisible: profile.publiclyVisible,
    };
  }
}
