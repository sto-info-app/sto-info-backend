import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  In,
  IsNull,
  LessThan,
  MoreThanOrEqual,
  Not,
  QueryFailedError,
} from 'typeorm';

import { SiteAdminActionKind } from 'src/audit/site-admin/site-admin-action.enum';
import { recordSiteAdminAction } from 'src/audit/site-admin/site-admin-action.utility';
import { UserReportEntity } from 'src/moderation/entities/user-report.entity';
import { ReportStatus } from 'src/moderation/enums/report-status.enum';

import { usernamesFor } from '../../recruitment/utilities/recruitment-names.utility';
import { purgeInBatches } from '../../retention/purge-in-batches.utility';
import { RetentionOutcome } from '../../retention/retention-run.service';
import { scopePlaceOf } from '../../utilities/scope-place.utility';
import {
  CHAT_REPORT_CLOSED,
  ChatReportDecisionDto,
  ChatReportDetailDto,
  ChatReportDto,
  ChatReportPageDto,
  ChatReportPlaceDto,
  ChatReportRemovalDto,
  ChatReportsQueryDto,
  ChatReportSummaryDto,
} from '../dto/chat-report.dto';
import { ChatPersonDto } from '../dto/chat.dto';
import { ChatActionEntity } from '../entities/chat-action.entity';
import { ChatChannelEntity } from '../entities/chat-channel.entity';
import { ChatDirectConversationEntity } from '../entities/chat-direct-conversation.entity';
import { ChatMessageReportEntity } from '../entities/chat-message-report.entity';
import { ChatMessageEntity } from '../entities/chat-message.entity';
import { ChatReportEvidenceEntity } from '../entities/chat-report-evidence.entity';
import { ChatActionKind } from '../enums/chat.enums';
import { heldReports, holdOnReport } from '../holds/moderation-hold.utility';
import { ChatDeliveryService } from '../realtime/chat-delivery.service';
import { ChatMessageService } from '../services/chat-message.service';

/** How many messages before the reported one are held with it. */
export const CHAT_REPORT_EVIDENCE_BEFORE = 20;

/** How long a closed report and its evidence are kept, in days. */
export const CHAT_REPORT_RETENTION_DAYS = 90;

/** A page of the admin queue, unless asked otherwise. */
const DEFAULT_PAGE_SIZE = 20;

/** One day, in milliseconds. */
const DAY = 86_400_000;

/** The statuses a report is still open in. */
const OPEN = [ReportStatus.OPEN, ReportStatus.UNDER_REVIEW];

/**
 * Reports of chat messages, and the site admins' queue of them (FC-035).
 *
 * R28 and Steve's decisions of 28 and 29 September 2026:
 *
 * - A reader holding `content.report` where the message is — members, by
 *   default — reports it with one of the member reports' reasons, and either
 *   side of a conversation may. Once per person per message. The reporter is
 *   thanked and never told the outcome.
 * - The message and the twenty before it are copied as evidence when
 *   reported, so they outlive the ordinary purge. A message already deleted
 *   is held without its text: deleted text is kept only when the report came
 *   first.
 * - Only the site's admins see reports. They resolve or dismiss one with a
 *   note, and may remove the message, which is logged and leaves the evidence
 *   as it was.
 * - A closed report and its evidence go 90 days after it closed.
 */
@Injectable()
export class ChatReportService {
  private readonly _logger = new Logger(ChatReportService.name);

