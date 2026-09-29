import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryFailedError } from 'typeorm';

import { SiteAdminActionEntity } from 'src/audit/site-admin/site-admin-action.entity';
import { SiteAdminActionKind } from 'src/audit/site-admin/site-admin-action.enum';
import { UserReportEntity } from 'src/moderation/entities/user-report.entity';
import { ReportReason } from 'src/moderation/enums/report-reason.enum';
import { ReportStatus } from 'src/moderation/enums/report-status.enum';

import {
  CHANNEL_ID,
  chatWorld,
  ChatWorld,
  FLEET_ID,
  FRIEND_ID,
  MEMBER,
  MEMBER_ID,
  MODERATOR,
  MODERATOR_ID,
  OFFICER_ID,
  seedChannel,
  seedMessage,
  STRANGER_ID,
} from '../../../../test/chat-world';
import { Row } from '../../../../test/in-memory-manager';
import { FLEET_CAPABILITIES } from '../../authorisation/fleet-capability.constants';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { ChatActionEntity } from '../entities/chat-action.entity';
import { ChatMessageReportEntity } from '../entities/chat-message-report.entity';
import { ChatMessageEntity } from '../entities/chat-message.entity';
import { ChatReportEvidenceEntity } from '../entities/chat-report-evidence.entity';
import { ChatActionKind } from '../enums/chat.enums';
import { ModerationHoldEntity } from '../holds/moderation-hold.entity';
import { ModerationHoldKind } from '../holds/moderation-hold.enums';
import { ChatDeliveryService } from '../realtime/chat-delivery.service';
import {
  CHAT_REPORT_EVIDENCE_BEFORE,
  ChatReportService,
} from './chat-report.service';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const REPORT_ID = '31000000-0000-4000-8000-0000000000e1';

/** A member who may report. */
const REPORTER = {
  ...MEMBER,
  capabilities: [
    ...(MEMBER.capabilities as string[]),
    FLEET_CAPABILITIES.CONTENT_REPORT,
  ],
};

/**
 * A message ID that sorts by its number.
 *
 * @param index - The number.
 * @returns The ID.
 */
