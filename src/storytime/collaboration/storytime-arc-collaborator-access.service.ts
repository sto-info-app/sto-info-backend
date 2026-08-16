import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StorytimeArcCollaboratorEntity } from '../arcs/entities/storytime-arc-collaborator.entity';
import { CollaborationInvitationStatus } from '../enums/collaboration-invitation-status.enum';
import { ArcCapability } from './storytime-arc-capability.enum';

/**
 * Answers one question: may this person do this to this Arc?
 *
 * The Arc counterpart of the Story capability lookup, and deliberately the
 * same shape: it knows only the collaborator table, so Arcs can consult it
 * while the module that manages invitations sits above both.
 *
 * Only an accepted invitation grants anything. Somebody invited and not yet
 * answered, who declined, or who has been removed is treated exactly like a
 * stranger.
 */
@Injectable()
export class StorytimeArcCollaboratorAccessService {
  /**
   * Creates an instance of StorytimeArcCollaboratorAccessService.
   *
   * @param _collaboratorRepository - Repository of Arc collaborators.
   */
  constructor(
    @InjectRepository(StorytimeArcCollaboratorEntity)
    private readonly _collaboratorRepository: Repository<StorytimeArcCollaboratorEntity>,
  ) {}

  /**
   * Reports whether somebody holds a capability on an Arc.
   *
   * @param arcId - The Arc.
   * @param userId - The person acting.
   * @param capability - What they are trying to do.
   * @returns True when an accepted collaboration grants it.
   */
  async hasCapability(
    arcId: string,
    userId: string,
    capability: ArcCapability,
  ): Promise<boolean> {
    const collaborator = await this.findAccepted(arcId, userId);

    if (!collaborator) {
      return false;
    }

    return this.grants(collaborator, capability);
  }

  /**
   * Finds somebody's accepted collaboration on an Arc, if they have one.
   *
   * @param arcId - The Arc.
   * @param userId - The person.
   * @returns The collaboration, or null when there is no accepted one.
   */
  findAccepted(
    arcId: string,
    userId: string,
  ): Promise<StorytimeArcCollaboratorEntity | null> {
    return this._collaboratorRepository.findOne({
      where: {
        arcId,
        userId,
        invitationStatus: CollaborationInvitationStatus.ACCEPTED,
      },
    });
  }

  /**
   * Lists the Arcs somebody has accepted a collaboration on.
   *
   * @param userId - The person.
   * @returns Their accepted collaborations.
   */
  findAcceptedForUser(
    userId: string,
  ): Promise<StorytimeArcCollaboratorEntity[]> {
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
    collaborator: StorytimeArcCollaboratorEntity,
    capability: ArcCapability,
  ): boolean {
    switch (capability) {
      case ArcCapability.EDIT_ARC:
        return collaborator.canEditArc;
      case ArcCapability.MANAGE_STORIES:
        return collaborator.canManageStories;
      // Every capability is named, so a new one added to the enum without a
      // grant here is a compile error rather than a silent denial.
      case ArcCapability.MANAGE_COLLABORATORS:
        return collaborator.canManageCollaborators;
    }
  }
}
