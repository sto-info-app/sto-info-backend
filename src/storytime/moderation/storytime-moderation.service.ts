import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationSeverity } from '../../notification/enums/notification-severity.enum';
import { NotificationTarget } from '../../notification/enums/notification-target.enum';
import { NotificationService } from '../../notification/notification.service';
import { StorytimeModerationAction } from '../enums/storytime-moderation-action.enum';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { ModerateContentDto } from './dto/moderate-content.dto';
import { StorytimeModerationActionEntity } from './entities/storytime-moderation-action.entity';
import {
  ModeratedTarget,
  StorytimeModerationTargetService,
} from './storytime-moderation-target.service';

/**
 * Removing content from public view, putting it back, and recording both.
 *
 * Removal is deliberately not deletion. The content stays in the database and
 * stays visible to the person who wrote it, flagged with the administrator's
 * message: somebody who cannot see what was removed cannot fix it, and cannot
 * meaningfully appeal it either.
 *
 * Every act writes an audit entry before anything else can go wrong with the
 * notification, because the record of what an administrator did is the part
 * that must not be lost.
 */
@Injectable()
export class StorytimeModerationService {
  private readonly _logger = new Logger(StorytimeModerationService.name);

  /**
   * Creates an instance of StorytimeModerationService.
   *
   * @param _actionRepository - The append-only audit trail.
   * @param _targetService - Resolves content of any moderatable kind.
   * @param _notificationService - Tells the creator what happened.
   */
  constructor(
    @InjectRepository(StorytimeModerationActionEntity)
    private readonly _actionRepository: Repository<StorytimeModerationActionEntity>,
    private readonly _targetService: StorytimeModerationTargetService,
    private readonly _notificationService: NotificationService,
  ) {}

  /**
   * Removes a piece of content from public view.
   *
   * @param dto - What to remove, why, and what to tell the creator.
   * @param actingUserId - The administrator.
   * @returns The audit entry written.
   */
  async remove(
    dto: ModerateContentDto,
    actingUserId: string,
  ): Promise<StorytimeModerationActionEntity> {
    const target = await this.findOrFail(dto.targetType, dto.targetId);

    if (target.content.moderationStatus === StorytimeModerationStatus.REMOVED) {
      throw new BadRequestException('That content has already been removed.');
    }

    target.content.moderationStatus = StorytimeModerationStatus.REMOVED;
    target.content.removedAt = new Date();
    target.content.removedByUserId = actingUserId;
    target.content.moderationReasonCode = dto.reasonCode;
    target.content.moderationMessage = dto.message;
    target.content.restoredAt = null;
    target.content.restoredByUserId = null;

    await this._targetService.save(dto.targetType, target.content);

    const entry = await this.record(
      dto.targetType,
      dto.targetId,
      StorytimeModerationAction.REMOVED,
      actingUserId,
      dto.reasonCode,
      dto.message,
    );

    await this.notify(
      target,
      dto.targetType,
      `Your ${this._targetService.describe(dto.targetType)} has been removed`,
      // The administrator's own words, verbatim: a creator cannot answer a
      // paraphrase, and an appeal against one would be arguing with nobody.
      dto.message,
    );

    return entry;
  }

  /**
   * Puts removed content back.
   *
   * @param dto - What to restore, and what to tell the creator.
   * @param actingUserId - The administrator.
   * @returns The audit entry written.
   */
  async restore(
    dto: ModerateContentDto,
    actingUserId: string,
  ): Promise<StorytimeModerationActionEntity> {
    const target = await this.findOrFail(dto.targetType, dto.targetId);

    if (target.content.moderationStatus !== StorytimeModerationStatus.REMOVED) {
      throw new BadRequestException('That content has not been removed.');
    }

    target.content.moderationStatus = StorytimeModerationStatus.ACTIVE;
    target.content.restoredAt = new Date();
    target.content.restoredByUserId = actingUserId;
    // The removal details stay: what happened to a Story is part of its
    // history, and a restore that erased them would leave a creator unable to
    // show what they had answered.
    await this._targetService.save(dto.targetType, target.content);

    const entry = await this.record(
      dto.targetType,
      dto.targetId,
      StorytimeModerationAction.RESTORED,
      actingUserId,
      dto.reasonCode,
      dto.message,
    );

    await this.notify(
      target,
      dto.targetType,
      `Your ${this._targetService.describe(dto.targetType)} has been restored`,
      dto.message,
    );

    return entry;
  }

  /**
   * Lists everything an administrator has done to a piece of content.
   *
   * @param targetType - The kind of content.
   * @param targetId - The content.
   * @returns The audit entries, most recent first.
   */
  findHistory(
    targetType: StorytimeTargetType,
    targetId: string,
  ): Promise<StorytimeModerationActionEntity[]> {
    return this._actionRepository.find({
      where: { targetType, targetId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Writes one entry into the audit trail.
   *
   * Public because reports and appeals are moderation acts too, and they are
   * recorded in the same place as removals — one history per piece of content
   * beats three that have to be read together.
   *
   * @param targetType - The kind of content.
   * @param targetId - The content.
   * @param action - What was done.
   * @param actorUserId - Who did it.
   * @param reasonCode - The policy code cited, if any.
   * @param message - What was said, if anything.
   * @returns The entry written.
   */
  record(
    targetType: StorytimeTargetType,
    targetId: string,
    action: StorytimeModerationAction,
    actorUserId: string,
    reasonCode: string | null = null,
    message: string | null = null,
  ): Promise<StorytimeModerationActionEntity> {
    return this._actionRepository.save(
      this._actionRepository.create({
        targetType,
        targetId,
        action,
        actorUserId,
        reasonCode,
        message,
      }),
    );
  }

  /**
   * Finds the content an act names, or refuses.
   *
   * @param targetType - The kind of content.
   * @param targetId - The content.
   * @returns The target.
   * @throws NotFoundException when nothing matches.
   */
  private async findOrFail(
    targetType: StorytimeTargetType,
    targetId: string,
  ): Promise<ModeratedTarget> {
    const target = await this._targetService.find(targetType, targetId);

    if (!target) {
      throw new NotFoundException('That content could not be found.');
    }

    return target;
  }

  /**
   * Tells the creator what has happened to their work.
   *
   * Best effort: the act and its audit entry are already saved, and losing
   * them because the notification failed would be far worse than a creator
   * finding out when they next look.
   *
   * @param target - The content acted on.
   * @param targetType - The kind of content.
   * @param title - The notification title.
   * @param message - The administrator's explanation.
   */
  private async notify(
    target: ModeratedTarget,
    targetType: StorytimeTargetType,
    title: string,
    message: string | null,
  ): Promise<void> {
    const kind = this._targetService.describe(targetType).toLowerCase();
    const body = message
      ? `"${target.label}": ${message}`
      : `Your ${kind} "${target.label}" has been actioned by an administrator.`;

    try {
      await this._notificationService.createNotification({
        target: NotificationTarget.USER,
        userId: target.ownerUserId,
        severity: NotificationSeverity.WARNING,
        title,
        body,
      });
    } catch (error) {
      this._logger.error(
        `Failed to notify ${target.ownerUserId} of a moderation action`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