const idOf = (index: number): string =>
  `31000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

/**
 * An instant some time ago.
 *
 * @param milliseconds - How long ago.
 * @returns It.
 */
const ago = (milliseconds: number): Date => new Date(Date.now() - milliseconds);

describe('ChatReportService', () => {
  let world: ChatWorld;
  let delivery: { publish: jest.Mock<(...args: any[]) => Promise<void>> };
  let service: ChatReportService;
  let table: <T>(entity: object) => T[];

  beforeEach(() => {
    world = chatWorld();
    table = <T>(entity: object) =>
      world.db.rows<Row>(entity as never) as unknown as T[];
    seedChannel(world.db);
    world.stand(MEMBER_ID, FLEET_ID, REPORTER);
    world.stand(MODERATOR_ID, FLEET_ID, MODERATOR);
    world.stand(OFFICER_ID, FLEET_ID, MEMBER);
    delivery = { publish: jest.fn(() => Promise.resolve()) };
    service = new ChatReportService(
      world.db.asDataSource(),
      world.messages,
      delivery as unknown as ChatDeliveryService,
    );
  });

  /**
   * Seeds a report.
   *
   * @param overrides - What differs.
   * @returns The row.
   */
  const seedReport = (overrides: Partial<ChatMessageReportEntity> = {}) => {
    const row = {
      id: REPORT_ID,
      messageId: idOf(1),
      channelId: CHANNEL_ID,
      conversationId: null,
      reporterUserId: MEMBER_ID,
      authorUserId: MODERATOR_ID,
      reason: ReportReason.HARASSMENT,
      details: null,
      status: ReportStatus.OPEN,
      resolutionNote: null,
      resolvedByUserId: null,
      resolvedAt: null,
      createdAt: ago(MINUTE),
      ...overrides,
    } as ChatMessageReportEntity;

    world.db.seed(ChatMessageReportEntity, [row as unknown as Row]);

    return row;
  };

  describe('report', () => {
    it('hides a message they may not read, or older than the window', async () => {
      seedMessage(world.db, { id: idOf(1), authorUserId: MODERATOR_ID });
      seedMessage(world.db, {
        id: idOf(2),
        authorUserId: MODERATOR_ID,
        createdAt: ago(5 * 60 * MINUTE),
      });

      await expect(
        service.report(idOf(9), MEMBER_ID, { reason: ReportReason.SPAM }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.report(idOf(1), STRANGER_ID, { reason: ReportReason.SPAM }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.report(idOf(2), MEMBER_ID, { reason: ReportReason.SPAM }),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses a reader without content.report there', async () => {
      seedMessage(world.db, { id: idOf(1), authorUserId: MODERATOR_ID });

      await expect(
        service.report(idOf(1), OFFICER_ID, { reason: ReportReason.SPAM }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses their own message, and a deleted one', async () => {
      seedMessage(world.db, { id: idOf(1) });
      seedMessage(world.db, {
        id: idOf(2),
        authorUserId: MODERATOR_ID,
        deletedAt: new Date(),
      });

      await expect(
        service.report(idOf(1), MEMBER_ID, { reason: ReportReason.SPAM }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.report(idOf(2), MEMBER_ID, { reason: ReportReason.SPAM }),
      ).rejects.toThrow(
        new BadRequestException('That message has been deleted.'),
      );
    });

    it('holds the message and the twenty before it, as they were', async () => {
      const at = ago(60 * MINUTE);

      seedChannel(world.db, { id: 'other' });

      for (let index = 1; index <= 23; index += 1) {
        seedMessage(world.db, {
          id: idOf(index),
          createdAt: new Date(at.getTime() + index * 1000),
          authorUserId: index % 2 === 0 ? MODERATOR_ID : OFFICER_ID,
          body: `#${index}`,
          deletedAt: index === 10 ? new Date() : null,
        });
      }

      // The same instant as the reported one, before it by ID.
      seedMessage(world.db, {
        id: idOf(0),
        createdAt: new Date(at.getTime() + 22 * 1000),
        authorUserId: null,
        body: 'Tied',
      });
      seedMessage(world.db, {
        id: idOf(30),
        channelId: 'other',
        createdAt: new Date(at.getTime() + 21_500),
        body: 'Elsewhere',
      });

      await service.report(idOf(22), MEMBER_ID, {
        reason: ReportReason.HARASSMENT,
        details: 'Again and again',
      });

      const [report] = table<ChatMessageReportEntity>(ChatMessageReportEntity);

      expect(report).toEqual(
        expect.objectContaining({
          messageId: idOf(22),
          channelId: CHANNEL_ID,
          conversationId: null,
          reporterUserId: MEMBER_ID,
          authorUserId: MODERATOR_ID,
          reason: ReportReason.HARASSMENT,
          details: 'Again and again',
        }),
      );

      const evidence = table<ChatReportEvidenceEntity>(
        ChatReportEvidenceEntity,
      ).sort((a, b) => a.position - b.position);

      expect(evidence).toHaveLength(CHAT_REPORT_EVIDENCE_BEFORE + 1);
      expect(evidence.map(held => held.messageId).slice(0, 3)).toEqual([
        idOf(22),
        idOf(0),
        idOf(21),
      ]);
      expect(evidence[0]).toEqual(
        expect.objectContaining({
          reportId: report.id,
          position: 0,
          authorUserId: MODERATOR_ID,
          authorUsername: 'Moderator',
          body: '#22',
          deleted: false,
        }),
      );
      expect(evidence[1]).toEqual(
        expect.objectContaining({ authorUserId: null, authorUsername: null }),
      );
      expect(evidence.find(held => held.messageId === idOf(21))).toEqual(
        expect.objectContaining({
          authorUserId: OFFICER_ID,
          authorUsername: null,
        }),
      );
      expect(evidence.find(held => held.messageId === idOf(10))).toEqual(
        expect.objectContaining({ body: null, deleted: true }),
      );
      expect(evidence.map(held => held.messageId)).not.toContain(idOf(30));
      expect(evidence.map(held => held.messageId)).not.toContain(idOf(2));
    });

    it('records no details when none are given', async () => {
      seedMessage(world.db, { id: idOf(1), authorUserId: MODERATOR_ID });

      await service.report(idOf(1), MEMBER_ID, { reason: ReportReason.SPAM });

      expect(
        table<ChatMessageReportEntity>(ChatMessageReportEntity)[0].details,
      ).toBeNull();
    });

    it('takes a report from either side of a conversation, even once closed', async () => {
      world.befriend(MEMBER_ID, FRIEND_ID);

      const { id } = await world.direct.open(MEMBER_ID, FRIEND_ID);

      seedMessage(world.db, {
        id: idOf(1),
        channelId: null,
        conversationId: id,
        authorUserId: FRIEND_ID,
      });
      world.block(MEMBER_ID, FRIEND_ID);

      await service.report(idOf(1), MEMBER_ID, { reason: ReportReason.SPAM });

      expect(table<ChatMessageReportEntity>(ChatMessageReportEntity)).toEqual([
        expect.objectContaining({ channelId: null, conversationId: id }),
      ]);
      await expect(
        service.report(idOf(1), STRANGER_ID, { reason: ReportReason.SPAM }),
      ).rejects.toThrow(NotFoundException);

      table<ChatMessageEntity>(ChatMessageEntity)[0].conversationId = 'gone';

      await expect(
        service.report(idOf(1), FRIEND_ID, { reason: ReportReason.SPAM }),
      ).rejects.toThrow(NotFoundException);
    });

    it('takes one report a person, and passes on other failures', async () => {
      seedMessage(world.db, { id: idOf(1), authorUserId: MODERATOR_ID });

      const save = world.db.save;
      const clash = Object.assign(
        new QueryFailedError('INSERT', [], new Error('duplicate')),
        { driverError: { code: '23505' } },
      );

      world.db.save = jest.fn(() => Promise.reject(clash)) as never;

      await expect(
        service.report(idOf(1), MEMBER_ID, { reason: ReportReason.SPAM }),
      ).rejects.toThrow(ConflictException);

      world.db.save = jest.fn(() =>
        Promise.reject(new QueryFailedError('INSERT', [], new Error('other'))),
      ) as never;

      await expect(
        service.report(idOf(1), MEMBER_ID, { reason: ReportReason.SPAM }),
      ).rejects.toThrow(QueryFailedError);

      world.db.save = jest.fn(() => Promise.reject(new Error('down'))) as never;

      await expect(
        service.report(idOf(1), MEMBER_ID, { reason: ReportReason.SPAM }),
      ).rejects.toThrow('down');

      world.db.save = save;
    });
  });

  describe('list', () => {
    it('pages the queue oldest first, filtered, with who and where', async () => {
      seedReport({ id: 'a', createdAt: ago(3 * MINUTE) });
      seedReport({
        id: 'b',
        createdAt: ago(2 * MINUTE),
        channelId: null,
        conversationId: 'conversation',
        reason: ReportReason.SPAM,
      });
      seedReport({
        id: 'c',
        createdAt: ago(MINUTE),
        status: ReportStatus.DISMISSED,
        reporterUserId: null,
        authorUserId: OFFICER_ID,
      });
      seedReport({ id: 'd', channelId: 'missing' });

      const everything = await service.list({});

      expect(everything.total).toBe(4);
      expect(everything.openCount).toBe(3);
      expect(everything.page).toBe(1);
      expect(everything.pageSize).toBe(20);
      expect(everything.items.map(item => item.id)).toEqual([
        'a',
        'b',
        'c',
        'd',
      ]);
      expect(everything.items[0]).toEqual(
        expect.objectContaining({
          place: {
            kind: 'CHANNEL',
            channelId: CHANNEL_ID,
            channelName: 'General',
            scopeKind: FleetScopeKind.FLEET,
            scopeName: 'Fixture Fleet',
            conversationId: null,
          },
          reporter: { userId: MEMBER_ID, username: 'Member' },
          author: { userId: MODERATOR_ID, username: 'Moderator' },
        }),
      );
      expect(everything.items[1].place).toEqual({
        kind: 'DIRECT',
        channelId: null,
        channelName: null,
        scopeKind: null,
        scopeName: null,
        conversationId: 'conversation',
      });
      expect(everything.items[2]).toEqual(
        expect.objectContaining({
          reporter: null,
          author: { userId: OFFICER_ID, username: null },
        }),
      );
      expect(everything.items[3].place).toEqual(
        expect.objectContaining({ channelId: 'missing', channelName: null }),
      );

      const filtered = await service.list({
        status: ReportStatus.OPEN,
        reason: ReportReason.SPAM,
        page: 1,
        pageSize: 5,
      });

      expect(filtered.items.map(item => item.id)).toEqual(['b']);
    });

    it('names no scope that has gone', async () => {
      seedReport();
      world.db.rows(StoFleetEntity).splice(0);

      const { items } = await service.list({});

      expect(items[0].place).toEqual(
        expect.objectContaining({
          channelName: 'General',
          scopeKind: null,
          scopeName: null,
        }),
      );
    });

    it('lists an empty queue', async () => {
      await expect(service.list({ page: 2 })).resolves.toEqual({
        items: [],
        total: 0,
        page: 2,
        pageSize: 20,
        openCount: 0,
      });
    });
  });

  describe('detail', () => {
    it('hides a report that does not exist', async () => {
      await expect(service.detail(REPORT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('shows the evidence oldest first, and whether the message remains', async () => {
      seedReport();
      seedMessage(world.db, { id: idOf(1), authorUserId: MODERATOR_ID });
      world.db.seed(ChatReportEvidenceEntity, [
        {
          reportId: REPORT_ID,
          position: 0,
          messageId: idOf(1),
          authorUserId: MODERATOR_ID,
          authorUsername: 'Moderator',
          body: 'Reported',
          deleted: false,
          sentAt: ago(MINUTE),
        },
        {
          reportId: REPORT_ID,
          position: 1,
          messageId: idOf(0),
          authorUserId: null,
          authorUsername: null,
          body: null,
          deleted: true,
          sentAt: ago(2 * MINUTE),
        },
      ]);

      const report = await service.detail(REPORT_ID);

      expect(report.evidence).toEqual([
        {
          position: 1,
          messageId: idOf(0),
          author: null,
          body: null,
          deleted: true,
          sentAt: expect.any(Date),
        },
        {
          position: 0,
          messageId: idOf(1),
          author: { userId: MODERATOR_ID, username: 'Moderator' },
          body: 'Reported',
          deleted: false,
          sentAt: expect.any(Date),
        },
      ]);
      expect(report.messageRemoved).toBe(false);
      expect(report.resolvedBy).toBeNull();

      table<ChatMessageEntity>(ChatMessageEntity)[0].deletedAt = new Date();

      await expect(service.detail(REPORT_ID)).resolves.toEqual(
        expect.objectContaining({ messageRemoved: true }),
      );

      world.db.rows(ChatMessageEntity).splice(0);

      await expect(service.detail(REPORT_ID)).resolves.toEqual(
        expect.objectContaining({ messageRemoved: true }),
      );
    });
  });

  describe('decide', () => {
    it('closes an open report with a note, once', async () => {
      seedReport();

      const report = await service.decide(REPORT_ID, MODERATOR_ID, {
        status: ReportStatus.ACTIONED,
        note: 'Warned them',
      });

      expect(report).toEqual(
        expect.objectContaining({
          status: ReportStatus.ACTIONED,
          resolutionNote: 'Warned them',
          resolvedBy: { userId: MODERATOR_ID, username: 'Moderator' },
          resolvedAt: expect.any(Date),
        }),
      );
      await expect(
        service.decide(REPORT_ID, MODERATOR_ID, {
          status: ReportStatus.DISMISSED,
          note: 'Again',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('logs the decision with its note, and names a resolver without a username (FC-039)', async () => {
      seedReport({ status: ReportStatus.UNDER_REVIEW });

      const report = await service.decide(REPORT_ID, OFFICER_ID, {
        status: ReportStatus.DISMISSED,
        note: 'Not harassment',
      });

      expect(report.resolvedBy).toEqual({ userId: OFFICER_ID, username: null });
      expect(table(SiteAdminActionEntity)).toEqual([
        expect.objectContaining({
          action: SiteAdminActionKind.CHAT_REPORT_DECIDED,
          actorUserId: OFFICER_ID,
          targetUserId: MODERATOR_ID,
          subjectKind: 'CHAT_REPORT',
          subjectId: REPORT_ID,
          reason: 'Not harassment',
          detail: {
            from: ReportStatus.UNDER_REVIEW,
            to: ReportStatus.DISMISSED,
          },
        }),
      ]);
    });
  });

  describe('removeMessage', () => {
    it('removes a channel message, logged and told, keeping the evidence', async () => {
      seedReport();
      seedMessage(world.db, { id: idOf(1), authorUserId: MODERATOR_ID });

      const report = await service.removeMessage(REPORT_ID, OFFICER_ID, {
        reason: 'Harassment',
      });

      expect(report.messageRemoved).toBe(true);
      expect(table<ChatMessageEntity>(ChatMessageEntity)[0]).toEqual(
        expect.objectContaining({ deletedByUserId: OFFICER_ID }),
      );
      expect(table<ChatActionEntity>(ChatActionEntity)).toEqual([
        expect.objectContaining({
          channelId: CHANNEL_ID,
          messageId: idOf(1),
          action: ChatActionKind.MESSAGE_REMOVED,
          actorUserId: OFFICER_ID,
          reason: 'Harassment',
          detail: { authorUserId: MODERATOR_ID, reportId: REPORT_ID },
        }),
      ]);
      expect(delivery.publish).toHaveBeenCalledWith({
        kind: 'deleted',
        place: { channelId: CHANNEL_ID },
        messageId: idOf(1),
      });
    });

    it('removes a direct message, told to its conversation', async () => {
      seedReport({ channelId: null, conversationId: 'conversation' });
      seedMessage(world.db, {
        id: idOf(1),
        channelId: null,
        conversationId: 'conversation',
      });

      await service.removeMessage(REPORT_ID, OFFICER_ID, { reason: 'Spam' });

      expect(delivery.publish).toHaveBeenCalledWith(
        expect.objectContaining({ place: { conversationId: 'conversation' } }),
      );
    });

    it('refuses a message already gone', async () => {
      seedReport();

      await expect(
        service.removeMessage(REPORT_ID, OFFICER_ID, { reason: 'Spam' }),
      ).rejects.toThrow(ConflictException);

      seedMessage(world.db, { id: idOf(1), deletedAt: new Date() });

      await expect(
        service.removeMessage(REPORT_ID, OFFICER_ID, { reason: 'Spam' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('purge', () => {
    it('forgets reports closed more than 90 days ago', async () => {
      seedReport({
        id: 'old',
        status: ReportStatus.DISMISSED,
        resolvedAt: ago(91 * DAY),
      });
      seedReport({
        id: 'recent',
        status: ReportStatus.ACTIONED,
        resolvedAt: ago(89 * DAY),
      });
      seedReport({ id: 'open', createdAt: ago(200 * DAY) });

      await expect(service.purge()).resolves.toEqual({
        counts: { reports: 1, held: 0 },
        complete: true,
      });
      expect(
        table<ChatMessageReportEntity>(ChatMessageReportEntity).map(
          report => report.id,
        ),
      ).toEqual(['recent', 'open']);
    });

    it('keeps a report a site admin holds, until released (FC-036)', async () => {
      seedReport({
        id: 'held',
        status: ReportStatus.DISMISSED,
        resolvedAt: ago(91 * DAY),
      });
      seedReport({
        id: 'old',
        status: ReportStatus.DISMISSED,
        resolvedAt: ago(91 * DAY),
      });
      world.db.seed(ModerationHoldEntity, [
        {
          id: 'hold-1',
          kind: ModerationHoldKind.CHAT_REPORT,
          chatReportId: 'held',
          releasedAt: null,
        },
      ]);

      await expect(service.purge()).resolves.toEqual({
        counts: { reports: 1, held: 1 },
        complete: true,
      });
      expect(
        table<ChatMessageReportEntity>(ChatMessageReportEntity).map(
          report => report.id,
        ),
      ).toEqual(['held']);
      await expect(service.detail('held')).resolves.toEqual(
        expect.objectContaining({ holdId: 'hold-1' }),
      );
    });
  });

  describe('linked queues (FC-036)', () => {
    it('counts the open member reports about each author', async () => {
      seedReport({ id: 'a' });
      seedReport({ id: 'b', authorUserId: null });
      world.db.seed(UserReportEntity, [
        {
          reportedId: MODERATOR_ID,
          status: ReportStatus.OPEN,
          deletedAt: null,
        },
        {
          reportedId: MODERATOR_ID,
          status: ReportStatus.UNDER_REVIEW,
          deletedAt: null,
        },
        {
          reportedId: MODERATOR_ID,
          status: ReportStatus.DISMISSED,
          deletedAt: null,
        },
        {
          reportedId: MODERATOR_ID,
          status: ReportStatus.OPEN,
          deletedAt: new Date(),
        },
      ]);

      const { items } = await service.list({});

      expect(items.map(item => item.openUserReportCount)).toEqual([2, 0]);
    });

    it('counts none when no author has any', async () => {
      seedReport({ id: 'a' });

      const { items } = await service.list({});

      expect(items[0].openUserReportCount).toBe(0);
      await expect(service.detail(REPORT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
