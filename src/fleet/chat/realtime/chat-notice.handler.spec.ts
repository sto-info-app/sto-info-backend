import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { NotificationSeverity } from 'src/notification/enums/notification-severity.enum';
import { NotificationOutboxKind } from 'src/notification/outbox/notification-outbox-kind.enum';
import { NotificationOutboxEntity } from 'src/notification/outbox/notification-outbox.entity';
import { NotificationOutboxRegistry } from 'src/notification/outbox/notification-outbox.registry';

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
  seedChannel,
  seedMessage,
  STRANGER_ID,
} from '../../../../test/chat-world';
import { Row } from '../../../../test/in-memory-manager';
import { ChatDirectConversationEntity } from '../entities/chat-direct-conversation.entity';
import { ChatDeliveryService } from './chat-delivery.service';
import { ChatNoticeHandler } from './chat-notice.handler';

const MESSAGE_ID = '33000000-0000-4000-8000-000000000001';
const SITE = 'https://startrekonline.info';

describe('ChatNoticeHandler', () => {
  let world: ChatWorld;
  let registry: { register: jest.Mock };
  let delivery: {
    isConnected: jest.Mock<(userId: string) => Promise<boolean>>;
  };
  let handler: ChatNoticeHandler;
  const site = process.env.APP_FRONTEND_URL;

  beforeEach(() => {
    process.env.APP_FRONTEND_URL = SITE;
    world = chatWorld();
    seedChannel(world.db);
    world.stand(MEMBER_ID, FLEET_ID, MEMBER);
    world.stand(MODERATOR_ID, FLEET_ID, MODERATOR);
    registry = { register: jest.fn() };
    delivery = { isConnected: jest.fn(async () => false) };
    handler = new ChatNoticeHandler(
      registry as unknown as NotificationOutboxRegistry,
      world.messages,
      world.direct,
      delivery as unknown as ChatDeliveryService,
    );
  });

  afterEach(() => {
    process.env.APP_FRONTEND_URL = site;
  });

  /**
   * Composes a notice for somebody.
   *
   * @param kind - Which.
   * @param userId - Who.
   * @returns What it would say.
   */
  const compose = (kind: NotificationOutboxKind, userId = MODERATOR_ID) =>
    handler.compose(
      { kind, userId, subjectId: MESSAGE_ID } as NotificationOutboxEntity,
      world.db.asManager(),
    );

  it('registers with the outbox for chat’s three kinds', () => {
    handler.onModuleInit();

    expect(registry.register).toHaveBeenCalledWith(handler);
    expect(handler.kinds).toEqual([
      NotificationOutboxKind.CHAT_MENTION,
      NotificationOutboxKind.CHAT_REPLY,
      NotificationOutboxKind.CHAT_DIRECT_MESSAGE,
    ]);
  });

  describe('in a channel', () => {
    beforeEach(() => {
      seedMessage(world.db, { id: MESSAGE_ID });
    });

    it('says who mentioned them, where, without quoting the message', async () => {
      await expect(
        compose(NotificationOutboxKind.CHAT_MENTION),
      ).resolves.toEqual({
        title: 'Member mentioned you in General (Fixture Fleet)',
        body: 'Open the channel to read it; chat keeps the last four hours.',
        severity: NotificationSeverity.INFO,
        linkUrl: `${SITE}/chat/channels/${CHANNEL_ID}`,
      });
    });

    it('says who replied, with no link when the site’s address is unknown', async () => {
      delete process.env.APP_FRONTEND_URL;

      await expect(
        compose(NotificationOutboxKind.CHAT_REPLY),
      ).resolves.toMatchObject({
        title: 'Member replied to you in General (Fixture Fleet)',
        linkUrl: null,
      });
    });

    it('names the channel alone when its scope has gone, and the author as Somebody', async () => {
      seedChannel(world.db, { id: 'orphan', communityId: 'gone' });
      seedMessage(world.db, {
        id: 'orphaned',
        channelId: 'orphan',
        authorUserId: null,
      });

      await expect(
        handler.compose(
          {
            kind: NotificationOutboxKind.CHAT_MENTION,
            userId: MODERATOR_ID,
            subjectId: 'orphaned',
          } as NotificationOutboxEntity,
          world.db.asManager(),
        ),
      ).resolves.toMatchObject({ title: 'Somebody mentioned you in General' });
    });

    it('sets aside a notice once the author is across a block from them', async () => {
      world.block(MODERATOR_ID, MEMBER_ID);

      await expect(
        compose(NotificationOutboxKind.CHAT_MENTION),
      ).resolves.toBeNull();
    });

    it('sets aside a notice for somebody who can no longer read the channel', async () => {
      await expect(
        compose(NotificationOutboxKind.CHAT_MENTION, STRANGER_ID),
      ).resolves.toBeNull();
    });

    it('passes on a failure that is not a refusal', async () => {
      jest
        .spyOn(world.messages, 'readableChannel')
        .mockRejectedValue(new Error('database down'));

      await expect(
        compose(NotificationOutboxKind.CHAT_MENTION),
      ).rejects.toThrow('database down');
    });
  });

  it.each([
    ['missing', null],
    ['deleted', { deletedAt: new Date() }],
    [
      'older than the window',
      { createdAt: new Date(Date.now() - 5 * 3_600_000) },
    ],
  ])('sets aside a notice for a message that is %s', async (_label, row) => {
    if (row !== null) {
      seedMessage(world.db, { id: MESSAGE_ID, ...row });
    }

    await expect(
      compose(NotificationOutboxKind.CHAT_MENTION),
    ).resolves.toBeNull();
  });

  describe('a direct message', () => {
    let conversationId: string;

    beforeEach(async () => {
      world.befriend(MEMBER_ID, FRIEND_ID);
      conversationId = (await world.direct.open(MEMBER_ID, FRIEND_ID)).id;
      seedMessage(world.db, {
        id: MESSAGE_ID,
        channelId: null,
        conversationId,
      });
    });

    const conversation = (): Row =>
      world.db.rows<Row>(ChatDirectConversationEntity)[0];

    it('tells a friend who has no chat open', async () => {
      await expect(
        compose(NotificationOutboxKind.CHAT_DIRECT_MESSAGE, FRIEND_ID),
      ).resolves.toEqual({
        title: 'Member sent you a message',
        body: 'Member wrote to you in chat. Open the conversation to read it; chat keeps the last four hours.',
        severity: NotificationSeverity.INFO,
        linkUrl: `${SITE}/chat/direct/${conversationId}`,
      });
    });

    it('tells nobody with chat open, and is ready to tell them next time', async () => {
      delivery.isConnected.mockResolvedValue(true);
      conversation().highNoticedAt = new Date();

      await expect(
        compose(NotificationOutboxKind.CHAT_DIRECT_MESSAGE, FRIEND_ID),
      ).resolves.toBeNull();
      expect(conversation().highNoticedAt).toBeNull();
    });

    it('sets aside a notice once they are no longer friends', async () => {
      world.unfriend(MEMBER_ID, FRIEND_ID);

      await expect(
        compose(NotificationOutboxKind.CHAT_DIRECT_MESSAGE, FRIEND_ID),
      ).resolves.toBeNull();
    });

    it('has no link when the site’s address is unknown', async () => {
      delete process.env.APP_FRONTEND_URL;

      await expect(
        compose(NotificationOutboxKind.CHAT_DIRECT_MESSAGE, FRIEND_ID),
      ).resolves.toMatchObject({ linkUrl: null });
    });
  });
});
