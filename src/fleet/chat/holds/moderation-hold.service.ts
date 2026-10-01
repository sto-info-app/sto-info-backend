import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
  Not,
  QueryFailedError,
} from 'typeorm';

import { NotificationSeverity } from 'src/notification/enums/notification-severity.enum';
import { NotificationTarget } from 'src/notification/enums/notification-target.enum';
import { NotificationService } from 'src/notification/notification.service';
import { UserEntity } from 'src/user/entities/user.entity';
import { UserRole } from 'src/user/enums/user-role.enum';

import {
  MODERATION_HOLD_RELEASE_GRACE_DAYS,
  MODERATION_HOLD_RELEASE_WARNING_DAYS,
} from '../../constants/fleet-policy.constants';
import { usernamesFor } from '../../recruitment/utilities/recruitment-names.utility';
import { RetentionOutcome } from '../../retention/retention-run.service';
import { RETENTION_BATCH_SIZE } from '../../retention/retention.constants';
import { scopePlaceOf } from '../../utilities/scope-place.utility';
import { ChatReportPlaceDto } from '../dto/chat-report.dto';
import { ChatPersonDto } from '../dto/chat.dto';
import { ChatChannelEntity } from '../entities/chat-channel.entity';
import { ChatDirectConversationEntity } from '../entities/chat-direct-conversation.entity';
import { ChatMessageReportEntity } from '../entities/chat-message-report.entity';
import { ChatMessageEntity } from '../entities/chat-message.entity';
import { ChatReportEvidenceEntity } from '../entities/chat-report-evidence.entity';
import { cursorOf } from '../services/chat-message.service';
import {
  HoldLedgerService,
  LEDGERED_HOLD_ACTIONS,
} from './hold-ledger.service';
import { ModerationHoldActionEntity } from './moderation-hold-action.entity';
import {
  HeldMessagePageDto,
  ModerationHoldDetailDto,
  ModerationHoldDto,
  ModerationHoldExtendDto,
  ModerationHoldPlaceDto,
  ModerationHoldReadDto,
} from './moderation-hold.dto';
import { ModerationHoldEntity } from './moderation-hold.entity';
import {
  ModerationHoldActionKind,
  ModerationHoldKind,
} from './moderation-hold.enums';

/** How far ahead a hold's review may be set, and is by default, in days. */
export const MODERATION_HOLD_REVIEW_DAYS = 180;

/** How many kept messages are read at a time. */
export const HELD_MESSAGE_PAGE_SIZE = 50;

/** One day, in milliseconds. */
const DAY = 86_400_000;

/** Where a site admin reviews holds. */
const HOLDS_LINK = '/admin/holds';

/** The actions that are the system's alone. */
const AUTOMATIC: ReadonlySet<ModerationHoldActionKind> = new Set([
  ModerationHoldActionKind.REVIEW_DUE,
  ModerationHoldActionKind.RELEASE_WARNED,
]);

/**
 * Site admins' holds on chat evidence (FC-036).
 *
 * R23, plan section 9 and Steve's decisions of 29 September 2026:
 *
 * - A hold keeps a chat report's evidence past its 90 days, or everything
 *   one member ever wrote in chat — every channel and conversation — past
 *   the 45-day purge. One live hold per report and per member.
 * - Each has a reason, an owner (the admin who placed it), a review date at
 *   most 180 days ahead, and ends by a release, with a reason.
 * - No hold runs on unreviewed (FC-037, Steve's decision of the same day):
 *   when its review date passes, its owner is told; seven days before the
 *   system would release it, every site admin is; and 14 days after the
 *   date, unless somebody has extended it, the system releases it, logged
 *   as a release nobody made. Extending it starts all three again.
 * - What it keeps is read only here, by site admins, each time with a
 *   purpose, and every reading is logged. Nobody else — scope moderators
 *   included — ever sees it.
 * - Released, what it kept goes with the next purge, as if never held.
 * - Each placing, extension and release is written to the hold ledger,
 *   outside the database, before the database (FC-042), so a restore from
 *   an older backup cannot lose it: the restore check at boot brings back
 *   every event the database lacks.
 */
