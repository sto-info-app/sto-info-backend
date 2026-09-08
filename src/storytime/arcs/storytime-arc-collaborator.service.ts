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
import { ArcCapability } from '../collaboration/storytime-arc-capability.enum';
import { CollaborationInvitationStatus } from '../enums/collaboration-invitation-status.enum';
import { InviteArcCollaboratorDto } from './dto/invite-arc-collaborator.dto';
import { StorytimeArcCollaboratorEntity } from './entities/storytime-arc-collaborator.entity';
import { StorytimeArcService } from './storytime-arc.service';

/**
 * Inviting people to help assemble an Arc.
 *
 * The same two rules as Story collaboration, for the same reasons. Access is
 * something a person accepts rather than something a curator assigns, and
 * publishing is never delegated however the request is shaped.
 */
@Injectable()
export class StorytimeArcCollaboratorService {
  private readonly _logger = new Logger(StorytimeArcCollaboratorService.name);

  /**
   * Creates an instance of StorytimeArcCollaboratorService.
   *
   * @param _collaboratorRepository - Repository of Arc collaborators.
   * @param _arcService - Decides who may manage collaborators.
   * @param _notificationService - Tells somebody they have been invited.
   */
  constructor(
    @InjectRepository(StorytimeArcCollaboratorEntity)
    private readonly _collaboratorRepository: Repository<StorytimeArcCollaboratorEntity>,
    private readonly _arcService: StorytimeArcService,
    private readonly _notificationService: NotificationService,
  ) {}

  /**
   * Lists the collaborators on an Arc.
   *
   * @param arcId - The Arc.
   * @param actingUserId - The caller.
   * @returns The collaborators, invitations included.
   */
  async findByArc(
    arcId: string,
    actingUserId: string,
  ): Promise<StorytimeArcCollaboratorEntity[]> {
    await this._arcService.findAccessibleOrFail(arcId, actingUserId);

    return this._collaboratorRepository.find({
      where: { arcId },
      order: { invitedAt: 'ASC' },
    });
  }

  /**
   * Lists the Arc invitations waiting on somebody.
   *
   * @param userId - The person invited.
   * @returns Their unanswered invitations.
   */
  findPendingForUser(
    userId: string,
  ): Promise<StorytimeArcCollaboratorEntity[]> {
    return this._collaboratorRepository.find({
      where: {
        userId,
        invitationStatus: CollaborationInvitationStatus.INVITED,
      },
      order: { invitedAt: 'DESC' },
    });
  }

