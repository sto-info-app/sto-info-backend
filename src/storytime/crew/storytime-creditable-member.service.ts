import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { UserProfileEntity } from '../../user/entities/user-profile.entity';
import { CreditableMemberDto } from './dto/creditable-member.dto';
import { StorytimeStoryCollaboratorEntity } from './entities/storytime-story-collaborator.entity';

/** How many members one search answers with. */
const SEARCH_LIMIT = 20;

/**
 * Finds the members a Story may credit, and resolves them by username.
 *
 * Crediting has to name somebody, and the rest of the application refuses to
 * hand out user identifiers — the registry listing says so in as many words.
 * So a credit is written against a username and resolved here, which means a
 * creator can search for a collaborator without any client ever learning who
 * that collaborator is beyond the name they already display.
 *
 * Who can be found is deliberately wider than the registry alone. Somebody
 * already working on the Story has opted into being known to its creator, and
 * refusing to credit them because their public profile is switched off would
 * make the credits roll least accurate for the people who did the most.
 */
@Injectable()
export class StorytimeCreditableMemberService {
  /**
   * Creates an instance of StorytimeCreditableMemberService.
   *
   * @param _profileRepository - Repository of member profiles.
   * @param _collaboratorRepository - Repository of Story collaborations.
   */
  constructor(
    @InjectRepository(UserProfileEntity)
    private readonly _profileRepository: Repository<UserProfileEntity>,
    @InjectRepository(StorytimeStoryCollaboratorEntity)
    private readonly _collaboratorRepository: Repository<StorytimeStoryCollaboratorEntity>,
  ) {}

  /**
   * Finds members who may be credited on a Story.
   *
   * @param storyId - The Story being credited.
   * @param search - Part of a username to match, if any.
   * @returns The matching members, collaborators first.
   */
  async search(
    storyId: string,
    search?: string,
  ): Promise<CreditableMemberDto[]> {
    const collaboratorIds = await this.collaboratorUserIds(storyId);
    const profiles = await this.findProfiles(collaboratorIds, search);
    const collaborators = new Set(collaboratorIds);

    return (
      profiles
        .map(profile => ({
          username: profile.username,
          profilePicture100: profile.profilePicture100,
          isCollaborator: collaborators.has(profile.userId),
        }))
        // Collaborators first, because the person a creator is looking for is
        // usually somebody who worked on it. Alphabetical within each group,
        // so the order does not shuffle between two searches for the same
        // thing.
        .sort(
          (first, second) =>
            Number(second.isCollaborator) - Number(first.isCollaborator) ||
            first.username.localeCompare(second.username),
        )
    );
  }

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

  /**
   * The members already working on a Story, invitations included.
   *
   * @param storyId - The Story.
   * @returns Their user identifiers.
   */
  private async collaboratorUserIds(storyId: string): Promise<string[]> {
    const collaborators = await this._collaboratorRepository.find({
      where: { storyId },
      select: { userId: true },
    });

    return collaborators.map(collaborator => collaborator.userId);
  }

  /**
   * Finds the profiles a search may answer with.
   *
   * @param collaboratorIds - The Story's own collaborators.
   * @param search - Part of a username to match, if any.
   * @returns The matching active profiles.
   */
  private findProfiles(
    collaboratorIds: string[],
    search?: string,
  ): Promise<UserProfileEntity[]> {
    const query = this._profileRepository
      .createQueryBuilder('profile')
      .innerJoin('profile.user', 'user')
      .where('profile.deletedAt IS NULL')
      .andWhere('user.deletedAt IS NULL')
      .andWhere('user.isAccountDisabled = false')
      .take(SEARCH_LIMIT);

    // Either they have a public record, or they are already on this Story.
    // Without the second half a private collaborator could not be credited at
    // all; without the first, only collaborators could ever be credited.
    if (collaboratorIds.length > 0) {
      query.andWhere(
        '(profile.publiclyVisible = true OR profile.userId IN (:...collaboratorIds))',
        { collaboratorIds },
      );
    } else {
      query.andWhere('profile.publiclyVisible = true');
    }

    if (search) {
      query.andWhere('LOWER(profile.username) LIKE LOWER(:term)', {
        term: `%${search}%`,
      });
    } else {
      // With nothing to match on, listing every public member would be a
      // directory rather than a search. Only the Story's own crew comes back.
      if (collaboratorIds.length === 0) {
        return Promise.resolve([]);
      }

      query.andWhere('profile.userId IN (:...collaboratorIds)', {
        collaboratorIds,
      });
    }

    return query.getMany();
  }
}
