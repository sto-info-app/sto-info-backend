import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { UserProfileEntity } from '../../user/entities/user-profile.entity';

/**
 * Resolves the members a Story credits, by the username they display.
 *
 * Crediting has to name somebody, and the rest of the application refuses to
 * hand out user identifiers — the registry listing says so in as many words.
 * So a credit is written against a username and resolved here, which means no
 * client ever has to learn who a member is beyond the name they display.
 */
@Injectable()
export class StorytimeCreditableMemberService {
  /**
   * Creates an instance of StorytimeCreditableMemberService.
   *
   * @param _profileRepository - Repository of member profiles.
   */
  constructor(
    @InjectRepository(UserProfileEntity)
    private readonly _profileRepository: Repository<UserProfileEntity>,
  ) {}

  /**
   * Resolves a username to the member it belongs to.
   *
   * Deliberately does not require a public registry record. Somebody who has
   * gone private since the credit was agreed is still the person who did the
   * work, and the creator already knows their name.
   *
   * @param username - The profile username.
   * @returns The member's user identifier.
   * @throws BadRequestException when no active member has that username.
   */
  async requireUserId(username: string): Promise<string> {
    const profile = await this._profileRepository
      .createQueryBuilder('profile')
      .innerJoin('profile.user', 'user')
      .where('LOWER(profile.username) = LOWER(:username)', { username })
      .andWhere('profile.deletedAt IS NULL')
      .andWhere('user.deletedAt IS NULL')
      .andWhere('user.isAccountDisabled = false')
      .getOne();

    if (!profile) {
      // A refusal rather than a not-found: the username came from a form
      // field, and what is wrong is what was typed into it.
      throw new BadRequestException(`No member is called '${username}'`);
    }

    return profile.userId;
  }

  /**
   * Reads back the usernames of the members a set of credits names.
   *
   * A member who has closed their account drops out of the map, so callers
   * should treat a missing key as somebody who is no longer here.
   *
   * @param userIds - The members credited.
   * @returns A map from user identifier to username.
   */
  async findUsernames(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const profiles = await this._profileRepository
      .createQueryBuilder('profile')
      .innerJoin('profile.user', 'user')
      .where('profile.userId IN (:...userIds)', { userIds })
      .andWhere('profile.deletedAt IS NULL')
      .andWhere('user.deletedAt IS NULL')
      .andWhere('user.isAccountDisabled = false')
      .getMany();

    return new Map(profiles.map(profile => [profile.userId, profile.username]));
  }
}