  /**
   * Invites somebody to help with an Arc.
   *
   * @param arcId - The Arc.
   * @param dto - Who to invite and what they may do.
   * @param actingUserId - The caller.
   * @returns The invitation.
   * @throws BadRequestException when inviting the curator or an existing member.
   */
  async invite(
    arcId: string,
    dto: InviteArcCollaboratorDto,
    actingUserId: string,
  ): Promise<StorytimeArcCollaboratorEntity> {
    const arc = await this._arcService.findEditableOrFail(
      arcId,
      actingUserId,
      ArcCapability.MANAGE_COLLABORATORS,
    );

    if (dto.userId === arc.ownerUserId) {
      throw new BadRequestException(
        'The curator of an Arc is already able to do everything.',
      );
    }

    const existing = await this._collaboratorRepository.findOne({
      where: { arcId, userId: dto.userId },
    });

    if (
      existing &&
      (existing.invitationStatus === CollaborationInvitationStatus.INVITED ||
        existing.invitationStatus === CollaborationInvitationStatus.ACCEPTED)
    ) {
      throw new BadRequestException(
        'That member has already been invited to this Arc.',
      );
    }

    const collaborator = existing ?? this._collaboratorRepository.create();

    Object.assign(collaborator, {
      arcId,
      userId: dto.userId,
      collaborationRole: dto.collaborationRole ?? null,
      canEditArc: dto.canEditArc ?? false,
      canManageStories: dto.canManageStories ?? false,
      canManageCollaborators: dto.canManageCollaborators ?? false,
      // Never granted, whatever the request says. Only the curator publishes.
      canPublish: false,
      invitationStatus: CollaborationInvitationStatus.INVITED,
      invitedByUserId: actingUserId,
      invitedAt: new Date(),
      acceptedAt: null,
      revokedAt: null,
    });

    const saved = await this._collaboratorRepository.save(collaborator);

    await this.notifyInvited(saved, arc.title);

    this._logger.log(
      `Member ${dto.userId} invited to Arc ${arcId} by ${actingUserId}`,
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
    dto: Partial<InviteArcCollaboratorDto>,
    actingUserId: string,
  ): Promise<StorytimeArcCollaboratorEntity> {
    const collaborator = await this.findOrFail(collaboratorId);

    await this._arcService.findEditableOrFail(
      collaborator.arcId,
      actingUserId,
      ArcCapability.MANAGE_COLLABORATORS,
    );

    const { canPublish, userId, ...capabilities } = dto;
    void canPublish;
    void userId;

    Object.assign(collaborator, capabilities);
    // Belt and braces alongside the DTO and the check constraint.
    collaborator.canPublish = false;

    return this._collaboratorRepository.save(collaborator);
  }

  /**
   * Accepts an invitation.
   *
   * @param collaboratorId - The invitation.
   * @param actingUserId - The caller.
   * @returns The accepted collaboration.
   */
  async accept(
    collaboratorId: string,
    actingUserId: string,
  ): Promise<StorytimeArcCollaboratorEntity> {
    const collaborator = await this.findInvitedForUserOrFail(
      collaboratorId,
      actingUserId,
    );

    collaborator.invitationStatus = CollaborationInvitationStatus.ACCEPTED;
    collaborator.acceptedAt = new Date();

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
  ): Promise<StorytimeArcCollaboratorEntity> {
    const collaborator = await this.findInvitedForUserOrFail(
      collaboratorId,
      actingUserId,
    );

    collaborator.invitationStatus = CollaborationInvitationStatus.DECLINED;

    return this._collaboratorRepository.save(collaborator);
  }

  /**
   * Withdraws an invitation, removes a collaborator, or steps down.
   *
   * @param collaboratorId - The collaboration.
   * @param actingUserId - The caller.
   * @returns The revoked collaboration.
   */
  async revoke(
    collaboratorId: string,
    actingUserId: string,
  ): Promise<StorytimeArcCollaboratorEntity> {
    const collaborator = await this.findOrFail(collaboratorId);

    // Somebody may always show themselves out, whatever they were granted.
    if (collaborator.userId !== actingUserId) {
      await this._arcService.findEditableOrFail(
        collaborator.arcId,
        actingUserId,
        ArcCapability.MANAGE_COLLABORATORS,
      );
    }

    collaborator.invitationStatus = CollaborationInvitationStatus.REVOKED;
    collaborator.revokedAt = new Date();

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
  ): Promise<StorytimeArcCollaboratorEntity> {
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
  ): Promise<StorytimeArcCollaboratorEntity> {
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
   * Best effort: the invitation still shows up in their list, so failing the
   * whole request over the announcement would leave the curator thinking
   * nothing happened when something did.
   *
   * @param collaborator - The invitation.
   * @param arcTitle - The Arc they have been invited to.
   */
  private async notifyInvited(
    collaborator: StorytimeArcCollaboratorEntity,
    arcTitle: string,
  ): Promise<void> {
    try {
      await this._notificationService.createNotification({
        target: NotificationTarget.USER,
        userId: collaborator.userId,
        severity: NotificationSeverity.INFO,
        title: 'You have been invited to help with an Arc',
        body: `You have been invited to help assemble "${arcTitle}".`,
      });
    } catch (error) {
      this._logger.error(
        `Failed to notify member ${collaborator.userId} of their Arc invitation`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
