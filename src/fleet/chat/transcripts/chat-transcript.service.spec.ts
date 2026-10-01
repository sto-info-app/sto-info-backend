import { Readable } from 'stream';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Queue } from 'bullmq';

import { NotificationSeverity } from 'src/notification/enums/notification-severity.enum';
import { NotificationTarget } from 'src/notification/enums/notification-target.enum';
import { NotificationService } from 'src/notification/notification.service';

import {
  ARMADA_ID,
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
import { FleetPolicyService } from '../../fleet-policy.service';
import { RETENTION_BATCH_SIZE } from '../../retention/retention.constants';
import { ChatActionEntity } from '../entities/chat-action.entity';
import { ChatChannelEntity } from '../entities/chat-channel.entity';
import { ChatTranscriptEntity } from '../entities/chat-transcript.entity';
import { ChatActionKind, ChatTranscriptStatus } from '../enums/chat.enums';
import { ChatExportStorageService } from './chat-export-storage.service';
import {
  CHAT_TRANSCRIPT_ATTEMPTS,
  CHAT_TRANSCRIPT_BATCH,
  CHAT_TRANSCRIPT_JOB,
} from './chat-transcript.constants';
import { ChatTranscriptService } from './chat-transcript.service';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const TRANSCRIPT_ID = '31000000-0000-4000-8000-0000000000f1';

/** An Admin who may export. */
const EXPORTER = {
  ...MODERATOR,
  capabilities: [
    ...(MODERATOR.capabilities as string[]),
    FLEET_CAPABILITIES.CHAT_TRANSCRIPT_EXPORT,
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

/**
 * A table's rows, typed.
 *
 * @param entity - The table.
 * @returns Its rows.
 */
let table: <T>(entity: object) => T[];

/** A mocked asynchronous call. */
type AsyncMock = jest.Mock<(...args: any[]) => Promise<any>>;

describe('ChatTranscriptService', () => {
  let world: ChatWorld;
  let storage: {
    put: AsyncMock;
    getStream: AsyncMock;
    remove: AsyncMock;
    buildObjectKey: (id: string) => string;
  };
  let notifications: { createNotification: AsyncMock };
  let queue: { add: AsyncMock };
  let service: ChatTranscriptService;

  beforeEach(() => {
    world = chatWorld();
    table = <T>(entity: object) =>
      world.db.rows<Row>(entity as never) as unknown as T[];
    seedChannel(world.db);
    world.stand(MEMBER_ID, FLEET_ID, MEMBER);
    world.stand(MODERATOR_ID, FLEET_ID, EXPORTER);
    world.stand(OFFICER_ID, FLEET_ID, EXPORTER);
    storage = {
      put: jest.fn((_key: string, text: string) =>
        Promise.resolve(Buffer.byteLength(text)),
      ) as AsyncMock,
      getStream: jest.fn(() =>
        Promise.resolve(Readable.from(['text'])),
      ) as AsyncMock,
      remove: jest.fn(() => Promise.resolve()) as AsyncMock,
      buildObjectKey: id => `test/chat-transcripts/${id}.txt`,
    };
    notifications = {
      createNotification: jest.fn(() => Promise.resolve({})) as AsyncMock,
    };
    queue = { add: jest.fn(() => Promise.resolve({})) as AsyncMock };
    service = new ChatTranscriptService(
      world.db.asDataSource(),
      world.messages,
      world.direct,
      { chatTranscriptHistoryDays: 7 } as FleetPolicyService,
      storage as unknown as ChatExportStorageService,
      notifications as unknown as NotificationService,
      queue as unknown as Queue,
    );
  });

  /**
   * Seeds a transcript.
   *
   * @param overrides - What differs.
   * @returns The row.
   */
  const seedTranscript = (overrides: Partial<ChatTranscriptEntity> = {}) => {
    const row = {
      id: TRANSCRIPT_ID,
      channelId: CHANNEL_ID,
      requestedByUserId: MODERATOR_ID,
      purpose: 'Looking into a complaint',
      fromAt: ago(2 * DAY),
      toAt: ago(MINUTE),
      status: ChatTranscriptStatus.PENDING,
      objectKey: null,
      messageCount: null,
      byteCount: null,
      createdAt: ago(MINUTE),
      readyAt: null,
      expiresAt: null,
      ...overrides,
    } as ChatTranscriptEntity;

    world.db.seed(ChatTranscriptEntity, [row as unknown as Row]);

    return row;
  };

  /**
   * The transcript's row.
   *
   * @returns It.
   */
  const row = (): ChatTranscriptEntity =>
    table<ChatTranscriptEntity>(ChatTranscriptEntity)[0];

  /**
   * The text last written.
   *
   * @returns It.
   */
  const written = (): string => storage.put.mock.calls[0][1] as string;

  describe('request', () => {
    const dto = (overrides: object = {}) => ({
      fromAt: ago(DAY),
      toAt: new Date(),
      purpose: 'Looking into a complaint',
      ...overrides,
    });

    it('hides a channel they may not read', async () => {
      await expect(
        service.request(CHANNEL_ID, STRANGER_ID, dto()),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses a reader who may not export', async () => {
      await expect(
        service.request(CHANNEL_ID, MEMBER_ID, dto()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a range reaching back past seven days, by the server clock', async () => {
      await expect(
        service.request(
          CHANNEL_ID,
          MODERATOR_ID,
          dto({ fromAt: ago(7 * DAY + MINUTE) }),
        ),
      ).rejects.toThrow(
        new BadRequestException('A transcript reaches back 7 days at most.'),
      );
    });

    // Plan §11.8 (FC-043): exactly seven days is allowed, with the clock
    // stopped so the edge is the edge.
    it('allows a range reaching back exactly seven days, and not a moment more', async () => {
      jest.useFakeTimers({
        now: new Date('2026-10-01T12:00:00.000Z'),
        doNotFake: ['nextTick', 'setImmediate', 'setTimeout'],
      });

      try {
        await expect(
          service.request(
            CHANNEL_ID,
            MODERATOR_ID,
            dto({ fromAt: ago(7 * DAY + 1) }),
          ),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.request(
            CHANNEL_ID,
            MODERATOR_ID,
            dto({ fromAt: ago(7 * DAY) }),
          ),
        ).resolves.toBeDefined();
      } finally {
        jest.useRealTimers();
      }
    });

    it('refuses a range that ends before it starts', async () => {
      await expect(
        service.request(
          CHANNEL_ID,
          MODERATOR_ID,
          dto({ fromAt: ago(HOUR), toAt: ago(2 * HOUR) }),
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.request(
          CHANNEL_ID,
          MODERATOR_ID,
          dto({ fromAt: new Date(Date.now() + HOUR), toAt: ago(0) }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('records, logs and queues a request, ending no later than now', async () => {
      const fromAt = ago(7 * DAY - MINUTE);
      const transcript = await service.request(
        CHANNEL_ID,
        MODERATOR_ID,
        dto({ fromAt, toAt: new Date(Date.now() + HOUR) }),
      );

      expect(transcript).toEqual(
        expect.objectContaining({
          channelId: CHANNEL_ID,
          channelName: 'General',
          scopeKind: FleetScopeKind.FLEET,
          scopeName: 'Fixture Fleet',
          purpose: 'Looking into a complaint',
          fromAt,
          status: ChatTranscriptStatus.PENDING,
        }),
      );
      expect(transcript.toAt.getTime()).toBeLessThanOrEqual(Date.now());
      expect(row().createdAt).toEqual(transcript.toAt);
      expect(table<ChatActionEntity>(ChatActionEntity)).toEqual([
        expect.objectContaining({
          channelId: CHANNEL_ID,
          action: ChatActionKind.TRANSCRIPT_REQUESTED,
          actorUserId: MODERATOR_ID,
          reason: 'Looking into a complaint',
          detail: {
            transcriptId: transcript.id,
            fromAt: fromAt.toISOString(),
            toAt: transcript.toAt.toISOString(),
          },
        }),
      ]);
      expect(queue.add).toHaveBeenCalledWith(
        CHAT_TRANSCRIPT_JOB,
        { transcriptId: transcript.id },
        expect.objectContaining({ attempts: CHAT_TRANSCRIPT_ATTEMPTS }),
      );
    });

    it('fails a request the queue will not take', async () => {
      queue.add.mockRejectedValueOnce(new Error('Redis is down'));

      const transcript = await service.request(CHANNEL_ID, MODERATOR_ID, dto());

      expect(transcript.status).toBe(ChatTranscriptStatus.FAILED);
      expect(row().status).toBe(ChatTranscriptStatus.FAILED);
    });

    it('fails a request the queue refuses with something other than an error', async () => {
      queue.add.mockRejectedValueOnce('down');

      await expect(
        service.request(CHANNEL_ID, MODERATOR_ID, dto()),
      ).resolves.toEqual(
        expect.objectContaining({ status: ChatTranscriptStatus.FAILED }),
      );
    });
  });

  describe('process', () => {
    it('does nothing for a transcript that is not waiting', async () => {
      await service.process(TRANSCRIPT_ID);
      seedTranscript({ status: ChatTranscriptStatus.READY });
      await service.process(TRANSCRIPT_ID);

      expect(storage.put).not.toHaveBeenCalled();
    });

    it('fails a transcript whose requester may no longer export', async () => {
      seedTranscript();
      world.stand(MODERATOR_ID, FLEET_ID, MEMBER);

      await service.process(TRANSCRIPT_ID);

      expect(row().status).toBe(ChatTranscriptStatus.FAILED);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('fails a transcript of a channel archived since', async () => {
      seedTranscript();
      table<ChatChannelEntity>(ChatChannelEntity)[0].archivedAt = new Date();

      await service.process(TRANSCRIPT_ID);

      expect(row().status).toBe(ChatTranscriptStatus.FAILED);
    });

    it('fails a transcript whose requester has gone', async () => {
      seedTranscript({ requestedByUserId: null });

      await service.process(TRANSCRIPT_ID);

      expect(row().status).toBe(ChatTranscriptStatus.FAILED);
    });

    it('fails a transcript whose scope has gone', async () => {
      seedTranscript();
      world.db.rows(StoFleetEntity).splice(0);

      await service.process(TRANSCRIPT_ID);

      expect(row().status).toBe(ChatTranscriptStatus.FAILED);
    });

    it('writes the range, deleted and hidden messages as the requester may see them', async () => {
      const first = ago(DAY + 3 * HOUR);

      seedTranscript({ fromAt: ago(2 * DAY), toAt: ago(MINUTE) });
      world.block(MODERATOR_ID, FRIEND_ID);
      seedChannel(world.db, { id: 'other', name: 'Other' });
      seedMessage(world.db, {
        id: idOf(1),
        createdAt: ago(3 * DAY),
        body: 'Too early',
      });
      seedMessage(world.db, {
        id: idOf(2),
        createdAt: first,
        body: 'First line\nsecond line',
      });
      seedMessage(world.db, {
        id: idOf(3),
        createdAt: ago(20 * HOUR),
        body: 'Taken back',
        deletedAt: ago(19 * HOUR),
      });
      seedMessage(world.db, {
        id: idOf(4),
        createdAt: ago(10 * HOUR),
        authorUserId: FRIEND_ID,
        body: 'Across a block',
      });
      seedMessage(world.db, {
        id: idOf(5),
        createdAt: ago(5 * HOUR),
        authorUserId: null,
        body: 'From a closed account',
      });
      seedMessage(world.db, {
        id: idOf(6),
        createdAt: ago(4 * HOUR),
        authorUserId: OFFICER_ID,
        body: 'From nobody named',
      });
      seedMessage(world.db, {
        id: idOf(7),
        channelId: 'other',
        createdAt: ago(HOUR),
        body: 'Elsewhere',
      });
      seedMessage(world.db, {
        id: idOf(8),
        createdAt: new Date(),
        body: 'Too late',
      });

      await service.process(TRANSCRIPT_ID);

      const text = written();
      const [header, body] = text.split('\n\n');

      expect(header.split('\n')).toEqual([
        'STO Info chat transcript',
        'Fleet: Fixture Fleet',
        'Channel: General',
        expect.stringMatching(/^From: \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/),
        expect.stringMatching(/^To: \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/),
        'Purpose: Looking into a complaint',
        'Exported by: Moderator',
        expect.stringMatching(/^Generated: .* UTC$/),
        'Messages: 5',
      ]);
      expect(body).toContain(
        `${first.toISOString().slice(0, 16).replace('T', ' ')} Member: ` +
          'First line\n    second line\n',
      );
      expect(body).toMatch(/ Member: \[deleted\]\n/);
      expect(body).toMatch(
        / \[hidden\]: Message from a member you can’t see\n/,
      );
      expect(body).toMatch(/ \[former member\]: From a closed account\n/);
      expect(body).toMatch(/ \[unknown\]: From nobody named\n$/);
      expect(text).not.toMatch(/Too early|Too late|Elsewhere|Taken back|block/);
      expect(storage.put).toHaveBeenCalledWith(
        `test/chat-transcripts/${TRANSCRIPT_ID}.txt`,
        text,
      );
      expect(row()).toEqual(
        expect.objectContaining({
          status: ChatTranscriptStatus.READY,
          objectKey: `test/chat-transcripts/${TRANSCRIPT_ID}.txt`,
          messageCount: 5,
          byteCount: Buffer.byteLength(text),
        }),
      );
      expect(row().expiresAt!.getTime() - row().readyAt!.getTime()).toBe(DAY);
      expect(notifications.createNotification).toHaveBeenCalledWith({
        target: NotificationTarget.USER,
        userId: MODERATOR_ID,
        severity: NotificationSeverity.SUCCESS,
        title: 'Transcript ready',
        body:
          'Your transcript of General is ready. It can be downloaded from ' +
          'Chat for 24 hours.',
        linkUrl: '/chat',
      });
    });

    it('reads a long range in batches, in order', async () => {
      seedTranscript({ requestedByUserId: OFFICER_ID });
      const at = ago(HOUR);

      for (let index = 1; index <= CHAT_TRANSCRIPT_BATCH + 1; index += 1) {
        seedMessage(world.db, {
          id: idOf(index),
          createdAt: at,
          body: `#${index}`,
        });
      }

      await service.process(TRANSCRIPT_ID);

      const text = written();

      expect(text).toContain('Exported by: [unknown]');
      expect(text).toContain(`Messages: ${CHAT_TRANSCRIPT_BATCH + 1}`);
      expect(text.trimEnd().split('\n').pop()).toMatch(
        new RegExp(`#${CHAT_TRANSCRIPT_BATCH + 1}$`),
      );
    });

    it('keeps a written transcript when its notice cannot be sent', async () => {
      seedTranscript();
      notifications.createNotification.mockRejectedValueOnce(
        new Error('No database'),
      );

      await service.process(TRANSCRIPT_ID);

      expect(row().status).toBe(ChatTranscriptStatus.READY);
    });
  });

  describe('download', () => {
    const ready = (overrides: Partial<ChatTranscriptEntity> = {}) =>
      seedTranscript({
        status: ChatTranscriptStatus.READY,
        objectKey: 'test/chat-transcripts/key.txt',
        byteCount: 4,
        readyAt: ago(HOUR),
        expiresAt: new Date(Date.now() + HOUR),
        toAt: new Date('2026-09-28T12:00:00Z'),
        ...overrides,
      });

    it('hides somebody else’s transcript', async () => {
      ready();

      await expect(service.download(TRANSCRIPT_ID, MEMBER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses one whose link has expired', async () => {
      ready({ expiresAt: ago(MINUTE) });

      await expect(
        service.download(TRANSCRIPT_ID, MODERATOR_ID),
      ).rejects.toThrow(GoneException);
    });

    it('refuses one the sweep has expired', async () => {
      ready({ status: ChatTranscriptStatus.EXPIRED, objectKey: null });

      await expect(
        service.download(TRANSCRIPT_ID, MODERATOR_ID),
      ).rejects.toThrow(GoneException);
    });

    it('refuses one not written', async () => {
      seedTranscript();

      await expect(
        service.download(TRANSCRIPT_ID, MODERATOR_ID),
      ).rejects.toThrow(ConflictException);
    });

    it('asks again whether they may export the channel', async () => {
      ready();
      world.stand(MODERATOR_ID, FLEET_ID, MEMBER);

      await expect(
        service.download(TRANSCRIPT_ID, MODERATOR_ID),
      ).rejects.toThrow(ForbiddenException);
      expect(storage.getStream).not.toHaveBeenCalled();
    });

    it('opens it for its requester, logged', async () => {
      ready();

      const download = await service.download(TRANSCRIPT_ID, MODERATOR_ID);

      expect(download.filename).toBe('chat-general-2026-09-28.txt');
      expect(download.byteCount).toBe(4);
      expect(storage.getStream).toHaveBeenCalledWith(
        'test/chat-transcripts/key.txt',
      );
      expect(table<ChatActionEntity>(ChatActionEntity)).toEqual([
        expect.objectContaining({
          channelId: CHANNEL_ID,
          action: ChatActionKind.TRANSCRIPT_DOWNLOADED,
          actorUserId: MODERATOR_ID,
          detail: { transcriptId: TRANSCRIPT_ID },
        }),
      ]);
    });

    it.each([
      ['<script>', 'chat-script-2026-09-28.txt'],
      ['!!!', 'chat-channel-2026-09-28.txt'],
    ])('names the file for %s safely', async (name, filename) => {
      ready();
      table<ChatChannelEntity>(ChatChannelEntity)[0].name = name;

      const download = await service.download(TRANSCRIPT_ID, MODERATOR_ID);

      expect(download.filename).toBe(filename);
    });
  });

  describe('mine', () => {
    it('lists their own from the last day, newest first, with where each is', async () => {
      seedChannel(world.db, {
        id: 'armada',
        fleetId: null,
        armadaId: ARMADA_ID,
        name: 'Armada chat',
      });
      seedChannel(world.db, {
        id: 'community',
        fleetId: null,
        armadaId: null,
        name: 'Community chat',
      });
      seedTranscript({ id: 'old', createdAt: ago(DAY + MINUTE) });
      seedTranscript({ id: 'fleet', createdAt: ago(3 * HOUR) });
      seedTranscript({
        id: 'armada',
        channelId: 'armada',
        createdAt: ago(2 * HOUR),
      });
      seedTranscript({
        id: 'community',
        channelId: 'community',
        createdAt: ago(HOUR),
      });
      seedTranscript({ id: 'theirs', requestedByUserId: MEMBER_ID });

      const mine = await service.mine(MODERATOR_ID);

      expect(
        mine.map(each => [each.id, each.scopeKind, each.scopeName]),
      ).toEqual([
        ['community', FleetScopeKind.COMMUNITY, 'Fixture Community'],
        ['armada', FleetScopeKind.ARMADA, 'Fixture Armada'],
        ['fleet', FleetScopeKind.FLEET, 'Fixture Fleet'],
      ]);
    });

    it('lists nothing when there is nothing', async () => {
      await expect(service.mine(MODERATOR_ID)).resolves.toEqual([]);
    });

    it('names no scope that has gone', async () => {
      seedTranscript();
      world.db.rows(StoFleetEntity).splice(0);

      const [transcript] = await service.mine(MODERATOR_ID);

      expect(transcript.scopeName).toBeNull();
    });
  });

  describe('sweep', () => {
    it('deletes expired transcripts and gives up on stale ones', async () => {
      seedTranscript({
        id: 'due',
        status: ChatTranscriptStatus.READY,
        objectKey: 'due.txt',
        expiresAt: ago(MINUTE),
      });
      seedTranscript({
        id: 'live',
        status: ChatTranscriptStatus.READY,
        objectKey: 'live.txt',
        expiresAt: new Date(Date.now() + HOUR),
      });
      seedTranscript({ id: 'stale', createdAt: ago(2 * HOUR) });
      seedTranscript({ id: 'waiting', createdAt: ago(MINUTE) });

      await expect(service.sweep()).resolves.toEqual({
        counts: { expired: 1, notDeleted: 0, failed: 1 },
        complete: true,
      });

      const byId = new Map(
        table<ChatTranscriptEntity>(ChatTranscriptEntity).map(each => [
          each.id,
          each,
        ]),
      );

      expect(storage.remove).toHaveBeenCalledWith('due.txt');
      expect(byId.get('due')).toEqual(
        expect.objectContaining({
          status: ChatTranscriptStatus.EXPIRED,
          objectKey: null,
        }),
      );
      expect(byId.get('live')!.status).toBe(ChatTranscriptStatus.READY);
      expect(byId.get('stale')!.status).toBe(ChatTranscriptStatus.FAILED);
      expect(byId.get('waiting')!.status).toBe(ChatTranscriptStatus.PENDING);
    });

    it('leaves a transcript it could not delete for the next sweep', async () => {
      seedTranscript({
        status: ChatTranscriptStatus.READY,
        objectKey: 'due.txt',
        expiresAt: ago(MINUTE),
      });
      storage.remove
        .mockRejectedValueOnce(new Error('R2 is down'))
        .mockRejectedValueOnce('down');

      const left = {
        counts: { expired: 0, notDeleted: 1, failed: 0 },
        complete: false,
      };

      await expect(service.sweep()).resolves.toEqual(left);
      await expect(service.sweep()).resolves.toEqual(left);
      expect(row().status).toBe(ChatTranscriptStatus.READY);
    });

    // FC-039: the chat log says what became of each, by the system, once.
    it('logs each transcript it expires or gives up on, keyed by the transcript', async () => {
      seedTranscript({
        id: 'due',
        status: ChatTranscriptStatus.READY,
        objectKey: 'due.txt',
        expiresAt: ago(MINUTE),
      });
      seedTranscript({ id: 'stale', createdAt: ago(2 * HOUR) });

      await service.sweep();

      expect(table<ChatActionEntity>(ChatActionEntity)).toEqual([
        expect.objectContaining({
          channelId: CHANNEL_ID,
          action: ChatActionKind.TRANSCRIPT_EXPIRED,
          actorUserId: null,
          detail: { transcriptId: 'due' },
          idempotencyKey: 'TRANSCRIPT_EXPIRED:due',
        }),
        expect.objectContaining({
          action: ChatActionKind.TRANSCRIPT_FAILED,
          actorUserId: null,
          detail: { transcriptId: 'stale' },
          idempotencyKey: 'TRANSCRIPT_FAILED:stale',
        }),
      ]);
    });

    it('neither counts nor logs a stale transcript the job settled first', async () => {
      seedTranscript({ id: 'stale', createdAt: ago(2 * HOUR) });
      world.db.update = jest.fn(() =>
        Promise.resolve({ affected: 0 }),
      ) as never;

      await expect(service.sweep()).resolves.toEqual({
        counts: { expired: 0, notDeleted: 0, failed: 0 },
        complete: true,
      });
      expect(table(ChatActionEntity)).toEqual([]);
    });

    it('counts nothing when the driver says nothing', async () => {
      world.db.update = jest.fn(() => Promise.resolve({})) as never;

      await expect(service.sweep()).resolves.toEqual({
        counts: { expired: 0, notDeleted: 0, failed: 0 },
        complete: true,
      });
    });

    it('takes a batch at a time, leaving the rest for the next sweep (FC-037)', async () => {
      for (let index = 0; index < RETENTION_BATCH_SIZE; index++) {
        seedTranscript({
          id: `due-${index}`,
          status: ChatTranscriptStatus.READY,
          objectKey: `due-${index}.txt`,
          expiresAt: ago(MINUTE),
        });
      }

      await expect(service.sweep()).resolves.toEqual(
        expect.objectContaining({ complete: false }),
      );
    });
  });
});
