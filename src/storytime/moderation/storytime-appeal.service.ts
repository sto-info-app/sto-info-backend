import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { NotificationSeverity } from '../../notification/enums/notification-severity.enum';
import { NotificationTarget } from '../../notification/enums/notification-target.enum';
import { NotificationService } from '../../notification/notification.service';
import { AppealStatus } from '../enums/appeal-status.enum';
import { StorytimeModerationAction } from '../enums/storytime-moderation-action.enum';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { CreateAppealDto } from './dto/create-appeal.dto';
import { DecideAppealDto } from './dto/decide-appeal.dto';
import { StorytimeModerationAppealEntity } from './entities/storytime-moderation-appeal.entity';
import { StorytimeModerationTargetService } from './storytime-moderation-target.service';
import { StorytimeModerationService } from './storytime-moderation.service';

/** The states an appeal has already been spent in. */
const SPENT_STATUSES = [
  AppealStatus.SUBMITTED,
  AppealStatus.UPHELD,
  AppealStatus.REJECTED,
];

/**
 * A creator's right of reply to something of theirs being removed.
 *
 * One appeal per removed item. Withdrawing frees the creator to put a better
 * argument; having it decided does not, because a decision that can be
 * reopened by asking again is not a decision.
 *
 * Upholding an appeal restores the content as part of the same act, so an
 * administrator cannot agree with somebody and then forget to give them their
 * Story back.
 */
@Injectable()
export class StorytimeAppealService {
  private readonly _logger = new Logger(StorytimeAppealService.name);

  /**
   * Creates an instance of StorytimeAppealService.
   *
   * @param _appealRepository - Repository of appeals.
   * @param _targetService - Resolves the removed content.
   * @param _moderationService - Restores content and writes the audit trail.
   * @param _notificationService - Tells the creator what was decided.
   */
  constructor(
    @InjectRepository(StorytimeModerationAppealEntity)
    private readonly _appealRepository: Repository<StorytimeModerationAppealEntity>,
    private readonly _targetService: StorytimeModerationTargetService,
    private readonly _moderationService: StorytimeModerationService,
    private readonly _notificationService: NotificationService,
  ) {}

  /**
   * Appeals against a removal.
   *
   * @param dto - What is being appealed, and what the creator has to say.
   * @param appellantUserId - The creator.
   * @returns The appeal.
   */
  async create(
    dto: CreateAppealDto,
    appellantUserId: string,
  ): Promise<StorytimeModerationAppealEntity> {
    const target = await this._targetService.find(dto.targetType, dto.targetId);

    if (!target) {
      throw new NotFoundException('That content could not be found.');
    }

    if (target.ownerUserId !== appellantUserId) {
      throw new ForbiddenException(
        'Only the person whose work was removed may appeal.',
      );
    }

    if (target.content.moderationStatus !== StorytimeModerationStatus.REMOVED) {
      throw new BadRequestException('That content has not been removed.');
    }

    const existing = await this._appealRepository.findOne({
      where: {
        targetType: dto.targetType,
        targetId: dto.targetId,
        appellantUserId,
        status: In(SPENT_STATUSES),
      },
    });

    if (existing) {
      throw new BadRequestException(
        existing.status === AppealStatus.SUBMITTED
          ? 'You have already appealed this, and it is still being looked at.'
          : 'This has already been appealed and decided.',
      );
    }

    const appeal = await this._appealRepository.save(
      this._appealRepository.create({
        targetType: dto.targetType,
        targetId: dto.targetId,
        appellantUserId,
        body: dto.body,
        status: AppealStatus.SUBMITTED,
      }),
    );

    this._logger.log(
      `Appeal ${appeal.id} raised against the removal of ${dto.targetType} ${dto.targetId}`,
    );

    return appeal;
  }

