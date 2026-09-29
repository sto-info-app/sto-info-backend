import {
  ForbiddenException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Namespace, Socket } from 'socket.io';

import { FLEET_FEATURE_FLAGS } from '../../constants/fleet-feature.constants';
import { FleetFeatureService } from '../../fleet-feature.service';
import { ChatMessageService } from '../services/chat-message.service';
import { ChatDeliveryService } from './chat-delivery.service';
import { ChatPresenceService } from './chat-presence.service';
import { ChatSocketAuthService } from './chat-socket-auth.service';
import {
  CHAT_AUTH_TIMEOUT_MS,
  CHAT_SERVER_EVENTS,
  CHAT_SOCKETS_PER_PERSON,
} from './chat-socket.constants';
import { ChatGateway } from './chat.gateway';

const USER_ID = '32000000-0000-4000-8000-000000000001';
const OTHER_ID = '32000000-0000-4000-8000-000000000002';
const CHANNEL_ID = '32000000-0000-4000-8000-0000000000c1';
const CONVERSATION_ID = '32000000-0000-4000-8000-0000000000d1';
const CLIENT_ID = '32000000-0000-4000-8000-0000000000e1';
const CURSOR = `2026-09-28T12:00:00.000Z_${CLIENT_ID}`;
const NOW = new Date('2026-09-28T12:00:00Z').getTime();
const PAGE = { messages: [], before: null };
const MESSAGE = { id: 'message' };

/** A mocked asynchronous call. */
type AsyncMock = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

/** A socket as the gateway sees it. */
interface FakeSocket {
  id: string;
  data: Record<string, unknown>;
  rooms: Set<string>;
  join: AsyncMock;
  leave: AsyncMock;
  emit: jest.Mock;
  disconnect: jest.Mock;
}

/**
 * A socket.
 *
 * @param id - Its ID.
 * @param data - What it carries.
 * @returns The socket.
 */
const socketOf = (
  id: string,
  data: Record<string, unknown> = {},
): FakeSocket => ({
  id,
  data,
  rooms: new Set([id]),
  join: jest.fn(async () => undefined),
  leave: jest.fn(async () => undefined),
  emit: jest.fn(),
  disconnect: jest.fn(),
});

