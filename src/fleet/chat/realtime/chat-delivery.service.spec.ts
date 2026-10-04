import { Logger, NotFoundException } from '@nestjs/common';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Namespace } from 'socket.io';
import { DataSource } from 'typeorm';

import { UserEntity } from 'src/user/entities/user.entity';

import { ChatMessageDto } from '../dto/chat.dto';
import { ChatChannelEntity } from '../entities/chat-channel.entity';
import { ChatDirectConversationEntity } from '../entities/chat-direct-conversation.entity';
import { ChatDirectService } from '../services/chat-direct.service';
import { ChatMessageService } from '../services/chat-message.service';
import {
  ChatDeliveryService,
  ChatFanout,
  placeOfRoom,
  roomOf,
} from './chat-delivery.service';
import { ChatPresenceService } from './chat-presence.service';
import {
  CHAT_DELIVERY_CHECK_TTL_MS,
  CHAT_FANOUT_EVENT,
  CHAT_REVOKE_EVENT,
  CHAT_SERVER_EVENTS,
} from './chat-socket.constants';

const READER_ID = '32000000-0000-4000-8000-000000000001';
const AUTHOR_ID = '32000000-0000-4000-8000-000000000002';
const GONE_ID = '32000000-0000-4000-8000-000000000003';
const CHANNEL_ID = '32000000-0000-4000-8000-0000000000c1';
const CONVERSATION_ID = '32000000-0000-4000-8000-0000000000d1';

/** A mocked asynchronous call. */
type AsyncMock = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

/** A socket as delivery sees it. */
interface FakeSocket {
  data: { userId: string };
  rooms: Set<string>;
  emit: jest.Mock;
  leave: jest.Mock;
}

/**
 * A socket of a reader.
 *
 * @param userId - The reader.
 * @returns The socket.
 */
const socketOf = (userId: string, ...rooms: string[]): FakeSocket => ({
  data: { userId },
  rooms: new Set([`user:${userId}`, ...rooms]),
  emit: jest.fn(),
  leave: jest.fn(),
});

const MESSAGE = {
  id: 'message',
  author: { userId: AUTHOR_ID, username: 'Kira' },
  body: 'Hello',
  mentions: [],
  replyTo: null,
  hidden: false,
} as unknown as ChatMessageDto;