  /**
   * Lists the appeals a creator has made.
   *
   * @param appellantUserId - The creator.
   * @returns Their appeals, most recent first.
   */
  findMine(
    appellantUserId: string,
  ): Promise<StorytimeModerationAppealEntity[]> {
    return this._appealRepository.find({
      where: { appellantUserId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Lists the appeals waiting on an administrator.
   *
   * @param status - The status to filter to, if any.
   * @returns The appeals, oldest first.
   */
  findForAdmin(
    status?: AppealStatus,
  ): Promise<StorytimeModerationAppealEntity[]> {
    return this._appealRepository.find({
      where: status ? { status } : {},
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Takes an appeal back before it is decided.
   *
   * @param appealId - The appeal.
   * @param appellantUserId - The creator.
   * @returns The withdrawn appeal.
   */
  async withdraw(
    appealId: string,
    appellantUserId: string,
  ): Promise<StorytimeModerationAppealEntity> {
    const appeal = await this.findOneOrFail(appealId);

    if (appeal.appellantUserId !== appellantUserId) {
      throw new ForbiddenException('That appeal is not yours to withdraw.');
    }

    if (appeal.status !== AppealStatus.SUBMITTED) {
      throw new BadRequestException('That appeal has already been decided.');
    }

    appeal.status = AppealStatus.WITHDRAWN;

    return this._appealRepository.save(appeal);
  }

  /**
   * Decides an appeal, restoring the content when it is upheld.
   *
   * @param appealId - The appeal.
   * @param dto - The decision and what to say about it.
   * @param actingUserId - The administrator.
   * @returns The decided appeal.
   */
  async decide(
    appealId: string,
    dto: DecideAppealDto,
    actingUserId: string,
  ): Promise<StorytimeModerationAppealEntity> {
    const appeal = await this.findOneOrFail(appealId);

    if (appeal.status !== AppealStatus.SUBMITTED) {
      throw new BadRequestException(
        'That appeal has already been answered or withdrawn.',
      );
    }

    appeal.status = dto.uphold ? AppealStatus.UPHELD : AppealStatus.REJECTED;
    appeal.reviewedByUserId = actingUserId;
    appeal.reviewedAt = new Date();
    appeal.reviewNotes = dto.reviewNotes ?? null;

    const saved = await this._appealRepository.save(appeal);

    if (dto.uphold) {
      // Restoring here rather than leaving it to a second action is the whole
      // point: agreeing with somebody and then not giving them their work back
      // is the failure this workflow exists to prevent.
      await this._moderationService.restore(
        {
          targetType: appeal.targetType,
          targetId: appeal.targetId,
          reasonCode: null,
          message:
            dto.reviewNotes ?? 'Your appeal was upheld and this was restored.',
        },
        actingUserId,
      );
    }

    await this._moderationService.record(
      appeal.targetType,
      appeal.targetId,
      dto.uphold
        ? StorytimeModerationAction.APPEAL_UPHELD
        : StorytimeModerationAction.APPEAL_REJECTED,
      actingUserId,
      null,
      dto.reviewNotes ?? null,
    );

    await this.notifyDecision(saved, dto.uphold);

    return saved;
  }

  /**
   * Retrieves one appeal.
   *
   * @param appealId - The appeal.
   * @returns The appeal.
   * @throws NotFoundException when no appeal has that identifier.
   */
  private async findOneOrFail(
    appealId: string,
  ): Promise<StorytimeModerationAppealEntity> {
    const appeal = await this._appealRepository.findOne({
      where: { id: appealId },
    });

    if (!appeal) {
      throw new NotFoundException('That appeal could not be found.');
    }

    return appeal;
  }

  /**
   * Tells the creator what was decided.
   *
   * Best effort, like every other Storytime notification: the decision is
   * already recorded, and losing it because the message failed would be worse
   * than the creator reading it on their own page.
   *
   * @param appeal - The decided appeal.
   * @param upheld - Whether it was upheld.
   */
  private async notifyDecision(
    appeal: StorytimeModerationAppealEntity,
    upheld: boolean,
  ): Promise<void> {
    const kind = this._targetService.describe(appeal.targetType).toLowerCase();

    try {
      await this._notificationService.createNotification({
        target: NotificationTarget.USER,
        userId: appeal.appellantUserId,
        severity: upheld
          ? NotificationSeverity.INFO
          : NotificationSeverity.WARNING,
        title: upheld ? 'Your appeal was upheld' : 'Your appeal was not upheld',
        body: upheld
          ? `Your ${kind} has been restored.`
          : `The removal of your ${kind} stands.${
              appeal.reviewNotes ? ` ${appeal.reviewNotes}` : ''
            }`,
      });
    } catch (error) {
      this._logger.error(
        `Failed to notify ${appeal.appellantUserId} of an appeal decision`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