  /**
   * Creates an instance of ChatReportService.
   *
   * @param _dataSource - The database.
   * @param _messages - Finds a channel somebody may read, and the window.
   * @param _delivery - Tells readers a message was removed.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _messages: ChatMessageService,
    private readonly _delivery: ChatDeliveryService,
  ) {}

  /**
   * Reports a message.
   *
   * @param messageId - The message.
   * @param userId - The reporter.
   * @param dto - Why.
   * @throws NotFoundException when it is older, or not theirs to read.
   * @throws ForbiddenException when they may read but not report there.
   * @throws BadRequestException when it is their own, or deleted.
   * @throws ConflictException when they have reported it already.
   */
  async report(
    messageId: string,
    userId: string,
    dto: ChatReportDto,
  ): Promise<void> {
    const manager = this._dataSource.manager;
    const message = await manager.findOne(ChatMessageEntity, {
      where: {
        id: messageId,
        createdAt: MoreThanOrEqual(this._messages.windowStart()),
      },
    });

    if (message === null) {
      throw new NotFoundException('Not found');
    }

    await this.assertMayReport(manager, message, userId);

    if (message.authorUserId === userId) {
      throw new BadRequestException('You can’t report your own message.');
    }

    if (message.deletedAt !== null) {
      throw new BadRequestException('That message has been deleted.');
    }

    try {
      await this._dataSource.transaction(async transaction => {
        const report = await transaction.save(ChatMessageReportEntity, {
          messageId: message.id,
          channelId: message.channelId,
          conversationId: message.conversationId,
          reporterUserId: userId,
          authorUserId: message.authorUserId,
          reason: dto.reason,
          details: dto.details || null,
        });

        await this.hold(transaction, report, message);
      });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string } | undefined)?.code === '23505'
      ) {
        throw new ConflictException('You have already reported this message.');
      }

      throw error;
    }

    this._logger.log(
      `[report] Chat message reported - MessageId: ${messageId}, ` +
        `Reason: ${dto.reason}`,
    );
  }

  /**
   * A page of the admin queue, oldest first.
   *
   * @param query - The filters and the page.
   * @returns The page, and how many are open across the queue.
   */
  async list(query: ChatReportsQueryDto): Promise<ChatReportPageDto> {
    const manager = this._dataSource.manager;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const where: FindOptionsWhere<ChatMessageReportEntity> = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.reason ? { reason: query.reason } : {}),
    };
    const [reports, total] = await manager.findAndCount(
      ChatMessageReportEntity,
      {
        where,
        order: { createdAt: 'ASC', id: 'ASC' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      },
    );

    return {
      items: await this.toSummaries(reports),
      total,
      page,
      pageSize,
      openCount: await manager.count(ChatMessageReportEntity, {
        where: { status: In(OPEN) },
      }),
    };
  }

  /**
   * One report, with its evidence.
   *
   * @param reportId - The report.
   * @returns It.
   * @throws NotFoundException when there is none.
   */
  async detail(reportId: string): Promise<ChatReportDetailDto> {
    const manager = this._dataSource.manager;
    const report = await this.required(reportId);
    const evidence = await manager.find(ChatReportEvidenceEntity, {
      where: { reportId },
      order: { position: 'DESC' },
    });
    const message = await manager.findOne(ChatMessageEntity, {
      where: { id: report.messageId },
      select: { id: true, deletedAt: true },
    });
    const resolver = (
      await usernamesFor(manager, [report.resolvedByUserId])
    ).get(report.resolvedByUserId as string);

    return {
      ...(await this.toSummaries([report]))[0],
      evidence: evidence.map(held => ({
        position: held.position,
        messageId: held.messageId,
        author: personOf(held.authorUserId, held.authorUsername),
        body: held.body,
        deleted: held.deleted,
        sentAt: held.sentAt,
      })),
      messageRemoved: message === null || message.deletedAt !== null,
      resolutionNote: report.resolutionNote,
      resolvedBy: personOf(report.resolvedByUserId, resolver ?? null),
      resolvedAt: report.resolvedAt,
      holdId: (await holdOnReport(manager, reportId))?.id ?? null,
    };
  }

  /**
   * Closes a report: resolved or dismissed, with a note. The reporter is not
   * told.
   *
   * @param reportId - The report.
   * @param adminId - The admin.
   * @param dto - The outcome and the note.
   * @returns The report.
   * @throws NotFoundException when there is none.
   * @throws ConflictException when it is closed already.
   */
  async decide(
    reportId: string,
    adminId: string,
    dto: ChatReportDecisionDto,
  ): Promise<ChatReportDetailDto> {
    const report = await this.required(reportId);

    if (
      (CHAT_REPORT_CLOSED as readonly ReportStatus[]).includes(report.status)
    ) {
      throw new ConflictException('This report is already closed.');
    }

    // Read before the change, so the log says what it was.
    const from = report.status;

    await this._dataSource.transaction(async manager => {
      await manager.update(
        ChatMessageReportEntity,
        { id: reportId },
        {
          status: dto.status,
          resolutionNote: dto.note,
          resolvedByUserId: adminId,
          resolvedAt: new Date(),
        },
      );
      await recordSiteAdminAction(manager, {
        action: SiteAdminActionKind.CHAT_REPORT_DECIDED,
        actorUserId: adminId,
        targetUserId: report.authorUserId,
        subject: { kind: 'CHAT_REPORT', id: reportId },
        reason: dto.note,
        detail: { from, to: dto.status },
      });
    });

    return this.detail(reportId);
  }

  /**
   * Removes a reported message, logged. Its evidence stays as it was.
   *
   * @param reportId - The report.
   * @param adminId - The admin.
   * @param dto - Why.
   * @returns The report.
   * @throws NotFoundException when there is none.
   * @throws ConflictException when the message is already gone.
   */
  async removeMessage(
    reportId: string,
    adminId: string,
    dto: ChatReportRemovalDto,
  ): Promise<ChatReportDetailDto> {
    const report = await this.required(reportId);
    const message = await this._dataSource.manager.findOne(ChatMessageEntity, {
      where: { id: report.messageId },
    });

    if (message === null || message.deletedAt !== null) {
      throw new ConflictException('That message is already gone.');
    }

    await this._dataSource.transaction(async manager => {
      await manager.update(
        ChatMessageEntity,
        { id: message.id },
        { deletedAt: new Date(), deletedByUserId: adminId },
      );
      await manager.save(ChatActionEntity, {
        channelId: message.channelId,
        messageId: message.id,
        action: ChatActionKind.MESSAGE_REMOVED,
        actorUserId: adminId,
        reason: dto.reason,
        detail: { authorUserId: message.authorUserId, reportId },
      });
    });

    void this._delivery.publish({
      kind: 'deleted',
      place:
        message.channelId === null
          ? { conversationId: message.conversationId as string }
          : { channelId: message.channelId },
      messageId: message.id,
    });

    return this.detail(reportId);
  }

  /**
   * Forgets reports closed more than 90 days ago, and their evidence with
   * them, but for those a site admin holds (FC-036), a batch at a time
   * (FC-037). Daily, by the Fleet's retention schedule.
   *
   * @returns How many were forgotten, and whether that was all that is due.
   */
  async purge(): Promise<RetentionOutcome> {
    const manager = this._dataSource.manager;
    const cutOff = new Date(Date.now() - CHAT_REPORT_RETENTION_DAYS * DAY);
    const held = await heldReports(manager);
    const tally = await purgeInBatches(manager, ChatMessageReportEntity, {
      status: In([...CHAT_REPORT_CLOSED]),
      resolvedAt: LessThan(cutOff),
      ...(held.length === 0 ? {} : { id: Not(In(held)) }),
    });

    return {
      counts: { reports: tally.deleted, held: held.length },
      complete: tally.complete,
    };
  }

  /**
   * Requires that somebody may report a message where it is.
   *
   * @param manager - The manager to read through.
   * @param message - The message.
   * @param userId - The reporter.
   * @throws NotFoundException when they may not read it.
   * @throws ForbiddenException when they may read but not report there.
   */
  private async assertMayReport(
    manager: EntityManager,
    message: ChatMessageEntity,
    userId: string,
  ): Promise<void> {
    if (message.channelId !== null) {
      const { standing } = await this._messages.readableChannel(
        message.channelId,
        userId,
      );

      if (!standing.mayReport) {
        throw new ForbiddenException('You may not report messages here.');
      }

      return;
    }

    // Either side of a conversation, even once it has closed: a block is the
    // likeliest reason to report, and closes it.
    const conversation = await manager.findOne(ChatDirectConversationEntity, {
      where: { id: message.conversationId as string },
    });

    if (
      conversation === null ||
      (conversation.userLowId !== userId && conversation.userHighId !== userId)
    ) {
      throw new NotFoundException('Not found');
    }
  }

  /**
   * Holds a reported message and the twenty before it.
   *
   * @param manager - The transaction.
   * @param report - The report.
   * @param message - The reported message.
   */
  private async hold(
    manager: EntityManager,
    report: ChatMessageReportEntity,
    message: ChatMessageEntity,
  ): Promise<void> {
    const place =
      message.channelId === null
        ? { conversationId: message.conversationId as string }
        : { channelId: message.channelId };
    const before = await manager.find(ChatMessageEntity, {
      where: [
        { ...place, createdAt: LessThan(message.createdAt) },
        { ...place, createdAt: message.createdAt, id: LessThan(message.id) },
      ],
      order: { createdAt: 'DESC', id: 'DESC' },
      take: CHAT_REPORT_EVIDENCE_BEFORE,
    });
    const held = [message, ...before];
    const names = await usernamesFor(
      manager,
      held.map(each => each.authorUserId),
    );

    await manager.save(
      ChatReportEvidenceEntity,
      held.map((each, position) => ({
        reportId: report.id,
        position,
        messageId: each.id,
        authorUserId: each.authorUserId,
        authorUsername:
          each.authorUserId === null
            ? null
            : (names.get(each.authorUserId) ?? null),
        body: each.deletedAt === null ? each.body : null,
        deleted: each.deletedAt !== null,
        sentAt: each.createdAt,
      })),
    );
  }

  /**
   * Finds a report.
   *
   * @param reportId - The report.
   * @returns It.
   * @throws NotFoundException when there is none.
   */
  private async required(reportId: string): Promise<ChatMessageReportEntity> {
    const report = await this._dataSource.manager.findOne(
      ChatMessageReportEntity,
      { where: { id: reportId } },
    );

    if (report === null) {
      throw new NotFoundException('Not found');
    }

    return report;
  }

  /**
   * Shows reports in the queue, with who and where.
   *
   * @param reports - The reports.
   * @returns Each.
   */
  private async toSummaries(
    reports: readonly ChatMessageReportEntity[],
  ): Promise<ChatReportSummaryDto[]> {
    const manager = this._dataSource.manager;
    const names = await usernamesFor(
      manager,
      reports.flatMap(report => [report.reporterUserId, report.authorUserId]),
    );
    const channelIds = [
      ...new Set(
        reports
          .map(report => report.channelId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const channels =
      channelIds.length === 0
        ? []
        : await manager.find(ChatChannelEntity, {
            where: { id: In(channelIds) },
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

    const named = (id: string | null): ChatPersonDto | null =>
      personOf(id, id === null ? null : (names.get(id) ?? null));
    const authors = [
      ...new Set(
        reports
          .map(report => report.authorUserId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const memberReports =
      authors.length === 0
        ? []
        : await manager.find(UserReportEntity, {
            where: {
              reportedId: In(authors),
              status: In(OPEN),
              deletedAt: IsNull(),
            },
            select: { id: true, reportedId: true },
          });
    const memberReportCount = new Map<string, number>();

    for (const report of memberReports) {
      memberReportCount.set(
        report.reportedId,
        (memberReportCount.get(report.reportedId) ?? 0) + 1,
      );
    }

    return reports.map(report => ({
      id: report.id,
      messageId: report.messageId,
      place:
        report.channelId === null
          ? {
              kind: 'DIRECT',
              channelId: null,
              channelName: null,
              scopeKind: null,
              scopeName: null,
              conversationId: report.conversationId,
            }
          : (places.get(report.channelId) ?? {
              // Its channel has gone with its scope.
              kind: 'CHANNEL',
              channelId: report.channelId,
              channelName: null,
              scopeKind: null,
              scopeName: null,
              conversationId: null,
            }),
      reporter: named(report.reporterUserId),
      author: named(report.authorUserId),
      reason: report.reason,
      details: report.details,
      status: report.status,
      createdAt: report.createdAt,
      openUserReportCount:
        report.authorUserId === null
          ? 0
          : (memberReportCount.get(report.authorUserId) ?? 0),
    }));
  }
}

/**
 * Somebody named in the queue.
 *
 * @param userId - Their account, if it remains.
 * @param username - Their username, if known.
 * @returns Them, or null when their account has gone.
 */
function personOf(
  userId: string | null,
  username: string | null,
): ChatPersonDto | null {
  return userId === null ? null : { userId, username };
}