describe('ChatDeliveryService', () => {
  let users: Map<string, { isAccountDisabled: boolean }>;
  let findOne: AsyncMock;
  let messages: { readableChannel: AsyncMock };
  let direct: { usable: AsyncMock; blockedFor: AsyncMock };
  let presence: { typingEnabled: AsyncMock; refresh: AsyncMock };
  let personalEmit: jest.Mock;
  let allLocal: FakeSocket[];
  let sockets: FakeSocket[];
  let fetchSockets: AsyncMock;
  let server: {
    on: jest.Mock;
    serverSideEmit: jest.Mock;
    in: jest.Mock;
    local: { in: jest.Mock; fetchSockets: AsyncMock };
  };
  let delivery: ChatDeliveryService;

  beforeEach(() => {
    users = new Map([
      [READER_ID, { isAccountDisabled: false }],
      [AUTHOR_ID, { isAccountDisabled: false }],
      [GONE_ID, { isAccountDisabled: true }],
    ]);
    findOne = jest.fn(
      async (entity: unknown, options: { where: { id: string } }) => {
        if (entity === ChatDirectConversationEntity) {
          return { userLowId: READER_ID, userHighId: AUTHOR_ID };
        }

        if (entity === ChatChannelEntity) {
          return { name: 'General' };
        }

        return users.get(options.where.id) ?? null;
      },
    ) as AsyncMock;
    messages = { readableChannel: jest.fn(async () => ({})) };
    direct = {
      usable: jest.fn(async () => ({})),
      blockedFor: jest.fn(async () => new Set<string>()),
    };
    presence = {
      typingEnabled: jest.fn(async () => true),
      refresh: jest.fn(async () => undefined),
    };
    sockets = [];
    allLocal = [];
    personalEmit = jest.fn();
    fetchSockets = jest.fn(async () => sockets);
    server = {
      on: jest.fn(),
      serverSideEmit: jest.fn(),
      in: jest.fn(() => ({ emit: personalEmit })),
      local: {
        in: jest.fn(() => ({ fetchSockets })),
        fetchSockets: jest.fn(async () => allLocal),
      },
    };
    delivery = new ChatDeliveryService(
      { manager: { findOne } } as unknown as DataSource,
      messages as unknown as ChatMessageService,
      direct as unknown as ChatDirectService,
      presence as unknown as ChatPresenceService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const attached = (): void => {
    delivery.attach(server as unknown as Namespace);
  };

  describe('placeOfRoom', () => {
    it('reads a place from its room, and nothing from a person’s', () => {
      expect(placeOfRoom(`channel:${CHANNEL_ID}`)).toEqual({
        channelId: CHANNEL_ID,
      });
      expect(placeOfRoom(`conversation:${CONVERSATION_ID}`)).toEqual({
        conversationId: CONVERSATION_ID,
      });
      expect(placeOfRoom(`user:${READER_ID}`)).toBeNull();
    });
  });

  describe('blocks (FC-034)', () => {
    beforeEach(() => {
      attached();
    });

    it('shows a blocked author’s message as nobody and nothing', async () => {
      const reader = socketOf(READER_ID);

      direct.blockedFor.mockResolvedValue(new Set([AUTHOR_ID]));
      sockets = [reader];
      await delivery.publish({
        kind: 'message',
        place: { channelId: CHANNEL_ID },
        message: {
          ...MESSAGE,
          mentions: [{ userId: READER_ID, username: 'R' }],
        },
      });

      expect(reader.emit).toHaveBeenCalledWith(CHAT_SERVER_EVENTS.MESSAGE, {
        ...MESSAGE,
        author: null,
        body: null,
        clientMessageId: 'message',
        mine: false,
        hidden: true,
        mentions: [],
        replyTo: null,
      });
    });

    it('shows nothing of an answered message from a blocked author', async () => {
      const reader = socketOf(READER_ID);

      direct.blockedFor.mockResolvedValue(new Set(['blocked']));
      sockets = [reader];
      await delivery.publish({
        kind: 'message',
        place: { channelId: CHANNEL_ID },
        message: {
          ...MESSAGE,
          replyTo: {
            id: 'answered',
            author: { userId: 'blocked', username: 'B' },
            excerpt: 'Secret',
          },
        },
      });
      await delivery.publish({
        kind: 'message',
        place: { channelId: CHANNEL_ID },
        message: {
          ...MESSAGE,
          id: 'other',
          replyTo: { id: 'old', author: null, excerpt: null },
        },
      });

      expect(reader.emit).toHaveBeenNthCalledWith(
        1,
        CHAT_SERVER_EVENTS.MESSAGE,
        expect.objectContaining({
          replyTo: { id: 'answered', author: null, excerpt: null },
        }),
      );
      expect(reader.emit).toHaveBeenNthCalledWith(
        2,
        CHAT_SERVER_EVENTS.MESSAGE,
        expect.objectContaining({
          replyTo: { id: 'old', author: null, excerpt: null },
        }),
      );
    });

    it('trusts what it knows of blocks for a few seconds', async () => {
      jest.useFakeTimers({ now: new Date('2026-09-29T12:00:00Z') });

      await delivery.blockedFor(READER_ID);
      await delivery.blockedFor(READER_ID);
      expect(direct.blockedFor).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(CHAT_DELIVERY_CHECK_TTL_MS);
      await delivery.blockedFor(READER_ID);
      expect(direct.blockedFor).toHaveBeenCalledTimes(2);
    });
  });

  describe('typing (FC-034)', () => {
    const typing: ChatFanout = {
      kind: 'typing',
      place: { channelId: CHANNEL_ID },
      user: { userId: AUTHOR_ID, username: 'Kira' },
    };

    beforeEach(() => {
      attached();
    });

    it('tells readers who share typing, but not the writer, the blocked, or those with it off', async () => {
      const reader = socketOf(READER_ID);
      const writer = socketOf(AUTHOR_ID);
      const off = socketOf('off');
      const blocking = socketOf('blocking');

      users.set('off', { isAccountDisabled: false });
      users.set('blocking', { isAccountDisabled: false });
      presence.typingEnabled.mockImplementation(
        async (userId: unknown) => userId !== 'off',
      );
      direct.blockedFor.mockImplementation(
        async (userId: unknown) =>
          new Set(userId === 'blocking' ? [AUTHOR_ID] : []),
      );
      sockets = [reader, writer, off, blocking];
      await delivery.publish(typing);

      expect(reader.emit).toHaveBeenCalledWith(CHAT_SERVER_EVENTS.TYPING, {
        channelId: CHANNEL_ID,
        user: { userId: AUTHOR_ID, username: 'Kira' },
      });

      for (const quiet of [writer, off, blocking]) {
        expect(quiet.emit).not.toHaveBeenCalled();
      }

      expect(personalEmit).not.toHaveBeenCalled();
    });
  });

  describe('notices elsewhere on the site (FC-034)', () => {
    beforeEach(() => {
      attached();
    });

    it('tells the other person in a conversation, wherever they are', async () => {
      await delivery.publish({
        kind: 'message',
        place: { conversationId: CONVERSATION_ID },
        message: MESSAGE,
      });

      expect(server.in).toHaveBeenCalledWith(`user:${READER_ID}`);
      expect(personalEmit).toHaveBeenCalledWith(CHAT_SERVER_EVENTS.NOTICE, {
        kind: 'direct',
        conversationId: CONVERSATION_ID,
        from: MESSAGE.author,
      });
    });

    it('tells the other side when the lower-ID person writes', async () => {
      await delivery.publish({
        kind: 'message',
        place: { conversationId: CONVERSATION_ID },
        message: { ...MESSAGE, author: { userId: READER_ID, username: 'R' } },
      });

      expect(server.in).toHaveBeenCalledWith(`user:${AUTHOR_ID}`);
    });

    it('tells each person a channel message mentions, naming the channel', async () => {
      await delivery.publish({
        kind: 'message',
        place: { channelId: CHANNEL_ID },
        message: {
          ...MESSAGE,
          mentions: [
            { userId: READER_ID, username: 'R' },
            { userId: GONE_ID, username: 'G' },
          ],
        },
      });

      expect(server.in).toHaveBeenCalledWith(`user:${READER_ID}`);
      expect(server.in).toHaveBeenCalledWith(`user:${GONE_ID}`);
      expect(personalEmit).toHaveBeenCalledWith(CHAT_SERVER_EVENTS.NOTICE, {
        kind: 'mention',
        channelId: CHANNEL_ID,
        channelName: 'General',
        from: MESSAGE.author,
      });
    });

    it('tells nobody of a channel message that mentions nobody', async () => {
      await delivery.publish({
        kind: 'message',
        place: { channelId: CHANNEL_ID },
        message: MESSAGE,
      });

      expect(personalEmit).not.toHaveBeenCalled();
    });
  });

  describe('revoke (FC-034)', () => {
    it('does nothing before the gateway has started', async () => {
      await delivery.revoke({ kind: 'everyone' });

      expect(presence.refresh).not.toHaveBeenCalled();
    });

    it('has every instance check the people concerned again, and presence too', async () => {
      attached();

      const reader = socketOf(READER_ID, `channel:${CHANNEL_ID}`);

      sockets = [reader];
      await delivery.mayReceive(READER_ID, { channelId: CHANNEL_ID });
      messages.readableChannel.mockRejectedValue(new NotFoundException());
      await delivery.revoke({ kind: 'people', userIds: [READER_ID] });

      expect(server.serverSideEmit).toHaveBeenCalledWith(CHAT_REVOKE_EVENT, {
        kind: 'people',
        userIds: [READER_ID],
      });
      expect(server.local.in).toHaveBeenCalledWith(`user:${READER_ID}`);
      expect(reader.leave).toHaveBeenCalledWith(`channel:${CHANNEL_ID}`);
      expect(reader.emit).toHaveBeenCalledWith(CHAT_SERVER_EVENTS.REMOVED, {
        channelId: CHANNEL_ID,
      });
      expect(presence.refresh).toHaveBeenCalledWith([READER_ID]);
    });

    it('checks every socket here again for a change naming nobody, keeping what may still be read', async () => {
      attached();

      const reader = socketOf(
        READER_ID,
        `channel:${CHANNEL_ID}`,
        `conversation:${CONVERSATION_ID}`,
      );

      allLocal = [reader];
      direct.usable.mockRejectedValue(new NotFoundException());
      await delivery.revoke({ kind: 'everyone' });

      expect(reader.leave).toHaveBeenCalledTimes(1);
      expect(reader.leave).toHaveBeenCalledWith(
        `conversation:${CONVERSATION_ID}`,
      );
      expect(presence.refresh).not.toHaveBeenCalled();
    });

    it('checks again what another instance passes on, forgetting what it knew', async () => {
      attached();

      const reader = socketOf(READER_ID, `channel:${CHANNEL_ID}`);

      allLocal = [reader];
      await delivery.mayReceive(READER_ID, { channelId: CHANNEL_ID });
      await delivery.blockedFor(READER_ID);
      messages.readableChannel.mockRejectedValue(new NotFoundException());

      const handler = server.on.mock.calls.find(
        ([event]) => event === CHAT_REVOKE_EVENT,
      )?.[1] as (change: unknown) => void;

      handler({ kind: 'everyone' });
      await new Promise(resolve => setImmediate(resolve));

      expect(reader.leave).toHaveBeenCalledWith(`channel:${CHANNEL_ID}`);
      await delivery.blockedFor(READER_ID);
      expect(direct.blockedFor).toHaveBeenCalledTimes(2);
    });

    it('forgets only what it knew of the people a change names', async () => {
      attached();

      await delivery.mayReceive(READER_ID, { channelId: CHANNEL_ID });
      await delivery.mayReceive(AUTHOR_ID, { channelId: CHANNEL_ID });
      await delivery.revoke({ kind: 'people', userIds: [READER_ID] });
      messages.readableChannel.mockClear();

      await delivery.mayReceive(READER_ID, { channelId: CHANNEL_ID });
      await delivery.mayReceive(AUTHOR_ID, { channelId: CHANNEL_ID });

      expect(messages.readableChannel).toHaveBeenCalledTimes(1);
    });

    it('logs a check that fails', async () => {
      attached();

      const logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      server.local.fetchSockets.mockRejectedValue(new Error('adapter down'));
      await delivery.revoke({ kind: 'everyone' });

      expect(logged).toHaveBeenCalledWith(
        '[revoke] Chat access check failed',
        expect.any(String),
      );
      logged.mockRestore();
    });
  });

  // FC-044: under load every reader's answer runs out together; a message
  // must neither queue the database behind itself nor wait on one reader.
  describe('under load (FC-044)', () => {
    /**
     * A promise settled from outside.
     *
     * @returns It, and how to settle it.
     */
    const deferred = <T>() => {
      let settle: (value: T) => void = () => undefined;
      const promise = new Promise<T>(resolve => (settle = resolve));

      return { promise, settle };
    };

    it('looks a reader up once while several messages ask at once', async () => {
      const readable = deferred<object>();
      const blocks = deferred<Set<string>>();

      messages.readableChannel.mockReturnValue(readable.promise);
      direct.blockedFor.mockReturnValue(blocks.promise);

      const asked = [
        delivery.mayReceive(READER_ID, { channelId: CHANNEL_ID }),
        delivery.mayReceive(READER_ID, { channelId: CHANNEL_ID }),
      ];
      const blocked = [
        delivery.blockedFor(READER_ID),
        delivery.blockedFor(READER_ID),
      ];

      readable.settle({});
      blocks.settle(new Set());

      await expect(Promise.all(asked)).resolves.toEqual([true, true]);
      await expect(Promise.all(blocked)).resolves.toHaveLength(2);
      expect(messages.readableChannel).toHaveBeenCalledTimes(1);
      expect(direct.blockedFor).toHaveBeenCalledTimes(1);
    });

    it('keeps nothing it looked up across a change of access', async () => {
      attached();

      const readable = deferred<object>();
      const blocks = deferred<Set<string>>();

      messages.readableChannel.mockReturnValueOnce(readable.promise);
      direct.blockedFor.mockReturnValueOnce(blocks.promise);

      const asked = delivery.mayReceive(READER_ID, { channelId: CHANNEL_ID });
      const blocked = delivery.blockedFor(READER_ID);

      // Both lookups under way, past the account check, before the change.
      await new Promise(resolve => setImmediate(resolve));
      expect(messages.readableChannel).toHaveBeenCalledTimes(1);
      await delivery.revoke({ kind: 'people', userIds: [READER_ID] });
      readable.settle({});
      blocks.settle(new Set());
      await asked;
      await blocked;

      await delivery.mayReceive(READER_ID, { channelId: CHANNEL_ID });
      await delivery.blockedFor(READER_ID);

      expect(messages.readableChannel).toHaveBeenCalledTimes(2);
      expect(direct.blockedFor).toHaveBeenCalledTimes(2);
    });

    it('tells each reader without waiting for another being looked up', async () => {
      attached();

      const slow = deferred<object>();
      const waiting = socketOf(READER_ID);
      const quick = socketOf(AUTHOR_ID);

      sockets = [waiting, quick];
      messages.readableChannel.mockImplementation(
        async (_channelId: unknown, userId: unknown) =>
          userId === READER_ID ? slow.promise : {},
      );

      const delivering = delivery.deliverLocally({
        kind: 'message',
        place: { channelId: CHANNEL_ID },
        message: MESSAGE,
      } as never);

      await new Promise(resolve => setImmediate(resolve));

      expect(quick.emit).toHaveBeenCalledWith(
        CHAT_SERVER_EVENTS.MESSAGE,
        expect.objectContaining({ id: MESSAGE.id }),
      );
      expect(waiting.emit).not.toHaveBeenCalled();

      slow.settle({});
      await delivering;

      expect(waiting.emit).toHaveBeenCalledWith(
        CHAT_SERVER_EVENTS.MESSAGE,
        expect.objectContaining({ id: MESSAGE.id }),
      );
    });
  });

  describe('roomOf', () => {
    it('names a channel’s room and a conversation’s', () => {
      expect(roomOf({ channelId: CHANNEL_ID })).toBe(`channel:${CHANNEL_ID}`);
      expect(roomOf({ conversationId: CONVERSATION_ID })).toBe(
        `conversation:${CONVERSATION_ID}`,
      );
    });
  });

  describe('publish', () => {
    it('does nothing before the gateway has started', async () => {
      await delivery.publish({
        kind: 'deleted',
        place: { channelId: CHANNEL_ID },
        messageId: 'message',
        removed: false,
      });

      expect(server.serverSideEmit).not.toHaveBeenCalled();
    });

    it('passes it to the other instances and tells this one’s readers', async () => {
      attached();

      const reader = socketOf(READER_ID);
      const author = socketOf(AUTHOR_ID);
      const fanout: ChatFanout = {
        kind: 'message',
        place: { channelId: CHANNEL_ID },
        message: MESSAGE,
      };

      sockets = [reader, author];
      await delivery.publish(fanout);

      expect(server.serverSideEmit).toHaveBeenCalledWith(
        CHAT_FANOUT_EVENT,
        fanout,
      );
      expect(server.local.in).toHaveBeenCalledWith(`channel:${CHANNEL_ID}`);
      expect(reader.emit).toHaveBeenCalledWith(CHAT_SERVER_EVENTS.MESSAGE, {
        ...MESSAGE,
        mine: false,
      });
      expect(author.emit).toHaveBeenCalledWith(CHAT_SERVER_EVENTS.MESSAGE, {
        ...MESSAGE,
        mine: true,
      });
    });

    it('delivers what another instance passes on', async () => {
      attached();

      const reader = socketOf(READER_ID);
      const [event, handler] = server.on.mock.calls[0] as [
        string,
        (fanout: ChatFanout) => void,
      ];

      sockets = [reader];
      expect(event).toBe(CHAT_FANOUT_EVENT);
      handler({
        kind: 'message',
        place: { conversationId: CONVERSATION_ID },
        message: { ...MESSAGE, author: null },
      });
      await new Promise(resolve => setImmediate(resolve));

      expect(reader.emit).toHaveBeenCalledWith(
        CHAT_SERVER_EVENTS.MESSAGE,
        expect.objectContaining({ author: null, mine: false }),
      );
    });

    it.each([false, true])(
      'tells readers of a deletion, and whether it was a removal (%s)',
      async removed => {
        attached();

        const reader = socketOf(READER_ID);

        sockets = [reader];
        await delivery.publish({
          kind: 'deleted',
          place: { channelId: CHANNEL_ID },
          messageId: 'message',
          removed,
        });

        expect(reader.emit).toHaveBeenCalledWith(CHAT_SERVER_EVENTS.DELETED, {
          channelId: CHANNEL_ID,
          messageId: 'message',
          removed,
        });
      },
    );

    it('sends away a reader who may no longer read the place', async () => {
      attached();

      const gone = socketOf(GONE_ID);
      const left = socketOf(READER_ID);

      messages.readableChannel.mockRejectedValue(new NotFoundException());
      sockets = [gone, left];
      await delivery.publish({
        kind: 'message',
        place: { channelId: CHANNEL_ID },
        message: MESSAGE,
      });

      for (const socket of [gone, left]) {
        expect(socket.leave).toHaveBeenCalledWith(`channel:${CHANNEL_ID}`);
        expect(socket.emit).toHaveBeenCalledWith(CHAT_SERVER_EVENTS.REMOVED, {
          channelId: CHANNEL_ID,
        });
        expect(socket.emit).not.toHaveBeenCalledWith(
          CHAT_SERVER_EVENTS.MESSAGE,
          expect.anything(),
        );
      }
    });

    it('logs a delivery that fails, and tells nobody', async () => {
      attached();

      const logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const reader = socketOf(READER_ID);

      sockets = [reader];
      messages.readableChannel.mockRejectedValue(new Error('database down'));
      await delivery.publish({
        kind: 'message',
        place: { channelId: CHANNEL_ID },
        message: MESSAGE,
      });

      expect(reader.emit).not.toHaveBeenCalled();
      expect(logged).toHaveBeenCalledWith(
        `[deliver] Chat delivery failed - Room: channel:${CHANNEL_ID}`,
        expect.any(String),
      );
      logged.mockRestore();
    });
  });

  describe('mayReceive', () => {
    it('asks whether a friend may still use the conversation', async () => {
      await expect(
        delivery.mayReceive(READER_ID, { conversationId: CONVERSATION_ID }),
      ).resolves.toBe(true);
      direct.usable.mockRejectedValue(new NotFoundException());
      await expect(
        delivery.mayReceive(AUTHOR_ID, { conversationId: CONVERSATION_ID }),
      ).resolves.toBe(false);
    });

    it('trusts an answer for a few seconds, then asks again', async () => {
      jest.useFakeTimers({ now: new Date('2026-09-28T12:00:00Z') });

      await delivery.mayReceive(READER_ID, { channelId: CHANNEL_ID });
      await delivery.mayReceive(READER_ID, { channelId: CHANNEL_ID });
      expect(messages.readableChannel).toHaveBeenCalledTimes(1);
      expect(findOne).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(CHAT_DELIVERY_CHECK_TTL_MS);
      await delivery.mayReceive(READER_ID, { channelId: CHANNEL_ID });
      expect(messages.readableChannel).toHaveBeenCalledTimes(2);
    });
  });

  describe('isConnected', () => {
    it('says nobody is connected before the gateway has started', async () => {
      await expect(delivery.isConnected(READER_ID)).resolves.toBe(false);
    });

    it('asks every instance for the person’s sockets', async () => {
      const personal = jest.fn(async () => [socketOf(READER_ID)]);

      server.in.mockReturnValue({ fetchSockets: personal });
      attached();

      await expect(delivery.isConnected(READER_ID)).resolves.toBe(true);
      expect(server.in).toHaveBeenCalledWith(`user:${READER_ID}`);
      personal.mockResolvedValue([]);
      await expect(delivery.isConnected(READER_ID)).resolves.toBe(false);
    });
  });

  describe('isActive', () => {
    it('knows a missing, a disabled and a live account', async () => {
      await expect(delivery.isActive('nobody')).resolves.toBe(false);
      await expect(delivery.isActive(GONE_ID)).resolves.toBe(false);
      await expect(delivery.isActive(READER_ID)).resolves.toBe(true);
      expect(findOne).toHaveBeenCalledWith(UserEntity, {
        where: { id: READER_ID },
        select: { id: true, isAccountDisabled: true },
      });
    });

    it('clears stale answers once it holds thousands', async () => {
      jest.useFakeTimers({ now: new Date('2026-09-28T12:00:00Z') });

      for (let index = 0; index < 4_999; index += 1) {
        await delivery.isActive(`old-${index}`);
      }

      jest.advanceTimersByTime(CHAT_DELIVERY_CHECK_TTL_MS);
      await delivery.isActive(READER_ID);
      await delivery.isActive(AUTHOR_ID);
      findOne.mockClear();

      // The fresh answer stayed; the stale ones went.
      await delivery.isActive(READER_ID);
      await delivery.isActive('old-1');
      expect(findOne).toHaveBeenCalledTimes(1);
    });
  });
});
