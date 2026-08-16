import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationSeverity } from '../../notification/enums/notification-severity.enum';
import { NotificationTarget } from '../../notification/enums/notification-target.enum';
import { NotificationService } from '../../notification/notification.service';
import { StoryCapability } from '../collaboration/storytime-story-capability.enum';
import { CollaborationInvitationStatus } from '../enums/collaboration-invitation-status.enum';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { InviteCollaboratorDto } from './dto/invite-collaborator.dto';
import { UpdateCollaboratorDto } from './dto/update-collaborator.dto';
import { StorytimeStoryCollaboratorEntity } from './entities/storytime-story-collaborator.entity';

/**
 * Inviting people to help write a Story, and what happens next.
 *
 * Two rules shape everything here. Access is something a person accepts, never
 * something an owner assigns: an invitation grants nothing until it is taken
 * up. And publishing is never delegated, so no route here can grant it however
 * the request is shaped.
 */
@Injectable()
export class StorytimeCollaboratorService {
  private readonly _logger = new Logger(StorytimeCollaboratorService.name);

  /**
   * Creates an instance of StorytimeCollaboratorService.
   *
   * @param _collaboratorRepository - Repository of Story collaborators.
   * @param _storyService - Decides who may manage collaborators.
   * @param _notificationService - Tells somebody they have been invited.
   */
  constructor(
    @InjectRepository(StorytimeStoryCollaboratorEntity)
    private readonly _collaboratorRepository: Repository<StorytimeStoryCollaboratorEntity>,
    private readonly _storyService: StorytimeStoryService,
    private readonly _notificationService: NotificationService,
  ) {}

  /**
   * Lists the collaborators on a Story.
   *
   * @param storyId - The Story.
   * @param actingUserId - The caller.
   * @returns The collaborators, including invitations not yet answered.
   */
  async findByStory(
    storyId: string,
    actingUserId: string,
  ): Promise<StorytimeStoryCollaboratorEntity[]> {
    await this._storyService.findAccessibleOrFail(storyId, actingUserId);

    return this._collaboratorRepository.find({
      where: { storyId },
      order: { invitedAt: 'ASC' },
    });
  }

  /**
   * Lists the invitations waiting on somebody.
   *
   * @param userId - The person invited.
   * @returns Their unanswered invitations.
   */
  findPendingForUser(
    userId: string,
  ): Promise<StorytimeStoryCollaboratorEntity[]> {
    return this._collaboratorRepository.find({
      where: {
        userId,
        invitationStatus: CollaborationInvitationStatus.INVITED,
      },
      order: { invitedAt: 'DESC' },
    });
  }

  /**
   * Invites somebody to collaborate on a Story.
   *
   * Re-inviting somebody who declined or was removed reuses their row rather
   * than failing on the unique constraint, because a fallen-out-and-made-up
   * collaboration is an ordinary thing and should not need an administrator.
   *
   * @param storyId - The Story.
   * @param dto - Who to invite and what they may do.
   * @param actingUserId - The caller.
   * @returns The invitation.
   * @throws BadRequestException when inviting the owner or an existing member.
   */
  async invite(
    storyId: string,
    dto: InviteCollaboratorDto,
    actingUserId: string,
  ): Promise<StorytimeStoryCollaboratorEntity> {
    const story = await this._storyService.findEditableOrFail(
      storyId,
      actingUserId,
      StoryCapability.MANAGE_COLLABORATORS,
    );

    if (dto.userId === story.ownerUserId) {
      throw new BadRequestException(
        'The owner of a Story is already able to do everything.',
      );
    }

    const existing = await this._collaboratorRepository.findOne({
      where: { storyId, userId: dto.userId },
    });

    if (
      existing &&
      (existing.invitationStatus === CollaborationInvitationStatus.INVITED ||
        existing.invitationStatus === CollaborationInvitationStatus.ACCEPTED)
    ) {
      throw new BadRequestException(
        'That member has already been invited to this Story.',
      );
    }

    const collaborator = existing ?? this._collaboratorRepository.create();

    Object.assign(collaborator, {
      storyId,
      userId: dto.userId,
      collaborationRole: dto.collaborationRole ?? null,
      canEditStory: dto.canEditStory ?? false,
      canManageChapters: dto.canManageChapters ?? false,
      canManageCharacters: dto.canManageCharacters ?? false,
      canManageCrew: dto.canManageCrew ?? false,
      canManageCollaborators: dto.canManageCollaborators ?? false,
      // Never granted, whatever the request says. Only the owner may publish.
      canPublish: false,
      invitationStatus: CollaborationInvitationStatus.INVITED,
      invitedByUserId: actingUserId,
      invitedAt: new Date(),
      acceptedAt: null,
      revokedAt: null,
    });

    const saved = await this._collaboratorRepository.save(collaborator);

    await this.notifyInvited(saved, story.title);

    this._logger.log(
      `Member ${dto.userId} invited to Story ${storyId} by ${actingUserId}`,
    );

    return saved;
  }