describe('ChatGateway', () => {
  let featureService: { assertFlagEnabled: AsyncMock };
  let auth: { identify: AsyncMock };
  let messages: Record<
    'readChannel' | 'readConversation' | 'postToChannel' | 'postToConversation',
    AsyncMock
  >;
  let delivery: {
    attach: jest.Mock;
    publish: AsyncMock;
    isActive: AsyncMock;
  };
  let presence: Record<'touch' | 'leave' | 'typingEnabled', AsyncMock>;
  let others: FakeSocket[];
  let server: { in: jest.Mock };
  let gateway: ChatGateway;
  let socket: FakeSocket;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    featureService = { assertFlagEnabled: jest.fn(async () => undefined) };
    auth = {
      identify: jest.fn(async () => ({
        userId: USER_ID,
        username: 'Kira',
        expiresAt: NOW + 60_000,
      })),
    };
    messages = {
      readChannel: jest.fn(async () => PAGE),
      readConversation: jest.fn(async () => PAGE),
      postToChannel: jest.fn(async () => MESSAGE),
      postToConversation: jest.fn(async () => MESSAGE),
    };
    delivery = {
      attach: jest.fn(),
      publish: jest.fn(async () => undefined),
      isActive: jest.fn(async () => true),
    };
    presence = {
      touch: jest.fn(async () => undefined),
      leave: jest.fn(async () => undefined),
      typingEnabled: jest.fn(async () => true),
    };
    others = [];
    server = { in: jest.fn(() => ({ fetchSockets: async () => others })) };
    gateway = new ChatGateway(
      featureService as unknown as FleetFeatureService,
      auth as unknown as ChatSocketAuthService,
      messages as unknown as ChatMessageService,
      delivery as unknown as ChatDeliveryService,
      presence as unknown as ChatPresenceService,
    );
    gateway.server = server as unknown as Namespace;
    socket = socketOf('socket');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const asSocket = (fake: FakeSocket): Socket => fake as unknown as Socket;

  /** Signs the socket in. */
  const signIn = async (): Promise<void> => {
    others = [socket];
    await gateway.auth(asSocket(socket), { token: 'token' });
  };

  it('starts delivery once the namespace is up', () => {
    const namespace = {} as Namespace;

    gateway.afterInit(namespace);

    expect(delivery.attach).toHaveBeenCalledWith(namespace);
  });

  describe('connecting', () => {
    it('closes a socket that does not say who it is in time', () => {
      gateway.handleConnection(asSocket(socket));

      expect(socket.data.connectedAt).toBe(NOW);
      jest.advanceTimersByTime(CHAT_AUTH_TIMEOUT_MS - 1);
      expect(socket.disconnect).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('forgets a socket’s timer when it goes', async () => {
      gateway.handleConnection(asSocket(socket));
      await gateway.handleDisconnect(asSocket(socket));
      jest.advanceTimersByTime(CHAT_AUTH_TIMEOUT_MS);

      expect(socket.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('auth', () => {
    it('names the socket, joins its person’s room, and closes it when the token runs out', async () => {
      gateway.handleConnection(asSocket(socket));
      others = [socket];

      await expect(
        gateway.auth(asSocket(socket), { token: 'token' }),
      ).resolves.toEqual({
        ok: true,
        data: { userId: USER_ID, expiresAt: NOW + 60_000 },
      });
      expect(auth.identify).toHaveBeenCalledWith('token');
      expect(socket.join).toHaveBeenCalledWith(`user:${USER_ID}`);
      expect(featureService.assertFlagEnabled).toHaveBeenCalledWith(
        FLEET_FEATURE_FLAGS.CHAT_ENABLED,
      );

      // Saying who it is replaced the five-second timer.
      jest.advanceTimersByTime(CHAT_AUTH_TIMEOUT_MS);
      expect(socket.disconnect).not.toHaveBeenCalled();

      jest.advanceTimersByTime(60_000);
      expect(socket.emit).toHaveBeenCalledWith(CHAT_SERVER_EVENTS.EXPIRED);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('takes a fresh token for the same person, keeping the socket open longer', async () => {
      await signIn();
      auth.identify.mockResolvedValue({
        userId: USER_ID,
        expiresAt: NOW + 120_000,
      });

      await gateway.auth(asSocket(socket), { token: 'fresh' });
      jest.advanceTimersByTime(60_000);

      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(socket.join).toHaveBeenCalledTimes(1);
      expect(socket.data.expiresAt).toBe(NOW + 120_000);
    });

    it('closes a socket that shows somebody else’s token', async () => {
      await signIn();
      auth.identify.mockResolvedValue({
        userId: OTHER_ID,
        expiresAt: NOW + 60_000,
      });

      await expect(
        gateway.auth(asSocket(socket), { token: 'theirs' }),
      ).resolves.toEqual({
        ok: false,
        error: { status: 401, message: 'That token is somebody else’s.' },
      });
      expect(socket.disconnect).not.toHaveBeenCalled();
      jest.advanceTimersByTime(0);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.data.userId).toBe(USER_ID);
    });

    it('answers a bad token or none as unauthorised', async () => {
      auth.identify.mockRejectedValue(
        new UnauthorizedException('Sign in to use chat.'),
      );

      await expect(gateway.auth(asSocket(socket), null)).resolves.toEqual({
        ok: false,
        error: { status: 401, message: 'Sign in to use chat.' },
      });
      expect(auth.identify).toHaveBeenCalledWith(undefined);
      expect(socket.data.userId).toBeUndefined();
    });

    it('answers not found while chat is off', async () => {
      featureService.assertFlagEnabled.mockRejectedValue(
        new NotFoundException('Not found'),
      );

      await expect(
        gateway.auth(asSocket(socket), { token: 'token' }),
      ).resolves.toMatchObject({ ok: false, error: { status: 404 } });
      expect(auth.identify).not.toHaveBeenCalled();
    });
  });

  describe('presence (FC-034)', () => {
    it('puts the person online when they first say who they are', async () => {
      await signIn();

      expect(presence.touch).toHaveBeenCalledWith(USER_ID);
      expect(socket.data.username).toBe('Kira');
    });

    it('keeps them online on each heartbeat', async () => {
      await signIn();
      presence.touch.mockClear();

      await expect(gateway.heartbeat(asSocket(socket))).resolves.toEqual({
        ok: true,
        data: null,
      });
      expect(presence.touch).toHaveBeenCalledWith(USER_ID);
    });

    it('takes them offline when their last socket goes, and not before', async () => {
      await signIn();
      others = [socketOf('another')];
      await gateway.handleDisconnect(asSocket(socket));
      expect(presence.leave).not.toHaveBeenCalled();

      others = [];
      await gateway.handleDisconnect(asSocket(socket));
      expect(presence.leave).toHaveBeenCalledWith(USER_ID);
    });

    it('knows nobody for a socket that never said who it is', async () => {
      await gateway.handleDisconnect(asSocket(socket));

      expect(server.in).not.toHaveBeenCalled();
    });
  });

  describe('typing (FC-034)', () => {
    it('tells a joined place its person is writing', async () => {
      await signIn();
      socket.rooms.add(`channel:${CHANNEL_ID}`);

      await expect(
        gateway.typing(asSocket(socket), { channelId: CHANNEL_ID }),
      ).resolves.toEqual({ ok: true, data: null });
      expect(delivery.publish).toHaveBeenCalledWith({
        kind: 'typing',
        place: { channelId: CHANNEL_ID },
        user: { userId: USER_ID, username: 'Kira' },
      });
    });

    it('names nobody for a person without a username', async () => {
      auth.identify.mockResolvedValue({
        userId: USER_ID,
        username: undefined,
        expiresAt: NOW + 60_000,
      });
      await signIn();
      socket.rooms.add(`channel:${CHANNEL_ID}`);

      await gateway.typing(asSocket(socket), { channelId: CHANNEL_ID });

      expect(delivery.publish).toHaveBeenCalledWith(
        expect.objectContaining({ user: { userId: USER_ID, username: null } }),
      );
    });

    it('tells nobody of a place not joined, or while typing is off', async () => {
      await signIn();

      await gateway.typing(asSocket(socket), { channelId: CHANNEL_ID });
      socket.rooms.add(`channel:${CHANNEL_ID}`);
      presence.typingEnabled.mockResolvedValue(false);
      await gateway.typing(asSocket(socket), { channelId: CHANNEL_ID });

      expect(delivery.publish).not.toHaveBeenCalled();
    });
  });

  describe('limit', () => {
    it('pushes out the oldest sockets past five', async () => {
      others = Array.from({ length: CHAT_SOCKETS_PER_PERSON + 2 }, (_, index) =>
        socketOf(`socket-${index}`, { connectedAt: NOW - index }),
      );

      await gateway.limit(USER_ID);

      expect(server.in).toHaveBeenCalledWith(`user:${USER_ID}`);

      const pushed = others.filter(each => each.disconnect.mock.calls.length);

      expect(pushed.map(each => each.id)).toEqual(['socket-5', 'socket-6']);
      expect(pushed[0].emit).toHaveBeenCalledWith(CHAT_SERVER_EVENTS.REPLACED);
    });

    it('leaves five alone', async () => {
      others = Array.from({ length: CHAT_SOCKETS_PER_PERSON }, (_, index) =>
        socketOf(`socket-${index}`, { connectedAt: NOW - index }),
      );

      await gateway.limit(USER_ID);

      expect(others.some(each => each.disconnect.mock.calls.length)).toBe(
        false,
      );
    });
  });

  describe('join', () => {
    it('refuses a socket that has not said who it is', async () => {
      await expect(
        gateway.join(asSocket(socket), { channelId: CHANNEL_ID }),
      ).resolves.toMatchObject({ ok: false, error: { status: 401 } });
    });

    it('refuses a socket whose token has run out', async () => {
      await signIn();
      socket.data.expiresAt = NOW;

      await expect(
        gateway.join(asSocket(socket), { channelId: CHANNEL_ID }),
      ).resolves.toMatchObject({ ok: false, error: { status: 401 } });
    });

    it('refuses an account no longer in use', async () => {
      await signIn();
      delivery.isActive.mockResolvedValue(false);

      await expect(
        gateway.join(asSocket(socket), { channelId: CHANNEL_ID }),
      ).resolves.toMatchObject({ ok: false, error: { status: 401 } });
      expect(delivery.isActive).toHaveBeenCalledWith(USER_ID);
    });

    it.each([
      ['a channel that is no ID', { channelId: 'general' }],
      ['a cursor that is no cursor', { channelId: CHANNEL_ID, after: 'then' }],
      ['nothing', undefined],
      [
        'both places',
        { channelId: CHANNEL_ID, conversationId: CONVERSATION_ID },
      ],
    ])('refuses %s', async (_label, body) => {
      await signIn();

      await expect(gateway.join(asSocket(socket), body)).resolves.toMatchObject(
        { ok: false, error: { status: 400 } },
      );
      expect(socket.join).toHaveBeenCalledTimes(1);
    });

    it('joins a channel and reads what came after the cursor', async () => {
      await signIn();

      await expect(
        gateway.join(asSocket(socket), {
          channelId: CHANNEL_ID,
          after: CURSOR,
        }),
      ).resolves.toEqual({ ok: true, data: PAGE });
      expect(socket.join).toHaveBeenCalledWith(`channel:${CHANNEL_ID}`);
      expect(messages.readChannel).toHaveBeenCalledWith(CHANNEL_ID, USER_ID, {
        after: CURSOR,
      });
    });

    it('joins a conversation and reads its latest page', async () => {
      await signIn();

      await gateway.join(asSocket(socket), { conversationId: CONVERSATION_ID });

      expect(socket.join).toHaveBeenCalledWith(
        `conversation:${CONVERSATION_ID}`,
      );
      expect(messages.readConversation).toHaveBeenCalledWith(
        CONVERSATION_ID,
        USER_ID,
        {},
      );
    });

    it('leaves the room again when the place may not be read', async () => {
      await signIn();
      messages.readChannel.mockRejectedValue(
        new NotFoundException('Not found'),
      );

      await expect(
        gateway.join(asSocket(socket), { channelId: CHANNEL_ID }),
      ).resolves.toMatchObject({ ok: false, error: { status: 404 } });
      expect(socket.leave).toHaveBeenCalledWith(`channel:${CHANNEL_ID}`);
    });
  });

  describe('leave', () => {
    it('leaves a place’s room', async () => {
      await signIn();

      await expect(
        gateway.leave(asSocket(socket), { conversationId: CONVERSATION_ID }),
      ).resolves.toEqual({ ok: true, data: null });
      expect(socket.leave).toHaveBeenCalledWith(
        `conversation:${CONVERSATION_ID}`,
      );
    });
  });

  describe('send', () => {
    const post = { body: '  Hail  ', clientMessageId: CLIENT_ID };

    it('posts in a channel, acknowledges the committed message, then tells its readers', async () => {
      await signIn();

      await expect(
        gateway.send(asSocket(socket), { ...post, channelId: CHANNEL_ID }),
      ).resolves.toEqual({ ok: true, data: MESSAGE });
      expect(messages.postToChannel).toHaveBeenCalledWith(CHANNEL_ID, USER_ID, {
        body: 'Hail',
        clientMessageId: CLIENT_ID,
      });
      expect(delivery.publish).toHaveBeenCalledWith({
        kind: 'message',
        place: { channelId: CHANNEL_ID },
        message: MESSAGE,
      });
    });

    it('posts in a conversation', async () => {
      await signIn();

      await gateway.send(asSocket(socket), {
        ...post,
        conversationId: CONVERSATION_ID,
      });

      expect(messages.postToConversation).toHaveBeenCalledWith(
        CONVERSATION_ID,
        USER_ID,
        { body: 'Hail', clientMessageId: CLIENT_ID },
      );
    });

    it('acknowledges a refusal without telling anybody', async () => {
      await signIn();
      messages.postToChannel.mockRejectedValue(
        new ForbiddenException('You cannot post in this channel.'),
      );

      await expect(
        gateway.send(asSocket(socket), { ...post, channelId: CHANNEL_ID }),
      ).resolves.toEqual({
        ok: false,
        error: { status: 403, message: 'You cannot post in this channel.' },
      });
      expect(delivery.publish).not.toHaveBeenCalled();
    });

    it('answers an unexpected failure as a server error, logging no payload', async () => {
      const logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await signIn();
      messages.postToChannel.mockRejectedValue(new Error('database down'));

      await expect(
        gateway.send(asSocket(socket), { ...post, channelId: CHANNEL_ID }),
      ).resolves.toEqual({
        ok: false,
        error: { status: 500, message: 'Something went wrong.' },
      });
      expect(logged).toHaveBeenCalledWith(
        '[chat] Socket event failed',
        expect.any(String),
      );
      expect(JSON.stringify(logged.mock.calls)).not.toContain('Hail');
      logged.mockRestore();
    });
  });

  describe('schedule', () => {
    it('runs at once when the moment has passed', () => {
      const then = jest.fn();

      gateway.schedule(asSocket(socket), -1_000, then);
      jest.advanceTimersByTime(0);

      expect(then).toHaveBeenCalled();
    });
  });
});
