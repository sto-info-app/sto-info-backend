import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryFailedError } from 'typeorm';

import { ReportReason } from 'src/moderation/enums/report-reason.enum';
import { ReportStatus } from 'src/moderation/enums/report-status.enum';
import { NotificationService } from 'src/notification/notification.service';
import { UserEntity } from 'src/user/entities/user.entity';
import { UserRole } from 'src/user/enums/user-role.enum';

import {
  CHANNEL_ID,
  chatWorld,
  ChatWorld,
  FRIEND_ID,
  MEMBER_ID,
  MODERATOR_ID,
  OFFICER_ID,
  seedChannel,
  seedMessage,
} from '../../../../test/chat-world';
import { Row } from '../../../../test/in-memory-manager';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { ChatDirectConversationEntity } from '../entities/chat-direct-conversation.entity';
import { ChatMessageReportEntity } from '../entities/chat-message-report.entity';
import { ChatReportEvidenceEntity } from '../entities/chat-report-evidence.entity';
import { cursorOf } from '../services/chat-message.service';
import { HoldLedgerService, HoldMarker } from './hold-ledger.service';
import { ModerationHoldActionEntity } from './moderation-hold-action.entity';
import { ModerationHoldEntity } from './moderation-hold.entity';
import {
  ModerationHoldActionKind,
  ModerationHoldKind,
} from './moderation-hold.enums';
import {
  HELD_MESSAGE_PAGE_SIZE,
  MODERATION_HOLD_REVIEW_DAYS,
  ModerationHoldService,
} from './moderation-hold.service';
import {
  heldAuthors,
  heldReports,
  holdOnReport,
} from './moderation-hold.utility';

const DAY = 86_400_000;
const ADMIN_ID = '31000000-0000-4000-8000-0000000000a1';
const REPORT_ID = '31000000-0000-4000-8000-0000000000e1';

/**
 * A message ID that sorts by its number.
 *
 * @param index - The number.
 * @returns The ID.
 */
