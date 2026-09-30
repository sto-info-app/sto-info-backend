import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';

import { beforeEach, describe, expect, it } from '@jest/globals';
import { QueryFailedError } from 'typeorm';

import { NotificationOutboxKind } from 'src/notification/outbox/notification-outbox-kind.enum';
import { NotificationOutboxEntity } from 'src/notification/outbox/notification-outbox.entity';

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
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { ChatActionEntity } from '../entities/chat-action.entity';
import { ChatDirectConversationEntity } from '../entities/chat-direct-conversation.entity';
import { ChatMessageEntity } from '../entities/chat-message.entity';
import { ChatActionKind } from '../enums/chat.enums';
import { ModerationHoldEntity } from '../holds/moderation-hold.entity';
import { ModerationHoldKind } from '../holds/moderation-hold.enums';
import {
  CHAT_PAGE_SIZE,
  CHAT_RATE_LIMIT,
  cursorOf,
} from './chat-message.service';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

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

describe('ChatMessageService', () => {
  let world: ChatWorld;

  beforeEach(() => {
    world = chatWorld();
    seedChannel(world.db);
    world.stand(MEMBER_ID, FLEET_ID, MEMBER);
    world.stand(MODERATOR_ID, FLEET_ID, MODERATOR);
  });

  /**
   * The conversation between the member and their friend.
   *
   * @returns Its ID.
   */
  const conversation = async (): Promise<string> => {
    world.befriend(MEMBER_ID, FRIEND_ID);

    return (await world.direct.open(MEMBER_ID, FRIEND_ID)).id;
  };

  describe('readChannel', () => {
    it('hides a channel that does not exist or they may not read', async () => {
      await expect(
        world.messages.readChannel('missing', MEMBER_ID, {}),
      ).rejects.toThrow(NotFoundException);
      await expect(
        world.messages.readChannel(CHANNEL_ID, STRANGER_ID, {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('reads the last four hours, oldest first', async () => {
      seedMessage(world.db, { id: idOf(1), createdAt: ago(5 * HOUR) });
      seedMessage(world.db, { id: idOf(3), createdAt: ago(MINUTE) });
      seedMessage(world.db, {
        id: idOf(2),
        createdAt: ago(2 * HOUR),
        authorUserId: null,
      });

      const page = await world.messages.readChannel(CHANNEL_ID, MEMBER_ID, {});

      expect(page.before).toBeNull();
      expect(page.messages).toEqual([
        expect.objectContaining({ id: idOf(2), author: null, mine: false }),
        expect.objectContaining({
          id: idOf(3),
          author: { userId: MEMBER_ID, username: 'Member' },
          body: 'Hello',
          deleted: false,
          mine: true,
        }),
      ]);
    });

    describe('a full page', () => {
      beforeEach(() => {
        for (let index = 1; index <= CHAT_PAGE_SIZE + 1; index += 1) {
          seedMessage(world.db, {
            id: idOf(index),
            createdAt: ago((CHAT_PAGE_SIZE + 2 - index) * MINUTE),
          });
        }
      });

      it('gives a cursor for the older ones', async () => {
        const page = await world.messages.readChannel(
          CHANNEL_ID,
          MEMBER_ID,
          {},
        );

        expect(page.messages).toHaveLength(CHAT_PAGE_SIZE);
        expect(page.messages[0].id).toBe(idOf(2));
        expect(page.before).toBe(cursorOf(page.messages[0]));

        const older = await world.messages.readChannel(CHANNEL_ID, MEMBER_ID, {
          before: page.before as string,
        });

        expect(older).toEqual({
          messages: [expect.objectContaining({ id: idOf(1) })],
          before: null,
        });
      });

      it('reads the newer ones after a cursor, with no cursor back', async () => {
        const first = (
          await world.messages.readChannel(CHANNEL_ID, MEMBER_ID, {})
        ).messages[0];
        const page = await world.messages.readChannel(CHANNEL_ID, MEMBER_ID, {
          after: cursorOf({ id: idOf(1), createdAt: ago(0) }),
        });

        expect(page).toEqual({ messages: [], before: null });

        const newer = await world.messages.readChannel(CHANNEL_ID, MEMBER_ID, {
          after: cursorOf(first),
        });

        expect(newer.messages[0].id).toBe(idOf(3));
        expect(newer.messages).toHaveLength(CHAT_PAGE_SIZE - 1);
      });
    });

    it('carries on past messages posted at the same instant', async () => {
      const at = ago(MINUTE);

      seedMessage(world.db, { id: idOf(1), createdAt: at });
      seedMessage(world.db, { id: idOf(2), createdAt: at });

      const page = await world.messages.readChannel(CHANNEL_ID, MEMBER_ID, {
        before: cursorOf({ id: idOf(2), createdAt: at }),
      });

      expect(page.messages.map(message => message.id)).toEqual([idOf(1)]);
    });

    it('reads nothing older than the window, even by cursor', async () => {
      const at = ago(5 * HOUR);

      seedMessage(world.db, { id: idOf(1), createdAt: at });
      seedMessage(world.db, { id: idOf(2), createdAt: at });

      const page = await world.messages.readChannel(CHANNEL_ID, MEMBER_ID, {
        before: cursorOf({ id: idOf(2), createdAt: at }),
      });

      expect(page.messages).toEqual([]);
    });

    it('finds words literally, leaving out deleted messages', async () => {
      seedMessage(world.db, { id: idOf(1), body: 'Meet at 100% power' });
      seedMessage(world.db, { id: idOf(2), body: 'Meet at 1000 power' });
      seedMessage(world.db, {
        id: idOf(3),
        body: 'At 100% again',
        deletedAt: new Date(),
      });

      const page = await world.messages.readChannel(CHANNEL_ID, MEMBER_ID, {
        q: '100%',
      });

      expect(page.messages.map(message => message.id)).toEqual([idOf(1)]);
    });
  });

  describe('readConversation', () => {
    it('reads a conversation its two may use', async () => {
      const id = await conversation();

      seedMessage(world.db, {
        id: idOf(1),
        channelId: null,
        conversationId: id,
        authorUserId: FRIEND_ID,
      });

      const page = await world.messages.readConversation(id, MEMBER_ID, {});

      expect(page.messages).toEqual([
        expect.objectContaining({ conversationId: id, mine: false }),
      ]);
      await expect(
        world.messages.readConversation(id, STRANGER_ID, {}),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('readOne', () => {
    it('reads a message in the window, and a deleted one without its text', async () => {
      seedMessage(world.db, { id: idOf(1), deletedAt: new Date() });

      await expect(
        world.messages.readOne(idOf(1), MODERATOR_ID),
      ).resolves.toMatchObject({ id: idOf(1), body: null, deleted: true });
    });

    // Its readers are told a moderator removed it, rather than that its
    // author deleted it (FC-050).
    it.each([
      ['its author deleted', MEMBER_ID, false],
      ['a moderator removed', MODERATOR_ID, true],
    ])('says whether %s it', async (_label, deletedBy, removed) => {
      seedMessage(world.db, {
        id: idOf(1),
        authorUserId: MEMBER_ID,
        deletedAt: new Date(),
        deletedByUserId: deletedBy,
      });

      await expect(
        world.messages.readOne(idOf(1), MODERATOR_ID),
      ).resolves.toMatchObject({ deleted: true, removed });
    });

    it('calls a message nobody deleted not removed', async () => {
      seedMessage(world.db, { id: idOf(1) });

      await expect(
        world.messages.readOne(idOf(1), MODERATOR_ID),
      ).resolves.toMatchObject({ deleted: false, removed: false });
    });

    it('hides an older message', async () => {
      seedMessage(world.db, { id: idOf(1), createdAt: ago(5 * HOUR) });

      await expect(world.messages.readOne(idOf(1), MEMBER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('reads a conversation’s message only for its two', async () => {
      const id = await conversation();

      seedMessage(world.db, {
        id: idOf(1),
        channelId: null,
        conversationId: id,
        authorUserId: STRANGER_ID,
      });

      await expect(
        world.messages.readOne(idOf(1), FRIEND_ID),
      ).resolves.toMatchObject({
        author: { userId: STRANGER_ID, username: 'Stranger' },
      });
      await expect(
        world.messages.readOne(idOf(1), MODERATOR_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('names an author with no username as null', async () => {
      seedMessage(world.db, { id: idOf(1), authorUserId: idOf(99) });

      await expect(
        world.messages.readOne(idOf(1), MEMBER_ID),
      ).resolves.toMatchObject({
        author: { userId: idOf(99), username: null },
      });
    });
  });

  describe('posting', () => {
    const dto = { body: 'Hello', clientMessageId: idOf(500) };

    it('posts in a channel', async () => {
      const message = await world.messages.postToChannel(
        CHANNEL_ID,
        MEMBER_ID,
        dto,
      );

      expect(message).toMatchObject({
        channelId: CHANNEL_ID,
        conversationId: null,
        body: 'Hello',
        clientMessageId: idOf(500),
        mine: true,
      });
      expect(world.db.rows(ChatMessageEntity)).toHaveLength(1);
    });

    it('refuses somebody who may read but not post', async () => {
      seedChannel(world.db, {
        id: idOf(600),
        postRole: FleetScopeRole.OFFICER,
      });

      await expect(
        world.messages.postToChannel(idOf(600), MEMBER_ID, dto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('posts a resend once', async () => {
      const first = await world.messages.postToChannel(
        CHANNEL_ID,
        MEMBER_ID,
        dto,
      );
      const again = await world.messages.postToChannel(
        CHANNEL_ID,
        MEMBER_ID,
        dto,
      );

      expect(again.id).toBe(first.id);
      expect(world.db.rows(ChatMessageEntity)).toHaveLength(1);
    });

    it('refuses a client ID used in another place', async () => {
      const id = await conversation();

      await world.messages.postToChannel(CHANNEL_ID, MEMBER_ID, dto);

      await expect(
        world.messages.postToConversation(id, MEMBER_ID, dto),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses a client ID used in another conversation', async () => {
      const id = await conversation();

      seedMessage(world.db, {
        id: idOf(1),
        channelId: null,
        conversationId: 'another',
        clientMessageId: dto.clientMessageId,
      });

      await expect(
        world.messages.postToConversation(id, MEMBER_ID, dto),
      ).rejects.toThrow(ConflictException);
    });

    it('posts in a conversation', async () => {
      const id = await conversation();

      await expect(
        world.messages.postToConversation(id, FRIEND_ID, dto),
      ).resolves.toMatchObject({ conversationId: id, channelId: null });
    });

    it('slows down somebody posting too quickly', async () => {
      for (let index = 1; index <= CHAT_RATE_LIMIT; index += 1) {
        seedMessage(world.db, { id: idOf(index) });
      }

      const refusal = await world.messages
        .postToChannel(CHANNEL_ID, MEMBER_ID, dto)
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(HttpException);
      expect((refusal as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    });

    it('gives the winner of a race for the same client ID', async () => {
      const save = world.db.save;

      world.db.save = () => {
        world.db.save = save;
        seedMessage(world.db, {
          id: idOf(1),
          clientMessageId: dto.clientMessageId,
        });

        return Promise.reject(
          new QueryFailedError('INSERT', [], {
            code: '23505',
          } as unknown as Error),
        );
      };

      await expect(
        world.messages.postToChannel(CHANNEL_ID, MEMBER_ID, dto),
      ).resolves.toMatchObject({ id: idOf(1) });
    });

    it('passes any other failure on', async () => {
      const failure = new QueryFailedError('INSERT', [], {
        code: '40001',
      } as unknown as Error);

      world.db.save = () => Promise.reject(failure);

      await expect(
        world.messages.postToChannel(CHANNEL_ID, MEMBER_ID, dto),
      ).rejects.toBe(failure);
    });
  });

  describe('remove', () => {
    const removed = (): Row | undefined =>
      world.db.rows<Row>(ChatMessageEntity).find(row => row.id === idOf(1));

    it('lets an author delete their own, without a reason or a log', async () => {
      seedMessage(world.db, { id: idOf(1) });

      await expect(
        world.messages.remove(idOf(1), MEMBER_ID, {}),
      ).resolves.toEqual({ place: { channelId: CHANNEL_ID }, removed: false });

      expect(removed()).toMatchObject({ deletedByUserId: MEMBER_ID });
      expect(world.db.rows(ChatActionEntity)).toEqual([]);
    });

    it('says which conversation an author’s deleted message was in', async () => {
      const id = await conversation();

      seedMessage(world.db, {
        id: idOf(1),
        channelId: null,
        conversationId: id,
      });

      await expect(
        world.messages.remove(idOf(1), MEMBER_ID, {}),
      ).resolves.toEqual({ place: { conversationId: id }, removed: false });
    });

    it('leaves a deleted message be', async () => {
      seedMessage(world.db, { id: idOf(1), deletedAt: new Date() });

      await expect(
        world.messages.remove(idOf(1), MODERATOR_ID, {}),
      ).resolves.toBeNull();

      expect(removed()?.deletedByUserId).toBeNull();
    });

    it('refuses anybody else’s in a channel they do not moderate', async () => {
      seedMessage(world.db, { id: idOf(1), authorUserId: MODERATOR_ID });

      await expect(
        world.messages.remove(idOf(1), MEMBER_ID, { reason: 'No' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses the other person’s in a conversation', async () => {
      const id = await conversation();

      seedMessage(world.db, {
        id: idOf(1),
        channelId: null,
        conversationId: id,
        authorUserId: FRIEND_ID,
      });

      await expect(
        world.messages.remove(idOf(1), MEMBER_ID, {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('needs a moderator’s reason', async () => {
      seedMessage(world.db, { id: idOf(1) });

      await expect(
        world.messages.remove(idOf(1), MODERATOR_ID, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('lets a moderator remove anybody’s, logged with the reason', async () => {
      seedMessage(world.db, { id: idOf(1) });

      await expect(
        world.messages.remove(idOf(1), MODERATOR_ID, {
          reason: 'Off topic',
        }),
      ).resolves.toEqual({ place: { channelId: CHANNEL_ID }, removed: true });

      expect(removed()).toMatchObject({ deletedByUserId: MODERATOR_ID });
      expect(world.db.rows(ChatActionEntity)).toEqual([
        expect.objectContaining({
          channelId: CHANNEL_ID,
          messageId: idOf(1),
          action: ChatActionKind.MESSAGE_REMOVED,
          actorUserId: MODERATOR_ID,
          reason: 'Off topic',
          detail: { authorUserId: MEMBER_ID },
        }),
      ]);
    });
  });

  describe('purge', () => {
    it('forgets messages older than the retention period', async () => {
      seedMessage(world.db, { id: idOf(1), createdAt: ago(46 * 24 * HOUR) });
      seedMessage(world.db, { id: idOf(2), createdAt: ago(44 * 24 * HOUR) });

      await expect(world.messages.purge()).resolves.toEqual({
        counts: { messages: 1, heldAuthors: 0 },
        complete: true,
      });
      expect(world.db.rows<Row>(ChatMessageEntity).map(row => row.id)).toEqual([
        idOf(2),
      ]);
    });

    // A member reads four hours back and a transcript seven days: windows on
    // what is still here, which the purge's own 45 days never move (FC-037).
    it('keeps what a transcript may still take, and a member may not read', async () => {
      seedMessage(world.db, { id: idOf(1), createdAt: ago(6 * 24 * HOUR) });
      seedMessage(world.db, { id: idOf(2), createdAt: ago(5 * HOUR) });

      await world.messages.purge();

      expect(world.db.rows<Row>(ChatMessageEntity)).toHaveLength(2);
      expect(world.messages.windowStart().getTime()).toBeGreaterThan(
        ago(5 * HOUR).getTime(),
      );
    });

    it('keeps the messages of a member whose messages are held (FC-036)', async () => {
      world.db.seed(ModerationHoldEntity, [
        {
          kind: ModerationHoldKind.MEMBER_MESSAGES,
          subjectUserId: MEMBER_ID,
          releasedAt: null,
        },
        {
          kind: ModerationHoldKind.MEMBER_MESSAGES,
          subjectUserId: FRIEND_ID,
          releasedAt: new Date(),
        },
      ]);
      seedMessage(world.db, { id: idOf(1), createdAt: ago(46 * 24 * HOUR) });
      seedMessage(world.db, {
        id: idOf(2),
        authorUserId: FRIEND_ID,
        createdAt: ago(46 * 24 * HOUR),
      });
      seedMessage(world.db, {
        id: idOf(3),
        authorUserId: null,
        createdAt: ago(46 * 24 * HOUR),
      });

      await expect(world.messages.purge()).resolves.toEqual({
        counts: { messages: 2, heldAuthors: 1 },
        complete: true,
      });
      expect(world.db.rows<Row>(ChatMessageEntity).map(row => row.id)).toEqual([
        idOf(1),
      ]);
    });
  });

  describe('cursorOf', () => {
    it('names a message by its instant and ID', () => {
      expect(
        cursorOf({ id: idOf(1), createdAt: new Date('2026-09-28T12:00:00Z') }),
      ).toBe(`2026-09-28T12:00:00.000Z_${idOf(1)}`);
    });
  });

  describe('mentions, replies and notices (FC-033)', () => {
    const post = (body: string, extra: object = {}) => ({
      body,
      clientMessageId: idOf(700 + Math.floor(Math.random() * 1_000)),
      ...extra,
    });

    /**
     * The notices queued, as kind and person.
     *
     * @returns Each.
     */
    const notices = (): string[] =>
      world.db
        .rows<Row>(NotificationOutboxEntity)
        .map(row => `${String(row.kind)}:${String(row.userId)}`);

    it('keeps only mentions of people who can read the channel, and tells each once', async () => {
      const message = await world.messages.postToChannel(
        CHANNEL_ID,
        MEMBER_ID,
        post('@Moderator @Stranger @Member', {
          mentions: [MODERATOR_ID, STRANGER_ID, MEMBER_ID, MODERATOR_ID],
        }),
      );

      expect(message.mentions).toEqual([
        { userId: MODERATOR_ID, username: 'Moderator' },
      ]);
      expect(notices()).toEqual([
        `${NotificationOutboxKind.CHAT_MENTION}:${MODERATOR_ID}`,
      ]);
    });

    it('answers a message in the same place, telling its author, with a preview', async () => {
      seedMessage(world.db, { id: idOf(1), body: 'Shields up' });

      const reply = await world.messages.postToChannel(
        CHANNEL_ID,
        MODERATOR_ID,
        post('Aye', { replyToMessageId: idOf(1) }),
      );

      expect(reply.replyTo).toEqual({
        id: idOf(1),
        author: { userId: MEMBER_ID, username: 'Member' },
        excerpt: 'Shields up',
      });
      expect(notices()).toEqual([
        `${NotificationOutboxKind.CHAT_REPLY}:${MEMBER_ID}`,
      ]);
    });

    it('sends one notice to somebody both answered and mentioned, and none for answering oneself', async () => {
      seedMessage(world.db, { id: idOf(1) });
      seedMessage(world.db, { id: idOf(2), authorUserId: MODERATOR_ID });

      await world.messages.postToChannel(
        CHANNEL_ID,
        MODERATOR_ID,
        post('@Member aye', {
          replyToMessageId: idOf(1),
          mentions: [MEMBER_ID],
        }),
      );
      await world.messages.postToChannel(
        CHANNEL_ID,
        MODERATOR_ID,
        post('And again', { replyToMessageId: idOf(2) }),
      );

      expect(notices()).toEqual([
        `${NotificationOutboxKind.CHAT_MENTION}:${MEMBER_ID}`,
      ]);
    });

    it('tells nobody when the answered message’s author has gone', async () => {
      seedMessage(world.db, { id: idOf(1), authorUserId: null });

      const reply = await world.messages.postToChannel(
        CHANNEL_ID,
        MEMBER_ID,
        post('Who wrote that?', { replyToMessageId: idOf(1) }),
      );

      expect(reply.replyTo).toMatchObject({ author: null, excerpt: 'Hello' });
      expect(notices()).toEqual([]);
    });

    it('shows eighty characters of a long message, counting emoji as one', async () => {
      seedMessage(world.db, { id: idOf(1), body: `${'🖖'.repeat(79)}ab` });

      const reply = await world.messages.postToChannel(
        CHANNEL_ID,
        MODERATOR_ID,
        post('Live long', { replyToMessageId: idOf(1) }),
      );

      expect(reply.replyTo?.excerpt).toBe(`${'🖖'.repeat(79)}a…`);
    });

    it.each([
      ['missing', {}, 'missing'],
      ['older than the window', { createdAt: ago(5 * HOUR) }, idOf(1)],
      ['deleted', { deletedAt: new Date() }, idOf(1)],
      ['in another place', { channelId: idOf(600) }, idOf(1)],
    ])('refuses to answer a message that is %s', async (_label, row, id) => {
      seedMessage(world.db, { id: idOf(1), ...row });

      await expect(
        world.messages.postToChannel(
          CHANNEL_ID,
          MEMBER_ID,
          post('Aye', { replyToMessageId: id }),
        ),
      ).rejects.toThrow('That message can no longer be answered.');
    });

    it('hides a reply’s preview once its message is older or deleted, and a deleted reply’s own', async () => {
      seedMessage(world.db, { id: idOf(1), createdAt: ago(5 * HOUR) });
      seedMessage(world.db, {
        id: idOf(2),
        replyToMessageId: idOf(1),
        mentions: [MODERATOR_ID],
      });
      seedMessage(world.db, {
        id: idOf(3),
        replyToMessageId: idOf(2),
        mentions: [MODERATOR_ID],
        deletedAt: new Date(),
      });

      const page = await world.messages.readChannel(CHANNEL_ID, MEMBER_ID, {});

      expect(page.messages.map(each => [each.replyTo, each.mentions])).toEqual([
        [
          { id: idOf(1), author: null, excerpt: null },
          [{ userId: MODERATOR_ID, username: 'Moderator' }],
        ],
        [null, []],
      ]);
    });

    describe('in a conversation', () => {
      let conversationId: string;

      beforeEach(async () => {
        world.befriend(MEMBER_ID, FRIEND_ID);
        conversationId = (await world.direct.open(MEMBER_ID, FRIEND_ID)).id;
      });

      const conversation = (): Row =>
        world.db.rows<Row>(ChatDirectConversationEntity)[0];

      it('tells the other person once while away, again only after they open it', async () => {
        await world.messages.postToConversation(
          conversationId,
          MEMBER_ID,
          post('One', { mentions: [FRIEND_ID, STRANGER_ID] }),
        );
        await world.messages.postToConversation(
          conversationId,
          MEMBER_ID,
          post('Two'),
        );

        expect(notices()).toEqual([
          `${NotificationOutboxKind.CHAT_MENTION}:${FRIEND_ID}`,
          `${NotificationOutboxKind.CHAT_DIRECT_MESSAGE}:${FRIEND_ID}`,
        ]);
        expect(conversation().highNoticedAt).toBeInstanceOf(Date);

        await world.messages.readConversation(conversationId, FRIEND_ID, {});
        expect(conversation().highNoticedAt).toBeNull();

        await world.messages.postToConversation(
          conversationId,
          MEMBER_ID,
          post('Three'),
        );
        expect(notices()).toHaveLength(3);
      });
    });

    it('names a mentioned reader with no username as null', async () => {
      world.stand(OFFICER_ID, FLEET_ID, MEMBER);

      const message = await world.messages.postToChannel(
        CHANNEL_ID,
        MEMBER_ID,
        post('Hail', { mentions: [OFFICER_ID] }),
      );

      expect(message.mentions).toEqual([
        { userId: OFFICER_ID, username: null },
      ]);
    });

    it('answers a message in the same conversation', async () => {
      world.befriend(MEMBER_ID, FRIEND_ID);

      const id = (await world.direct.open(MEMBER_ID, FRIEND_ID)).id;

      seedMessage(world.db, {
        id: idOf(1),
        channelId: null,
        conversationId: id,
        authorUserId: FRIEND_ID,
      });

      const reply = await world.messages.postToConversation(
        id,
        MEMBER_ID,
        post('Hello back', { replyToMessageId: idOf(1) }),
      );

      expect(reply.replyTo).toMatchObject({
        author: { userId: FRIEND_ID, username: 'Friend' },
      });
    });

    describe('people', () => {
      it('offers others who can read the channel, by the start of their name', async () => {
        await expect(
          world.messages.people(CHANNEL_ID, MEMBER_ID, 'mo'),
        ).resolves.toEqual([{ userId: MODERATOR_ID, username: 'Moderator' }]);
        await expect(
          world.messages.people(CHANNEL_ID, MEMBER_ID, 'Str'),
        ).resolves.toEqual([]);
        await expect(
          world.messages.people(CHANNEL_ID, MEMBER_ID, 'Mem'),
        ).resolves.toEqual([]);
      });

      it('finds nothing for somebody who cannot read the channel', async () => {
        await expect(
          world.messages.people(CHANNEL_ID, STRANGER_ID, 'mo'),
        ).rejects.toThrow(NotFoundException);
      });
    });
  });

  describe('blocks (FC-034)', () => {
    beforeEach(() => {
      world.block(MODERATOR_ID, MEMBER_ID);
    });

    it('shows the other side’s messages as nobody and nothing, both ways', async () => {
      seedMessage(world.db, {
        id: idOf(1),
        authorUserId: MODERATOR_ID,
        mentions: [MEMBER_ID],
      });
      seedMessage(world.db, { id: idOf(2), authorUserId: FRIEND_ID });

      const forMember = await world.messages.readChannel(
        CHANNEL_ID,
        MEMBER_ID,
        {},
      );

      expect(forMember.messages[0]).toMatchObject({
        id: idOf(1),
        author: null,
        body: null,
        hidden: true,
        mentions: [],
        replyTo: null,
      });
      expect(forMember.messages[1]).toMatchObject({
        id: idOf(2),
        hidden: false,
      });
    });

    it('shows nothing of an answered message from the other side', async () => {
      seedMessage(world.db, { id: idOf(1), authorUserId: MODERATOR_ID });
      seedMessage(world.db, {
        id: idOf(2),
        authorUserId: FRIEND_ID,
        replyToMessageId: idOf(1),
      });

      const page = await world.messages.readChannel(CHANNEL_ID, MEMBER_ID, {});

      expect(page.messages[1].replyTo).toEqual({
        id: idOf(1),
        author: null,
        excerpt: null,
      });
    });

    it('neither mentions, answers nor offers the other side', async () => {
      seedMessage(world.db, { id: idOf(1), authorUserId: MODERATOR_ID });

      const message = await world.messages.postToChannel(
        CHANNEL_ID,
        MEMBER_ID,
        {
          body: '@Moderator',
          clientMessageId: idOf(900),
          mentions: [MODERATOR_ID],
        },
      );

      expect(message.mentions).toEqual([]);
      await expect(
        world.messages.postToChannel(CHANNEL_ID, MEMBER_ID, {
          body: 'Aye',
          clientMessageId: idOf(901),
          replyToMessageId: idOf(1),
        }),
      ).rejects.toThrow('That message can no longer be answered.');
      await expect(
        world.messages.people(CHANNEL_ID, MEMBER_ID, 'mo'),
      ).resolves.toEqual([]);
    });
  });
});