  /**
   * Changes what a collaborator may do.
   *
   * @param collaboratorId - The collaboration.
   * @param dto - The capabilities to set.
   * @param actingUserId - The caller.
   * @returns The collaboration after the change.
   */
  async updateCapabilities(
    collaboratorId: string,
    dto: UpdateCollaboratorDto,
    actingUserId: string,
  ): Promise<StorytimeStoryCollaboratorEntity> {
    const collaborator = await this.findOrFail(collaboratorId);

    await this._storyService.findEditableOrFail(
      collaborator.storyId,
      actingUserId,
      StoryCapability.MANAGE_COLLABORATORS,
    );

    const { canPublish, ...capabilities } = dto;
    void canPublish;

    Object.assign(collaborator, capabilities);
    // Belt and braces alongside the DTO and the check constraint: publishing
    // is not delegable, and no shape of request may make it so.
    collaborator.canPublish = false;

    return this._collaboratorRepository.save(collaborator);
  }

  /**
   * Accepts an invitation.
   *
   * Only the invited member may accept. An owner accepting on somebody's
   * behalf would be the whole point of the invitation defeated.
   *
   * @param collaboratorId - The invitation.
   * @param actingUserId - The caller.
   * @returns The accepted collaboration.
   */
  async accept(
    collaboratorId: string,
    actingUserId: string,
  ): Promise<StorytimeStoryCollaboratorEntity> {
    const collaborator = await this.findInvitedForUserOrFail(
      collaboratorId,
      actingUserId,
    );

    collaborator.invitationStatus = CollaborationInvitationStatus.ACCEPTED;
    collaborator.acceptedAt = new Date();

    this._logger.log(
      `Member ${actingUserId} accepted collaboration on Story ${collaborator.storyId}`,
    );

    return this._collaboratorRepository.save(collaborator);
  }

  /**
   * Declines an invitation.
   *
   * @param collaboratorId - The invitation.
   * @param actingUserId - The caller.
   * @returns The declined collaboration.
   */
  async decline(
    collaboratorId: string,
    actingUserId: string,
  ): Promise<StorytimeStoryCollaboratorEntity> {
    const collaborator = await this.findInvitedForUserOrFail(
      collaboratorId,
      actingUserId,
    );

    collaborator.invitationStatus = CollaborationInvitationStatus.DECLINED;

    return this._collaboratorRepository.save(collaborator);
  }

  /**
   * Withdraws an invitation, or removes a collaborator.
   *
   * The row is kept rather than deleted, so the Story's history still shows
   * that somebody worked on it and for how long.
   *
   * @param collaboratorId - The collaboration.
   * @param actingUserId - The caller.
   * @returns The revoked collaboration.
   */
  async revoke(
    collaboratorId: string,
    actingUserId: string,
  ): Promise<StorytimeStoryCollaboratorEntity> {
    const collaborator = await this.findOrFail(collaboratorId);

    // A collaborator may always show themselves out, whatever they were
    // granted; anybody else needs permission to manage collaborators.
    if (collaborator.userId !== actingUserId) {
      await this._storyService.findEditableOrFail(
        collaborator.storyId,
        actingUserId,
        StoryCapability.MANAGE_COLLABORATORS,
      );
    }

    collaborator.invitationStatus = CollaborationInvitationStatus.REVOKED;
    collaborator.revokedAt = new Date();

    this._logger.log(
      `Collaboration ${collaboratorId} on Story ${collaborator.storyId} revoked by ${actingUserId}`,
    );

    return this._collaboratorRepository.save(collaborator);
  }

  /**
   * Loads a collaboration, or fails.
   *
   * @param collaboratorId - The collaboration.
   * @returns The collaboration.
   * @throws NotFoundException when it does not exist.
   */
  private async findOrFail(
    collaboratorId: string,
  ): Promise<StorytimeStoryCollaboratorEntity> {
    const collaborator = await this._collaboratorRepository.findOne({
      where: { id: collaboratorId },
    });

    if (!collaborator) {
      throw new NotFoundException('Collaboration not found');
    }

    return collaborator;
  }

  /**
   * Loads an invitation that is the caller's own to answer.
   *
   * @param collaboratorId - The invitation.
   * @param actingUserId - The caller.
   * @returns The invitation.
   * @throws ForbiddenException when it is somebody else's.
   * @throws BadRequestException when it has already been answered.
   */
  private async findInvitedForUserOrFail(
    collaboratorId: string,
    actingUserId: string,
  ): Promise<StorytimeStoryCollaboratorEntity> {
    const collaborator = await this.findOrFail(collaboratorId);

    if (collaborator.userId !== actingUserId) {
      throw new ForbiddenException('That invitation is not yours to answer');
    }

    if (
      collaborator.invitationStatus !== CollaborationInvitationStatus.INVITED
    ) {
      throw new BadRequestException(
        'That invitation has already been answered.',
      );
    }

    return collaborator;
  }

  /**
   * Tells somebody they have been invited.
   *
   * Best effort: an invitation that is saved but not announced is recoverable,
   * because it still shows up in their invitations. Failing the whole request
   * over the notification would leave the owner thinking nothing happened when
   * something did.
   *
   * @param collaborator - The invitation.
   * @param storyTitle - The Story they have been invited to.
   */
  private async notifyInvited(
    collaborator: StorytimeStoryCollaboratorEntity,
    storyTitle: string,
  ): Promise<void> {
    try {
      await this._notificationService.createNotification({
        target: NotificationTarget.USER,
        userId: collaborator.userId,
        severity: NotificationSeverity.INFO,
        title: 'You have been invited to collaborate',
        body: `You have been invited to help write "${storyTitle}".`,
      });
    } catch (error) {
      this._logger.error(
        `Failed to notify member ${collaborator.userId} of their invitation`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