const idOf = (index: number): string =>
  `31000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

describe('ModerationHoldService', () => {
  let world: ChatWorld;
  let service: ModerationHoldService;
  let table: <T>(entity: object) => T[];
  let notifications: {
    createNotification: jest.Mock<(input: object) => Promise<unknown>>;
  };
  let ledger: { write: jest.Mock<(marker: HoldMarker) => Promise<void>> };
  /** What the hold ledger was given, in order. */
  let marks: HoldMarker[];

  beforeEach(() => {
    world = chatWorld();
    table = <T>(entity: object) =>
      world.db.rows<Row>(entity as never) as unknown as T[];
    seedChannel(world.db);
    world.db
      .defaults(ModerationHoldEntity, { releasedAt: null })
      .seed(UserEntity, [{ id: MEMBER_ID }])
      .seed(ChatMessageReportEntity, [
        {
          id: REPORT_ID,
          messageId: idOf(1),
          channelId: CHANNEL_ID,
          conversationId: null,
          reporterUserId: FRIEND_ID,
          authorUserId: MEMBER_ID,
          reason: ReportReason.SPAM,
          status: ReportStatus.OPEN,
        },
      ]);
    notifications = { createNotification: jest.fn(async () => ({})) };
    marks = [];
    ledger = {
      write: jest.fn(async (marker: HoldMarker) => {
        marks.push(marker);
      }),
    };
    service = new ModerationHoldService(
      world.db.asDataSource(),
      notifications as unknown as NotificationService,
      ledger as unknown as HoldLedgerService,
    );
  });

  /** Stamps rows as the database would. */
  const stamping = () => {
    const save = world.db.save;
    let tick = 0;

    world.db.save = ((entity: never, row: Row | Row[]) => {
      for (const each of Array.isArray(row) ? row : [row]) {
        each.createdAt ??= new Date(Date.now() + tick++);
        each.releasedAt ??= null;
        each.releasedByUserId ??= null;
        each.releaseReason ??= null;
      }

      return save(entity, row);
    }) as typeof world.db.save;

    // The log's entries go in through the query builder (FC-039).
    const builderOf = world.db.createQueryBuilder;

    world.db.createQueryBuilder = () => {
      const builder = builderOf();
      const values = builder.values;

      builder.values = (rows: Row | Row[]) => {
        for (const each of Array.isArray(rows) ? rows : [rows]) {
          each.createdAt ??= new Date(Date.now() + tick++);
        }

        return values(rows);
      };

      return builder;
    };
  };

  /**
   * Places a hold on the member's messages.
   *
   * @returns It.
   */
  const holdMember = () =>
    service.place(ADMIN_ID, {
      kind: ModerationHoldKind.MEMBER_MESSAGES,
      subjectUserId: MEMBER_ID,
      reason: 'Harassment case',
    });

  describe('place', () => {
    beforeEach(stamping);

    it('holds a member’s messages for 180 days by default, logged', async () => {
      const hold = await holdMember();

      expect(hold).toEqual(
        expect.objectContaining({
          kind: ModerationHoldKind.MEMBER_MESSAGES,
          chatReportId: null,
          subject: { userId: MEMBER_ID, username: 'Member' },
          owner: { userId: ADMIN_ID, username: null },
          reason: 'Harassment case',
          reviewDue: false,
          releasedAt: null,
          releasedBy: null,
        }),
      );
      expect(Math.round((hold.reviewAt.getTime() - Date.now()) / DAY)).toBe(
        MODERATION_HOLD_REVIEW_DAYS,
      );
      expect(hold.actions).toEqual([
        expect.objectContaining({
          action: ModerationHoldActionKind.PLACED,
          actor: { userId: ADMIN_ID, username: null },
          reason: 'Harassment case',
        }),
      ]);
    });

    it('holds a report’s evidence, naming its author', async () => {
      const reviewAt = new Date(Date.now() + 30 * DAY);
      const hold = await service.place(ADMIN_ID, {
        kind: ModerationHoldKind.CHAT_REPORT,
        chatReportId: REPORT_ID,
        reason: 'Keep evidence',
        reviewAt,
      });

      expect(hold).toEqual(
        expect.objectContaining({
          chatReportId: REPORT_ID,
          subject: { userId: MEMBER_ID, username: 'Member' },
          reviewAt,
        }),
      );
    });

    it('refuses what does not exist, or a review out of reach', async () => {
      await expect(
        service.place(ADMIN_ID, {
          kind: ModerationHoldKind.CHAT_REPORT,
          chatReportId: 'missing',
          reason: 'x',
        }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.place(ADMIN_ID, {
          kind: ModerationHoldKind.MEMBER_MESSAGES,
          subjectUserId: 'missing',
          reason: 'x',
        }),
      ).rejects.toThrow(NotFoundException);

      for (const reviewAt of [
        new Date(Date.now() - 1),
        new Date(Date.now() + (MODERATION_HOLD_REVIEW_DAYS + 1) * DAY),
      ]) {
        await expect(
          service.place(ADMIN_ID, {
            kind: ModerationHoldKind.MEMBER_MESSAGES,
            subjectUserId: MEMBER_ID,
            reason: 'x',
            reviewAt,
          }),
        ).rejects.toThrow(BadRequestException);
      }
    });

    it('refuses a second hold in force, and passes other failures on', async () => {
      const clash = Object.assign(
        new QueryFailedError('INSERT', [], new Error('duplicate')),
        { driverError: { code: '23505' } },
      );

      world.db.save = jest.fn(() => Promise.reject(clash)) as never;
      await expect(holdMember()).rejects.toThrow(ConflictException);

      world.db.save = jest.fn(() =>
        Promise.reject(new QueryFailedError('INSERT', [], new Error('other'))),
      ) as never;
      await expect(holdMember()).rejects.toThrow(QueryFailedError);

      world.db.save = jest.fn(() => Promise.reject(new Error('down'))) as never;
      await expect(holdMember()).rejects.toThrow('down');
    });
  });

  describe('extend and release', () => {
    beforeEach(stamping);

    it('moves the review date with a reason, logged from and to', async () => {
      const { id, reviewAt } = await holdMember();
      const later = new Date(Date.now() + 170 * DAY);

      const extended = await service.extend(id, ADMIN_ID, {
        reviewAt: later,
        reason: 'Still investigating',
      });

      expect(extended.reviewAt).toEqual(later);
      expect(
        table<ModerationHoldActionEntity>(ModerationHoldActionEntity).slice(
          -1,
        )[0],
      ).toEqual(
        expect.objectContaining({
          action: ModerationHoldActionKind.EXTENDED,
          detail: { from: reviewAt.toISOString(), to: later.toISOString() },
        }),
      );
    });

    it('refuses an extension out of reach, or of a hold not in force', async () => {
      const { id } = await holdMember();

      await expect(
        service.extend(id, ADMIN_ID, {
          reviewAt: new Date(Date.now() - DAY),
          reason: 'x',
        }),
      ).rejects.toThrow(BadRequestException);

      await service.release(id, ADMIN_ID, 'Done');

      await expect(
        service.extend(id, ADMIN_ID, {
          reviewAt: new Date(Date.now() + DAY),
          reason: 'x',
        }),
      ).rejects.toThrow(NotFoundException);
      await expect(service.release(id, ADMIN_ID, 'Again')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('releases with a reason, logged, after which the purge may take it all', async () => {
      const { id } = await holdMember();

      expect(await heldAuthors(world.db.asManager())).toEqual([MEMBER_ID]);

      const released = await service.release(id, ADMIN_ID, 'Case closed');

      expect(released).toEqual(
        expect.objectContaining({
          releasedAt: expect.any(Date),
          releasedBy: { userId: ADMIN_ID, username: null },
          releaseReason: 'Case closed',
          reviewDue: false,
        }),
      );
      expect(released.actions.map(each => each.action)).toEqual([
        ModerationHoldActionKind.RELEASED,
        ModerationHoldActionKind.PLACED,
      ]);
      expect(await heldAuthors(world.db.asManager())).toEqual([]);
    });
  });

  describe('list and detail', () => {
    it('lists in force, released, or all, due reviews first', async () => {
      world.db.seed(ModerationHoldEntity, [
        {
          id: 'due',
          kind: ModerationHoldKind.MEMBER_MESSAGES,
          chatReportId: null,
          subjectUserId: 'gone-user',
          reason: 'Old',
          ownerUserId: null,
          reviewAt: new Date(Date.now() - DAY),
          createdAt: new Date(Date.now() - 200 * DAY),
          releasedAt: null,
          releasedByUserId: null,
          releaseReason: null,
        },
        {
          id: 'released',
          kind: ModerationHoldKind.CHAT_REPORT,
          chatReportId: 'purged-report',
          subjectUserId: null,
          reason: 'Old',
          ownerUserId: ADMIN_ID,
          reviewAt: new Date(Date.now() - 2 * DAY),
          createdAt: new Date(Date.now() - 100 * DAY),
          releasedAt: new Date(),
          releasedByUserId: MODERATOR_ID,
          releaseReason: 'Done',
        },
      ]);

      expect((await service.list()).map(each => each.id)).toEqual([
        'released',
        'due',
      ]);
      expect(await service.list(true)).toEqual([
        expect.objectContaining({
          id: 'due',
          reviewDue: true,
          subject: { userId: 'gone-user', username: null },
          owner: null,
        }),
      ]);
      expect(await service.list(false)).toEqual([
        expect.objectContaining({
          id: 'released',
          reviewDue: false,
          subject: null,
          releasedBy: { userId: MODERATOR_ID, username: 'Moderator' },
        }),
      ]);
    });

    it('lists nothing when there are no holds', async () => {
      await expect(service.list(true)).resolves.toEqual([]);
    });

    it('hides a hold that does not exist', async () => {
      await expect(service.detail('missing')).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        service.read('missing', ADMIN_ID, { purpose: 'Looking into it' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('read', () => {
    beforeEach(stamping);

    it('reads everything the member wrote, deleted text too, a page at a time, logged with the purpose', async () => {
      world.befriend(MEMBER_ID, FRIEND_ID);

      const { id: conversationId } = await world.direct.open(
        MEMBER_ID,
        FRIEND_ID,
      );
      const at = Date.now() - 60 * DAY;

      for (let index = 1; index <= HELD_MESSAGE_PAGE_SIZE + 1; index += 1) {
        seedMessage(world.db, {
          id: idOf(index),
          createdAt: new Date(at + index * 1000),
          body: `#${index}`,
        });
      }

      seedMessage(world.db, {
        id: idOf(100),
        channelId: null,
        conversationId,
        createdAt: new Date(at + 100_000),
        body: 'In private',
        deletedAt: new Date(),
      });
      seedMessage(world.db, {
        id: idOf(101),
        channelId: 'gone-channel',
        createdAt: new Date(at + 99_000),
        body: 'Somewhere gone',
      });
      seedMessage(world.db, {
        id: idOf(200),
        authorUserId: OFFICER_ID,
        createdAt: new Date(at + 200_000),
      });

      const { id } = await holdMember();
      const first = await service.read(id, ADMIN_ID, {
        purpose: 'Reviewing the case',
      });

      expect(first.messages).toHaveLength(HELD_MESSAGE_PAGE_SIZE);
      expect(first.messages[0]).toEqual(
        expect.objectContaining({
          id: idOf(100),
          place: expect.objectContaining({ kind: 'DIRECT', conversationId }),
          with: { userId: FRIEND_ID, username: 'Friend' },
          author: { userId: MEMBER_ID, username: 'Member' },
          body: 'In private',
          deleted: true,
        }),
      );
      expect(first.messages[1]).toEqual(
        expect.objectContaining({
          id: idOf(101),
          place: expect.objectContaining({
            channelId: 'gone-channel',
            channelName: null,
          }),
          with: null,
        }),
      );
      expect(first.messages[2].place).toEqual({
        kind: 'CHANNEL',
        channelId: CHANNEL_ID,
        channelName: 'General',
        scopeKind: FleetScopeKind.FLEET,
        scopeName: 'Fixture Fleet',
        conversationId: null,
      });
      const last = first.messages[first.messages.length - 1];

      expect(first.before).toBe(
        cursorOf({ id: last.id, createdAt: last.sentAt }),
      );

      const second = await service.read(id, ADMIN_ID, {
        purpose: 'Reviewing the case',
        before: first.before as string,
      });

      expect(second.messages.map(each => each.id)).toEqual([
        idOf(3),
        idOf(2),
        idOf(1),
      ]);
      expect(second.before).toBeNull();
      expect(
        table<ModerationHoldActionEntity>(ModerationHoldActionEntity)
          .filter(each => each.action === ModerationHoldActionKind.READ)
          .map(each => [each.reason, each.detail]),
      ).toEqual([
        ['Reviewing the case', { messages: HELD_MESSAGE_PAGE_SIZE }],
        ['Reviewing the case', { messages: 3, before: first.before }],
      ]);
    });

    it('reads nothing once the member’s account has gone', async () => {
      const { id } = await holdMember();

      table<ModerationHoldEntity>(ModerationHoldEntity)[0].subjectUserId = null;

      await expect(
        service.read(id, ADMIN_ID, { purpose: 'Reviewing the case' }),
      ).resolves.toEqual({ messages: [], before: null });
    });

    it('reads a report’s evidence, oldest last, where it was', async () => {
      world.db.seed(ChatReportEvidenceEntity, [
        {
          reportId: REPORT_ID,
          position: 1,
          messageId: idOf(0),
          authorUserId: null,
          authorUsername: null,
          body: null,
          deleted: true,
          sentAt: new Date(Date.now() - 2000),
        },
        {
          reportId: REPORT_ID,
          position: 0,
          messageId: idOf(1),
          authorUserId: MEMBER_ID,
          authorUsername: 'Member',
          body: 'Reported',
          deleted: false,
          sentAt: new Date(Date.now() - 1000),
        },
      ]);

      const hold = await service.place(ADMIN_ID, {
        kind: ModerationHoldKind.CHAT_REPORT,
        chatReportId: REPORT_ID,
        reason: 'Keep evidence',
      });

      expect((await holdOnReport(world.db.asManager(), REPORT_ID))?.id).toBe(
        hold.id,
      );
      expect(await heldReports(world.db.asManager())).toEqual([REPORT_ID]);

      const page = await service.read(hold.id, ADMIN_ID, {
        purpose: 'Reviewing the report',
      });

      expect(page.before).toBeNull();
      expect(page.messages).toEqual([
        expect.objectContaining({
          id: idOf(1),
          author: { userId: MEMBER_ID, username: 'Member' },
          body: 'Reported',
          place: expect.objectContaining({ channelName: 'General' }),
        }),
        expect.objectContaining({ id: idOf(0), author: null, body: null }),
      ]);
    });

    it('reads a report from a conversation, and a scope that has gone', async () => {
      world.db.rows(StoFleetEntity).splice(0);
      table<ChatMessageReportEntity>(ChatMessageReportEntity).push({
        id: 'direct-report',
        channelId: null,
        conversationId: 'talk',
        authorUserId: MEMBER_ID,
      } as ChatMessageReportEntity);
      world.db.seed(ChatDirectConversationEntity, [
        { id: 'talk', userLowId: MEMBER_ID, userHighId: FRIEND_ID },
      ]);

      const hold = await service.place(ADMIN_ID, {
        kind: ModerationHoldKind.CHAT_REPORT,
        chatReportId: 'direct-report',
        reason: 'Keep evidence',
      });

      await expect(
        service.read(hold.id, ADMIN_ID, { purpose: 'Reviewing the report' }),
      ).resolves.toEqual({ messages: [], before: null });

      const onChannel = await service.place(ADMIN_ID, {
        kind: ModerationHoldKind.CHAT_REPORT,
        chatReportId: REPORT_ID,
        reason: 'Keep evidence',
      });

      expect(
        (await service.list(true)).find(each => each.id === onChannel.id)
          ?.subject,
      ).toEqual({ userId: MEMBER_ID, username: 'Member' });

      world.db.seed(ChatReportEvidenceEntity, [
        {
          reportId: REPORT_ID,
          position: 0,
          messageId: idOf(1),
          authorUserId: MEMBER_ID,
          authorUsername: 'Member',
          body: 'Reported',
          deleted: false,
          sentAt: new Date(),
        },
      ]);

      const { messages } = await service.read(onChannel.id, ADMIN_ID, {
        purpose: 'Reviewing the report',
      });

      expect(messages[0].place).toEqual(
        expect.objectContaining({
          channelName: 'General',
          scopeKind: null,
          scopeName: null,
        }),
      );
    });

    it('reads nothing of a report purged since its hold was released', async () => {
      world.db.seed(ModerationHoldEntity, [
        {
          id: 'purged-hold',
          kind: ModerationHoldKind.CHAT_REPORT,
          chatReportId: 'purged',
          subjectUserId: null,
          reason: 'Old',
          ownerUserId: null,
          reviewAt: new Date(Date.now() + DAY),
          createdAt: new Date(),
          releasedAt: new Date(),
          releasedByUserId: null,
          releaseReason: 'Done',
        },
      ]);

      await expect(
        service.read('purged-hold', ADMIN_ID, { purpose: 'Looking back' }),
      ).resolves.toEqual({ messages: [], before: null });
    });

    it('names nobody for a report whose row has gone', async () => {
      world.db.seed(ModerationHoldEntity, [
        {
          id: 'orphan',
          kind: ModerationHoldKind.CHAT_REPORT,
          chatReportId: 'purged',
          subjectUserId: null,
          reason: 'Old',
          ownerUserId: null,
          reviewAt: new Date(Date.now() + DAY),
          createdAt: new Date(),
          releasedAt: new Date(),
          releasedByUserId: null,
          releaseReason: 'Done',
        },
      ]);

      await expect(service.detail('orphan')).resolves.toEqual(
        expect.objectContaining({ subject: null, actions: [] }),
      );
    });
  });

  describe('review (FC-037)', () => {
    const OTHER_ADMIN_ID = '31000000-0000-4000-8000-0000000000a2';

    beforeEach(() => {
      stamping();
      world.db.seed(UserEntity, [
        { id: ADMIN_ID, role: UserRole.ADMIN, disabledAt: null },
        { id: OTHER_ADMIN_ID, role: UserRole.ADMIN, disabledAt: null },
        { id: FRIEND_ID, role: UserRole.USER, disabledAt: null },
        { id: OFFICER_ID, role: UserRole.ADMIN, disabledAt: new Date() },
      ]);
    });

    /**
     * Seeds a hold in force whose review date passed some days ago.
     *
     * @param daysAgo - How long ago its review date was.
     * @param overrides - What differs.
     * @returns Its ID.
     */
    const due = (daysAgo: number, overrides: Row = {}): string => {
      const id = `hold-${daysAgo}`;

      world.db.seed(ModerationHoldEntity, [
        {
          id,
          kind: ModerationHoldKind.MEMBER_MESSAGES,
          chatReportId: null,
          subjectUserId: MEMBER_ID,
          reason: 'Harassment case',
          ownerUserId: ADMIN_ID,
          reviewAt: new Date(Date.now() - daysAgo * DAY),
          createdAt: new Date(Date.now() - 200 * DAY),
          releasedAt: null,
          releasedByUserId: null,
          releaseReason: null,
          ...overrides,
        },
      ]);

      return id;
    };

    const told = (): unknown[] =>
      notifications.createNotification.mock.calls.map(([input]) => input);

    const log = (holdId: string) =>
      table<ModerationHoldActionEntity>(ModerationHoldActionEntity).filter(
        action => action.holdId === holdId,
      );

    it('leaves a hold alone until its review date', async () => {
      due(-1);

      await expect(service.review()).resolves.toEqual({
        counts: { told: 0, warned: 0, released: 0 },
        complete: true,
      });
      expect(told()).toEqual([]);
    });

    it('tells its owner once when the date passes', async () => {
      const holdId = due(1);

      await expect(service.review()).resolves.toEqual({
        counts: { told: 1, warned: 0, released: 0 },
        complete: true,
      });
      await expect(service.review()).resolves.toEqual({
        counts: { told: 0, warned: 0, released: 0 },
        complete: true,
      });

      expect(told()).toEqual([
        expect.objectContaining({
          userId: ADMIN_ID,
          title: 'Hold due for review',
          body: expect.stringContaining('a member’s chat messages'),
          linkUrl: '/admin/holds',
        }),
      ]);
      expect(log(holdId)).toEqual([
        expect.objectContaining({
          action: ModerationHoldActionKind.REVIEW_DUE,
          actorUserId: null,
        }),
      ]);

      const detail = await service.detail(holdId);

      expect(detail.reviewDue).toBe(true);
      expect(detail.releasesAt!.getTime() - detail.reviewAt.getTime()).toBe(
        14 * DAY,
      );
      expect(detail.actions[0]).toEqual(
        expect.objectContaining({ automatic: true, actor: null }),
      );
    });

    // FC-039: two runs that cross, each reading before the other writes,
    // may both tell people, but the log keeps one entry for each step.
    it('logs each step once when two runs cross, keyed by the review date', async () => {
      const holdId = due(10);
      const at = table<ModerationHoldEntity>(ModerationHoldEntity)
        .find(hold => hold.id === holdId)!
        .reviewAt.toISOString();

      // Neither run sees what the other logged.
      (
        service as unknown as {
          noticesFor: () => Promise<Set<ModerationHoldActionKind>>;
        }
      ).noticesFor = () => Promise.resolve(new Set());

      await service.review();
      await service.review();

      expect(log(holdId).map(action => action.idempotencyKey)).toEqual([
        `REVIEW_DUE:${holdId}:${at}`,
        `RELEASE_WARNED:${holdId}:${at}`,
      ]);
    });

    it('tells every open site admin when its owner is no longer one', async () => {
      due(1, { ownerUserId: FRIEND_ID, kind: ModerationHoldKind.CHAT_REPORT });
      due(2, { ownerUserId: null });

      await service.review();

      expect(told()).toEqual(
        [ADMIN_ID, OTHER_ADMIN_ID, ADMIN_ID, OTHER_ADMIN_ID].map(userId =>
          expect.objectContaining({ userId }),
        ),
      );
      expect(told()[2]).toEqual(
        expect.objectContaining({
          body: expect.stringContaining('a chat report’s evidence'),
        }),
      );
    });

    it('warns every site admin once, a week before it is released', async () => {
      const holdId = due(7);

      await expect(service.review()).resolves.toEqual({
        counts: { told: 1, warned: 1, released: 0 },
        complete: true,
      });
      await expect(service.review()).resolves.toEqual({
        counts: { told: 0, warned: 0, released: 0 },
        complete: true,
      });

      expect(told()).toEqual([
        expect.objectContaining({ userId: ADMIN_ID }),
        expect.objectContaining({
          userId: ADMIN_ID,
          title: 'Hold to be released',
        }),
        expect.objectContaining({
          userId: OTHER_ADMIN_ID,
          title: 'Hold to be released',
        }),
      ]);
      expect(log(holdId).map(action => action.action)).toEqual([
        ModerationHoldActionKind.REVIEW_DUE,
        ModerationHoldActionKind.RELEASE_WARNED,
      ]);
    });

    it('releases a hold nobody reviewed within 14 days, as nobody’s', async () => {
      const holdId = due(14);

      await expect(service.review()).resolves.toEqual({
        counts: { told: 0, warned: 0, released: 1 },
        complete: true,
      });

      const detail = await service.detail(holdId);

      expect(detail).toEqual(
        expect.objectContaining({
          releasedBy: null,
          releasesAt: null,
          releaseReason:
            'Released automatically: not reviewed within 14 days of its ' +
            'review date.',
        }),
      );
      expect(detail.releasedAt).toBeInstanceOf(Date);
      expect(detail.actions).toEqual([
        expect.objectContaining({
          action: ModerationHoldActionKind.RELEASED,
          actor: null,
          automatic: true,
        }),
      ]);
      await expect(heldAuthors(world.db.asManager())).resolves.toEqual([]);
      // The release nobody made is in the hold ledger too (FC-042).
      expect(marks).toEqual([
        expect.objectContaining({
          actionId: log(holdId)[0].id,
          kind: ModerationHoldActionKind.RELEASED,
        }),
      ]);
    });

    it('starts again when somebody extends it', async () => {
      const holdId = due(8);

      await service.review();
      await service.extend(holdId, ADMIN_ID, {
        reviewAt: new Date(Date.now() + DAY),
        reason: 'Still investigating',
      });
      world.db.update(
        ModerationHoldEntity,
        { id: holdId },
        { reviewAt: new Date(Date.now() - DAY) },
      );
      notifications.createNotification.mockClear();

      await expect(service.review()).resolves.toEqual({
        counts: { told: 1, warned: 0, released: 0 },
        complete: true,
      });

      const detail = await service.detail(holdId);

      expect(
        detail.actions.find(
          action => action.action === ModerationHoldActionKind.EXTENDED,
        ),
      ).toEqual(expect.objectContaining({ automatic: false }));
    });

    it('releases nothing that changed after it was read', async () => {
      const holdId = due(20);
      const findOne = world.db.findOne;

      world.db.findOne = ((entity: never, options: never) =>
        findOne(entity, options).then(row =>
          row === null ? null : { ...row, reviewAt: new Date() },
        )) as typeof world.db.findOne;

      await expect(service.review()).resolves.toEqual({
        counts: { told: 0, warned: 0, released: 0 },
        complete: true,
      });

      world.db.findOne = (() => Promise.resolve(null)) as never;

      await expect(service.review()).resolves.toEqual(
        expect.objectContaining({
          counts: { told: 0, warned: 0, released: 0 },
        }),
      );
      world.db.findOne = findOne;
      expect((await service.detail(holdId)).releasedAt).toBeNull();
    });

    it('logs the step even when a notice cannot be written', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const holdId = due(1);

      notifications.createNotification.mockRejectedValue(new Error('down'));

      await service.review();

      expect(log(holdId)).toHaveLength(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('[tell] Hold notice not sent'),
      );
      warn.mockRestore();
    });
  });

  // FC-042: a restore from an older backup must not lose a hold, so every
  // placing, extension and release is in the ledger before the database.
  describe('the hold ledger (FC-042)', () => {
    beforeEach(stamping);

    it('writes each placing, extension and release first, under the log entry’s own ID, with no reason', async () => {
      const { id } = await holdMember();
      const later = new Date(Date.now() + 170 * DAY);

      await service.extend(id, ADMIN_ID, {
        reviewAt: later,
        reason: 'Still investigating',
      });
      await service.release(id, ADMIN_ID, 'Case closed');

      const actions = table<ModerationHoldActionEntity>(
        ModerationHoldActionEntity,
      );

      expect(marks).toEqual(
        actions.map(action => ({
          actionId: action.id,
          holdId: id,
          kind: action.action,
          holdKind: ModerationHoldKind.MEMBER_MESSAGES,
          chatReportId: null,
          subjectUserId: MEMBER_ID,
          ownerUserId: ADMIN_ID,
          reviewAt: expect.any(String),
          createdAt: expect.any(String),
        })),
      );
      expect(marks.map(mark => mark.kind)).toEqual([
        ModerationHoldActionKind.PLACED,
        ModerationHoldActionKind.EXTENDED,
        ModerationHoldActionKind.RELEASED,
      ]);
      expect(marks[1].reviewAt).toBe(later.toISOString());
      expect(JSON.stringify(marks)).not.toMatch(/investigating|closed|case/i);
    });

    it('writes no reading, and no notice, to the ledger', async () => {
      const { id } = await holdMember();

      marks.length = 0;
      await service.read(id, ADMIN_ID, { purpose: 'Review the case' });

      expect(marks).toEqual([]);
    });

    it('writes nothing to the log when the ledger cannot be written', async () => {
      ledger.write.mockRejectedValueOnce(new Error('Bucket unreachable'));

      await expect(holdMember()).rejects.toThrow('Bucket unreachable');
      expect(table(ModerationHoldActionEntity)).toEqual([]);
    });
  });
});