@Injectable()
export class ModerationHoldService {
  private readonly _logger = new Logger(ModerationHoldService.name);

  /**
   * Creates an instance of ModerationHoldService.
   *
   * @param _dataSource - The database.
   * @param _notifications - Tells site admins of holds past review.
   * @param _ledger - Keeps each placing, extension and release outside the
   *   database (FC-042).
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _notifications: NotificationService,
    private readonly _ledger: HoldLedgerService,
  ) {}

  /**
   * Places a hold.
   *
   * @param adminId - The site admin, who owns it.
   * @param dto - What, why and when to review it.
   * @returns The hold.
   * @throws NotFoundException when the report or member does not exist.
   * @throws BadRequestException when the review date is not within reach.
   * @throws ConflictException when one is already in force.
   */
  async place(
    adminId: string,
    dto: ModerationHoldPlaceDto,
  ): Promise<ModerationHoldDetailDto> {
    const manager = this._dataSource.manager;
    const reportHold = dto.kind === ModerationHoldKind.CHAT_REPORT;
    const exists = reportHold
      ? await manager.exists(ChatMessageReportEntity, {
          where: { id: dto.chatReportId },
        })
      : await manager.exists(UserEntity, { where: { id: dto.subjectUserId } });

    if (!exists) {
      throw new NotFoundException('Not found');
    }

    const reviewAt =
      dto.reviewAt ?? new Date(Date.now() + MODERATION_HOLD_REVIEW_DAYS * DAY);

    assertReviewable(reviewAt);

    try {
      const hold = await this._dataSource.transaction(async transaction => {
        const saved = await transaction.save(ModerationHoldEntity, {
          kind: dto.kind,
          chatReportId: reportHold ? (dto.chatReportId as string) : null,
          subjectUserId: reportHold ? null : (dto.subjectUserId as string),
          reason: dto.reason,
          ownerUserId: adminId,
          reviewAt,
        });

        await log(
          transaction,
          this._ledger,
          saved,
          ModerationHoldActionKind.PLACED,
          {
            actorUserId: adminId,
            reason: dto.reason,
            detail: { reviewAt: reviewAt.toISOString() },
          },
        );

        return saved;
      });

      this._logger.log(
        `[place] Moderation hold placed - HoldId: ${hold.id}, Kind: ${hold.kind}`,
      );

      return this.detail(hold.id);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string } | undefined)?.code === '23505'
      ) {
        throw new ConflictException('A hold on that is already in force.');
      }

      throw error;
    }
  }

  /**
   * Moves a hold's review date, with a reason.
   *
   * @param holdId - The hold.
   * @param adminId - The site admin.
   * @param dto - The new date, and why.
   * @returns The hold.
   * @throws NotFoundException when there is no such hold in force.
   * @throws BadRequestException when the date is not within reach.
   */
  async extend(
    holdId: string,
    adminId: string,
    dto: ModerationHoldExtendDto,
  ): Promise<ModerationHoldDetailDto> {
    assertReviewable(dto.reviewAt);

    await this._dataSource.transaction(async manager => {
      const held = await this.inForce(manager, holdId);
      const from = held.reviewAt;

      await manager.update(
        ModerationHoldEntity,
        { id: holdId },
        { reviewAt: dto.reviewAt },
      );
      await log(
        manager,
        this._ledger,
        { ...held, reviewAt: dto.reviewAt },
        ModerationHoldActionKind.EXTENDED,
        {
          actorUserId: adminId,
          reason: dto.reason,
          detail: { from: from.toISOString(), to: dto.reviewAt.toISOString() },
        },
      );
    });

    return this.detail(holdId);
  }

  /**
   * Releases a hold, with a reason. What it kept goes with the next purge.
   *
   * @param holdId - The hold.
   * @param adminId - The site admin.
   * @param reason - Why.
   * @returns The hold.
   * @throws NotFoundException when there is no such hold in force.
   */
  async release(
    holdId: string,
    adminId: string,
    reason: string,
  ): Promise<ModerationHoldDetailDto> {
    await this._dataSource.transaction(async manager => {
      const held = await this.inForce(manager, holdId);

      await manager.update(
        ModerationHoldEntity,
        { id: holdId },
        {
          releasedAt: new Date(),
          releasedByUserId: adminId,
          releaseReason: reason,
        },
      );
      await log(
        manager,
        this._ledger,
        held,
        ModerationHoldActionKind.RELEASED,
        {
          actorUserId: adminId,
          reason,
        },
      );
    });

    this._logger.log(`[release] Moderation hold released - HoldId: ${holdId}`);

    return this.detail(holdId);
  }

  /**
   * Lists holds, those due for review first, then newest.
   *
   * @param active - Only those in force, only those released, or all.
   * @returns Each.
   */
  async list(active?: boolean): Promise<ModerationHoldDto[]> {
    const holds = await this._dataSource.manager.find(ModerationHoldEntity, {
      where:
        active === undefined
          ? {}
          : { releasedAt: active ? IsNull() : Not(IsNull()) },
      order: { reviewAt: 'ASC', createdAt: 'DESC' },
    });

    return this.toDtos(holds);
  }

  /**
   * One hold, with its log.
   *
   * @param holdId - The hold.
   * @returns It.
   * @throws NotFoundException when there is none.
   */
  async detail(holdId: string): Promise<ModerationHoldDetailDto> {
    const manager = this._dataSource.manager;
    const hold = await manager.findOne(ModerationHoldEntity, {
      where: { id: holdId },
    });

    if (hold === null) {
      throw new NotFoundException('Not found');
    }

    const actions = await manager.find(ModerationHoldActionEntity, {
      where: { holdId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    const names = await usernamesFor(
      manager,
      actions.map(action => action.actorUserId),
    );

    return {
      ...(await this.toDtos([hold]))[0],
      actions: actions.map(action => ({
        action: action.action,
        actor: personOf(action.actorUserId, names),
        automatic:
          AUTOMATIC.has(action.action) || action.detail?.automatic === true,
        reason: action.reason,
        createdAt: action.createdAt,
      })),
    };
  }

  /**
   * Reads what a hold keeps, newest first, with a purpose, logged.
   *
   * @param holdId - The hold.
   * @param adminId - The site admin.
   * @param dto - Why, and where to carry on from.
   * @returns A page.
   * @throws NotFoundException when there is no such hold.
   */
  async read(
    holdId: string,
    adminId: string,
    dto: ModerationHoldReadDto,
  ): Promise<HeldMessagePageDto> {
    const manager = this._dataSource.manager;
    const hold = await manager.findOne(ModerationHoldEntity, {
      where: { id: holdId },
    });

    if (hold === null) {
      throw new NotFoundException('Not found');
    }

    const page =
      hold.kind === ModerationHoldKind.CHAT_REPORT
        ? await this.evidenceOf(manager, hold.chatReportId as string)
        : await this.messagesOf(manager, hold.subjectUserId, dto.before);

    await log(manager, this._ledger, hold, ModerationHoldActionKind.READ, {
      actorUserId: adminId,
      reason: dto.purpose,
      detail: {
        messages: page.messages.length,
        ...(dto.before ? { before: dto.before } : {}),
      },
    });

    return page;
  }

  /**
   * Keeps holds from running on unreviewed (FC-037). For each hold in force
   * whose review date has passed: tells its owner, once per review date;
   * tells every site admin, once, seven days before the system would
   * release it; and releases it 14 days after the date. Daily, by the
   * Fleet's retention schedule.
   *
   * @returns How many owners were told, warnings sent and holds released,
   *   and whether that was every hold due.
   */
  async review(): Promise<RetentionOutcome> {
    const manager = this._dataSource.manager;
    const now = Date.now();
    const due = await manager.find(ModerationHoldEntity, {
      where: { releasedAt: IsNull(), reviewAt: LessThanOrEqual(new Date(now)) },
      order: { reviewAt: 'ASC', id: 'ASC' },
      take: RETENTION_BATCH_SIZE,
    });
    const admins = await this.siteAdmins();
    const counts = { told: 0, warned: 0, released: 0 };

    for (const hold of due) {
      const passed = now - hold.reviewAt.getTime();

      if (passed >= MODERATION_HOLD_RELEASE_GRACE_DAYS * DAY) {
        counts.released += (await this.releaseUnreviewed(hold)) ? 1 : 0;
        continue;
      }

      const noticed = await this.noticesFor(hold);

      if (!noticed.has(ModerationHoldActionKind.REVIEW_DUE)) {
        const owner =
          hold.ownerUserId !== null && admins.includes(hold.ownerUserId)
            ? [hold.ownerUserId]
            : admins;

        await this.tell(
          owner,
          'Hold due for review',
          `A hold on ${whatOf(hold)} is due for review. Extend or release ` +
            `it within ${MODERATION_HOLD_RELEASE_GRACE_DAYS} days, or it ` +
            'will be released automatically.',
        );
        await log(
          manager,
          this._ledger,
          hold,
          ModerationHoldActionKind.REVIEW_DUE,
          {
            actorUserId: null,
            reason: 'Its review date passed.',
            detail: {
              reviewAt: hold.reviewAt.toISOString(),
              told: owner.length,
            },
            idempotencyKey: `REVIEW_DUE:${hold.id}:${hold.reviewAt.toISOString()}`,
          },
        );
        counts.told++;
      }

      if (
        passed >=
          (MODERATION_HOLD_RELEASE_GRACE_DAYS -
            MODERATION_HOLD_RELEASE_WARNING_DAYS) *
            DAY &&
        !noticed.has(ModerationHoldActionKind.RELEASE_WARNED)
      ) {
        await this.tell(
          admins,
          'Hold to be released',
          `A hold on ${whatOf(hold)} has not been reviewed. It will be ` +
            'released automatically in ' +
            `${MODERATION_HOLD_RELEASE_WARNING_DAYS} days unless somebody ` +
            'extends it.',
        );
        await log(
          manager,
          this._ledger,
          hold,
          ModerationHoldActionKind.RELEASE_WARNED,
          {
            actorUserId: null,
            reason:
              `To be released in ${MODERATION_HOLD_RELEASE_WARNING_DAYS} days ` +
              'unless extended.',
            detail: {
              reviewAt: hold.reviewAt.toISOString(),
              told: admins.length,
            },
            idempotencyKey: `RELEASE_WARNED:${hold.id}:${hold.reviewAt.toISOString()}`,
          },
        );
        counts.warned++;
      }
    }

    return { counts, complete: due.length < RETENTION_BATCH_SIZE };
  }

  /**
   * Releases a hold nobody reviewed, unless somebody has extended or
   * released it since it was read.
   *
   * @param hold - The hold, as read.
   * @returns Whether it was released.
   */
  private async releaseUnreviewed(
    hold: ModerationHoldEntity,
  ): Promise<boolean> {
    const reason =
      'Released automatically: not reviewed within ' +
      `${MODERATION_HOLD_RELEASE_GRACE_DAYS} days of its review date.`;
    const released = await this._dataSource.transaction(async manager => {
      const current = await manager.findOne(ModerationHoldEntity, {
        where: { id: hold.id, releasedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });

      if (
        current === null ||
        current.reviewAt.getTime() !== hold.reviewAt.getTime()
      ) {
        return false;
      }

      await manager.update(
        ModerationHoldEntity,
        { id: hold.id },
        {
          releasedAt: new Date(),
          releasedByUserId: null,
          releaseReason: reason,
        },
      );
      await log(
        manager,
        this._ledger,
        current,
        ModerationHoldActionKind.RELEASED,
        {
          actorUserId: null,
          reason,
          detail: { automatic: true, reviewAt: hold.reviewAt.toISOString() },
          idempotencyKey: `RELEASED:${hold.id}`,
        },
      );

      return true;
    });

    if (released) {
      this._logger.log(
        `[review] Unreviewed moderation hold released - HoldId: ${hold.id}`,
      );
    }

    return released;
  }

  /**
   * The system's notices already given for a hold's present review date.
   *
   * @param hold - The hold.
   * @returns Which.
   */
  private async noticesFor(
    hold: ModerationHoldEntity,
  ): Promise<Set<ModerationHoldActionKind>> {
    const at = hold.reviewAt.toISOString();
    const notices = await this._dataSource.manager.find(
      ModerationHoldActionEntity,
      { where: { holdId: hold.id, action: In([...AUTOMATIC]) } },
    );

    return new Set(
      notices
        .filter(notice => notice.detail?.reviewAt === at)
        .map(notice => notice.action),
    );
  }

  /**
   * The site's admins whose accounts are open.
   *
   * @returns Their IDs.
   */
  private async siteAdmins(): Promise<string[]> {
    const admins = await this._dataSource.manager.find(UserEntity, {
      where: { role: UserRole.ADMIN, disabledAt: IsNull() },
      select: { id: true },
    });

    return admins.map(admin => admin.id);
  }

  /**
   * Tells site admins something in-app, reporting rather than throwing when
   * a notice cannot be written: the log records the step either way.
   *
   * @param userIds - Whom.
   * @param title - The notice's title.
   * @param body - Its text.
   */
  private async tell(
    userIds: readonly string[],
    title: string,
    body: string,
  ): Promise<void> {
    for (const userId of userIds) {
      try {
        await this._notifications.createNotification({
          target: NotificationTarget.USER,
          userId,
          severity: NotificationSeverity.WARNING,
          title,
          body,
          linkUrl: HOLDS_LINK,
        });
      } catch (error) {
        this._logger.warn(
          `[tell] Hold notice not sent - UserId: ${userId}, ` +
            `Reason: ${(error as Error).name}`,
        );
      }
    }
  }

  /**
   * Finds a hold still in force, locked.
   *
   * @param manager - The transaction.
   * @param holdId - The hold.
   * @returns It.
   * @throws NotFoundException when there is none in force.
   */
  private async inForce(
    manager: EntityManager,
    holdId: string,
  ): Promise<ModerationHoldEntity> {
    const hold = await manager.findOne(ModerationHoldEntity, {
      where: { id: holdId, releasedAt: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });

    if (hold === null) {
      throw new NotFoundException('Not found');
    }

    return hold;
  }

  /**
   * A report's evidence, as kept messages, newest first.
   *
   * @param manager - The manager to read through.
   * @param chatReportId - The report.
   * @returns All of it, on one page; nothing once a released hold's report
   *   has been purged.
   */
  private async evidenceOf(
    manager: EntityManager,
    chatReportId: string,
  ): Promise<HeldMessagePageDto> {
    const report = await manager.findOne(ChatMessageReportEntity, {
      where: { id: chatReportId },
    });

    if (report === null) {
      return { messages: [], before: null };
    }

    const evidence = await manager.find(ChatReportEvidenceEntity, {
      where: { reportId: chatReportId },
      order: { position: 'ASC' },
    });
    const place = (await placesOf(manager, [report]))(report);

    return {
      messages: evidence.map(held => ({
        id: held.messageId,
        place: place.place,
        with: place.with,
        author:
          held.authorUserId === null
            ? null
            : { userId: held.authorUserId, username: held.authorUsername },
        body: held.body,
        deleted: held.deleted,
        sentAt: held.sentAt,
      })),
      before: null,
    };
  }

  /**
   * Everything a member wrote in chat, newest first, a page at a time.
   *
   * @param manager - The manager to read through.
   * @param userId - The member, or null once their account has gone.
   * @param before - Where to carry on from.
   * @returns The page.
   */
  private async messagesOf(
    manager: EntityManager,
    userId: string | null,
    before: string | undefined,
  ): Promise<HeldMessagePageDto> {
    if (userId === null) {
      return { messages: [], before: null };
    }

    const base = { authorUserId: userId };
    let where = [base] as object[];

    if (before !== undefined) {
      const split = before.lastIndexOf('_');
      const at = new Date(before.slice(0, split));
      const id = before.slice(split + 1);

      where = [
        { ...base, createdAt: LessThan(at) },
        { ...base, createdAt: at, id: LessThan(id) },
      ];
    }

    const messages = await manager.find(ChatMessageEntity, {
      where,
      order: { createdAt: 'DESC', id: 'DESC' },
      take: HELD_MESSAGE_PAGE_SIZE,
    });
    const place = await placesOf(manager, messages, userId);
    const names = await usernamesFor(manager, [userId]);

    return {
      messages: messages.map(message => ({
        id: message.id,
        ...place(message),
        author: personOf(userId, names),
        body: message.body,
        deleted: message.deletedAt !== null,
        sentAt: message.createdAt,
      })),
      before:
        messages.length === HELD_MESSAGE_PAGE_SIZE
          ? cursorOf(messages[messages.length - 1])
          : null,
    };
  }

  /**
   * Shows holds, with who.
   *
   * @param holds - The holds.
   * @returns Each.
   */
  private async toDtos(
    holds: readonly ModerationHoldEntity[],
  ): Promise<ModerationHoldDto[]> {
    const manager = this._dataSource.manager;
    const reportIds = holds
      .map(hold => hold.chatReportId)
      .filter((id): id is string => id !== null);
    const reports =
      reportIds.length === 0
        ? []
        : await manager.find(ChatMessageReportEntity, {
            where: { id: In(reportIds) },
          });
    const authorOf = new Map(
      reports.map(report => [report.id, report.authorUserId]),
    );
    const subjectOf = (hold: ModerationHoldEntity): string | null =>
      hold.chatReportId === null
        ? hold.subjectUserId
        : (authorOf.get(hold.chatReportId) ?? null);
    const names = await usernamesFor(
      manager,
      holds.flatMap(hold => [
        subjectOf(hold),
        hold.ownerUserId,
        hold.releasedByUserId,
      ]),
    );
    const now = Date.now();

    return holds.map(hold => ({
      id: hold.id,
      kind: hold.kind,
      chatReportId: hold.chatReportId,
      subject: personOf(subjectOf(hold), names),
      reason: hold.reason,
      owner: personOf(hold.ownerUserId, names),
      reviewAt: hold.reviewAt,
      reviewDue: hold.releasedAt === null && hold.reviewAt.getTime() <= now,
      releasesAt:
        hold.releasedAt === null
          ? new Date(
              hold.reviewAt.getTime() +
                MODERATION_HOLD_RELEASE_GRACE_DAYS * DAY,
            )
          : null,
      createdAt: hold.createdAt,
      releasedAt: hold.releasedAt,
      releasedBy: personOf(hold.releasedByUserId, names),
      releaseReason: hold.releaseReason,
    }));
  }
}

/**
 * Refuses a review date that has passed or is further ahead than a hold may
 * run without review.
 *
 * @param reviewAt - The date.
 * @throws BadRequestException when it is.
 */
function assertReviewable(reviewAt: Date): void {
  const now = Date.now();

  if (
    reviewAt.getTime() <= now ||
    reviewAt.getTime() > now + MODERATION_HOLD_REVIEW_DAYS * DAY
  ) {
    throw new BadRequestException(
      `A hold is reviewed within ${MODERATION_HOLD_REVIEW_DAYS} days.`,
    );
  }
}

/** What the hold ledger needs to know of a hold. */
type HeldAs = Pick<
  ModerationHoldEntity,
  'id' | 'kind' | 'chatReportId' | 'subjectUserId' | 'ownerUserId' | 'reviewAt'
>;

/**
 * Logs what was done to a hold. A placing, an extension or a release is
 * written to the hold ledger first, under the log entry's own ID (FC-042);
 * should the transaction then fail, the next boot brings the event back,
 * which errs towards keeping evidence.
 *
 * @param manager - The transaction.
 * @param ledger - The hold ledger.
 * @param hold - The hold, as it is after the event.
 * @param action - What.
 * @param entry - Who, why and anything else.
 * @param entry.actorUserId - Who, or null for the system.
 * @param entry.reason - Why, or for a reading, its purpose.
 * @param entry.detail - Anything else.
 * @param entry.idempotencyKey - For what the system writes, the key that
 *   keeps a retried run from writing it twice (FC-039).
 */
async function log(
  manager: EntityManager,
  ledger: HoldLedgerService,
  hold: HeldAs,
  action: ModerationHoldActionKind,
  entry: {
    readonly actorUserId: string | null;
    readonly reason: string;
    readonly detail?: Record<string, unknown>;
    readonly idempotencyKey?: string;
  },
): Promise<void> {
  const id = randomUUID();

  if (LEDGERED_HOLD_ACTIONS.includes(action)) {
    await ledger.write({
      actionId: id,
      holdId: hold.id,
      kind: action,
      holdKind: hold.kind,
      chatReportId: hold.chatReportId,
      subjectUserId: hold.subjectUserId,
      ownerUserId: hold.ownerUserId,
      reviewAt: hold.reviewAt.toISOString(),
      createdAt: new Date().toISOString(),
    });
  }

  await manager
    .createQueryBuilder()
    .insert()
    .into(ModerationHoldActionEntity)
    .values({
      id,
      holdId: hold.id,
      action,
      actorUserId: entry.actorUserId,
      reason: entry.reason,
      detail: (entry.detail ?? null) as never,
      idempotencyKey: entry.idempotencyKey ?? null,
    })
    .orIgnore()
    .execute();
}

/**
 * Somebody named here.
 *
 * @param userId - Their account, if it remains.
 * @param names - Usernames.
 * @returns Them, or null.
 */
function personOf(
  userId: string | null,
  names: ReadonlyMap<string, string>,
): ChatPersonDto | null {
  return userId === null
    ? null
    : { userId, username: names.get(userId) ?? null };
}

/**
 * Where messages or reports were: a channel with its scope, or a
 * conversation with the other side.
 *
 * @param manager - The manager to read through.
 * @param rows - The messages or reports.
 * @param viewpoint - Whose side a conversation is seen from, if anybody's.
 * @returns A function naming each row's place.
 */
async function placesOf(
  manager: EntityManager,
  rows: readonly Pick<ChatMessageEntity, 'channelId' | 'conversationId'>[],
  viewpoint?: string,
): Promise<
  (row: Pick<ChatMessageEntity, 'channelId' | 'conversationId'>) => {
    place: ChatReportPlaceDto;
    with: ChatPersonDto | null;
  }
> {
  const channelIds = [
    ...new Set(
      rows.map(row => row.channelId).filter((id): id is string => id !== null),
    ),
  ];
  const conversationIds = [
    ...new Set(
      rows
        .map(row => row.conversationId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const channels =
    channelIds.length === 0
      ? []
      : await manager.find(ChatChannelEntity, {
          where: { id: In(channelIds) },
        });
  const conversations =
    conversationIds.length === 0
      ? []
      : await manager.find(ChatDirectConversationEntity, {
          where: { id: In(conversationIds) },
        });
  const places = new Map<string, ChatReportPlaceDto>();

  for (const channel of channels) {
    const scope = await scopePlaceOf(manager, channel);

    places.set(channel.id, {
      kind: 'CHANNEL',
      channelId: channel.id,
      channelName: channel.name,
      scopeKind: scope?.kind ?? null,
      scopeName: scope?.name ?? null,
      conversationId: null,
    });
  }

  const otherOf = new Map(
    conversations.map(conversation => [
      conversation.id,
      conversation.userLowId === viewpoint
        ? conversation.userHighId
        : conversation.userLowId,
    ]),
  );
  const names = await usernamesFor(manager, [...otherOf.values()]);

  return row => {
    if (row.channelId !== null) {
      return {
        place: places.get(row.channelId) ?? {
          kind: 'CHANNEL',
          channelId: row.channelId,
          channelName: null,
          scopeKind: null,
          scopeName: null,
          conversationId: null,
        },
        with: null,
      };
    }

    const other =
      viewpoint === undefined
        ? undefined
        : otherOf.get(row.conversationId as string);

    return {
      place: {
        kind: 'DIRECT',
        channelId: null,
        channelName: null,
        scopeKind: null,
        scopeName: null,
        conversationId: row.conversationId,
      },
      with: other === undefined ? null : personOf(other, names),
    };
  };
}

/**
 * What a hold keeps, in a notice's words. Nobody is named: a notice can be
 * read by anyone at the admin's screen.
 *
 * @param hold - The hold.
 * @returns The words.
 */
function whatOf(hold: ModerationHoldEntity): string {
  return hold.kind === ModerationHoldKind.CHAT_REPORT
    ? 'a chat report’s evidence'
    : 'a member’s chat messages';
}
