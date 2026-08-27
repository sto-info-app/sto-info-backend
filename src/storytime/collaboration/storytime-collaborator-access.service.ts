import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StorytimeStoryCollaboratorEntity } from '../crew/entities/storytime-story-collaborator.entity';
import { CollaborationInvitationStatus } from '../enums/collaboration-invitation-status.enum';
import { StoryCapability } from './storytime-story-capability.enum';

/**
 * Answers one question: may this person do this to this Story?
 *
 * Deliberately small and deliberately ignorant of Stories. It knows only the
 * collaborator table, so the Stories module can consult it while the module
 * that manages invitations sits above both — a dependency that runs one way
 * and never loops back.
 *
 * Only an accepted invitation grants anything. Somebody who has been invited
 * and not answered, has declined, or has been removed is treated exactly like
 * a stranger.
 */
@Injectable()
export class StorytimeCollaboratorAccessService {
  /**
   * Creates an instance of StorytimeCollaboratorAccessService.
   *
   * @param _collaboratorRepository - Repository of Story collaborators.
   */
  constructor(
    @InjectRepository(StorytimeStoryCollaboratorEntity)
    private readonly _collaboratorRepository: Repository<StorytimeStoryCollaboratorEntity>,
  ) {}

  /**
   * Reports whether somebody holds a capability on a Story.
   *
   * @param storyId - The Story.
   * @param userId - The person acting.
   * @param capability - What they are trying to do.
   * @returns True when an accepted collaboration grants it.
   */
  async hasCapability(
    storyId: string,
    userId: string,
    capability: StoryCapability,
  ): Promise<boolean> {
    const collaborator = await this.findAccepted(storyId, userId);

    if (!collaborator) {
      return false;
    }

    return this.grants(collaborator, capability);
  }

  /**
   * Finds somebody's accepted collaboration on a Story, if they have one.
   *
   * @param storyId - The Story.
   * @param userId - The person.
   * @returns The collaboration, or null when there is no accepted one.
   */
  findAccepted(
    storyId: string,
    userId: string,
  ): Promise<StorytimeStoryCollaboratorEntity | null> {
    return this._collaboratorRepository.findOne({
      where: {
        storyId,
        userId,
        invitationStatus: CollaborationInvitationStatus.ACCEPTED,
      },
    });
  }

  /**
   * Lists the Stories somebody has accepted a collaboration on.
   *
   * @param userId - The person.
   * @returns Their accepted collaborations.
   */
  findAcceptedForUser(
    userId: string,
  ): Promise<StorytimeStoryCollaboratorEntity[]> {
    return this._collaboratorRepository.find({
      where: {
        userId,
        invitationStatus: CollaborationInvitationStatus.ACCEPTED,
      },
    });
  }

  /**
   * Reports whether a collaboration row grants a capability.
   *
   * @param collaborator - The collaboration.
   * @param capability - What is being attempted.
   * @returns True when the row grants it.
   */
  private grants(
    collaborator: StorytimeStoryCollaboratorEntity,
    capability: StoryCapability,
  ): boolean {
    switch (capability) {
      case StoryCapability.EDIT_STORY:
        return collaborator.canEditStory;
      case StoryCapability.MANAGE_CHAPTERS:
        return collaborator.canManageChapters;
      case StoryCapability.MANAGE_CHARACTERS:
        return collaborator.canManageCharacters;
      case StoryCapability.MANAGE_CREW:
        return collaborator.canManageCrew;
      // Every capability is named, so a new one added to the enum without a
      // grant here is a compile error rather than a silent denial.
      case StoryCapability.MANAGE_COLLABORATORS:
        return collaborator.canManageCollaborators;
    }
  }
}
