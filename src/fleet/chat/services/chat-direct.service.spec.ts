import { BadRequestException, NotFoundException } from '@nestjs/common';

import { beforeEach, describe, expect, it } from '@jest/globals';

import { FriendshipEntity } from 'src/community/entities/friendship.entity';

import {
  chatWorld,
  ChatWorld,
  FRIEND_ID,
  MEMBER_ID,
  MODERATOR_ID,
  OFFICER_ID,
  STRANGER_ID,
} from '../../../../test/chat-world';
import { Row } from '../../../../test/in-memory-manager';
import { ChatDirectConversationEntity } from '../entities/chat-direct-conversation.entity';

const NAMELESS_ID = '31000000-0000-4000-8000-000000000015';

describe('ChatDirectService', () => {
  let world: ChatWorld;

  beforeEach(() => {
    world = chatWorld();
  });

  describe('open', () => {
    it('refuses a conversation with oneself', async () => {
      await expect(world.direct.open(MEMBER_ID, MEMBER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses somebody who is not a friend', async () => {
      await expect(world.direct.open(MEMBER_ID, STRANGER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses a friend either has blocked', async () => {
      world.befriend(MEMBER_ID, FRIEND_ID);
      world.block(FRIEND_ID, MEMBER_ID);

      await expect(world.direct.open(MEMBER_ID, FRIEND_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('opens one conversation per pair, whoever opens it', async () => {
      world.befriend(FRIEND_ID, MEMBER_ID);

      const first = await world.direct.open(MEMBER_ID, FRIEND_ID);
      const again = await world.direct.open(FRIEND_ID, MEMBER_ID);

      expect(first).toEqual({
        id: again.id,
        other: { userId: FRIEND_ID, username: 'Friend' },
      });
      expect(again.other).toEqual({ userId: MEMBER_ID, username: 'Member' });
      expect(world.db.rows(ChatDirectConversationEntity)).toEqual([
        expect.objectContaining({
          userLowId: MEMBER_ID,
          userHighId: FRIEND_ID,
        }),
      ]);
    });
  });

  describe('conversations', () => {
    it('lists nothing for somebody with none', async () => {
      await expect(world.direct.conversations(MEMBER_ID)).resolves.toEqual([]);
    });

    it('lists open conversations by the friend’s name, hiding closed ones', async () => {
      for (const other of [FRIEND_ID, OFFICER_ID, STRANGER_ID, NAMELESS_ID]) {
        world.befriend(MODERATOR_ID, other);
        await world.direct.open(MODERATOR_ID, other);
      }

      world.befriend(MEMBER_ID, MODERATOR_ID);
      await world.direct.open(MODERATOR_ID, MEMBER_ID);
      world.block(STRANGER_ID, MODERATOR_ID);
      world.unfriend(MODERATOR_ID, FRIEND_ID);

      const listed = await world.direct.conversations(MODERATOR_ID);

      // Neither has a username, so both sort first, as they were found.
      expect(listed.map(conversation => conversation.other)).toEqual([
        { userId: NAMELESS_ID, username: null },
        { userId: OFFICER_ID, username: null },
        { userId: MEMBER_ID, username: 'Member' },
      ]);
    });
  });

  describe('usable', () => {
    let conversationId: string;

    beforeEach(async () => {
      world.befriend(MEMBER_ID, FRIEND_ID);
      conversationId = (await world.direct.open(MEMBER_ID, FRIEND_ID)).id;
    });

    it('gives either person the conversation and who it is with', async () => {
      await expect(
        world.direct.usable(conversationId, MEMBER_ID),
      ).resolves.toMatchObject({ otherUserId: FRIEND_ID });
      await expect(
        world.direct.usable(conversationId, FRIEND_ID),
      ).resolves.toMatchObject({ otherUserId: MEMBER_ID });
    });

    it('hides it from anybody else, and when there is none', async () => {
      await expect(
        world.direct.usable(conversationId, STRANGER_ID),
      ).rejects.toThrow(NotFoundException);
      await expect(world.direct.usable('missing', MEMBER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('closes it once they stop being friends', async () => {
      world.unfriend(FRIEND_ID, MEMBER_ID);

      await expect(
        world.direct.usable(conversationId, MEMBER_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('the away notice', () => {
    it('is taken once per person until they open the conversation again', async () => {
      world.befriend(MEMBER_ID, FRIEND_ID);

      const { conversation } = await world.direct.usable(
        (await world.direct.open(MEMBER_ID, FRIEND_ID)).id,
        MEMBER_ID,
      );
      const manager = world.db.asManager();

      // The member's ID is the lower of the two.
      await expect(
        world.direct.takeNotice(manager, conversation, MEMBER_ID),
      ).resolves.toBe(true);
      await expect(
        world.direct.takeNotice(manager, conversation, MEMBER_ID),
      ).resolves.toBe(false);
      await expect(
        world.direct.takeNotice(manager, conversation, FRIEND_ID),
      ).resolves.toBe(true);
      expect(conversation).toMatchObject({
        lowNoticedAt: expect.any(Date),
        highNoticedAt: expect.any(Date),
      });

      await world.direct.rearmNotice(conversation, FRIEND_ID);
      expect(conversation.highNoticedAt).toBeNull();
      await world.direct.rearmNotice(conversation, MEMBER_ID, manager);
      expect(conversation.lowNoticedAt).toBeNull();
    });
  });

  describe('friendOf', () => {
    it('names the other person in an accepted friendship, from either side', async () => {
      world.befriend(MEMBER_ID, FRIEND_ID);

      const [friendship] = world.db.rows<Row>(FriendshipEntity);

      friendship.id = 'friendship-1';

      await expect(
        world.direct.friendOf(MEMBER_ID, 'friendship-1'),
      ).resolves.toBe(FRIEND_ID);
      await expect(
        world.direct.friendOf(FRIEND_ID, 'friendship-1'),
      ).resolves.toBe(MEMBER_ID);
      await expect(
        world.direct.friendOf(STRANGER_ID, 'friendship-1'),
      ).rejects.toThrow(NotFoundException);
      await expect(world.direct.friendOf(MEMBER_ID, 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('blockedFor', () => {
    it('names everybody across a block from somebody, either way', async () => {
      world.block(MEMBER_ID, FRIEND_ID);
      world.block(STRANGER_ID, MEMBER_ID);

      await expect(world.direct.blockedFor(MEMBER_ID)).resolves.toEqual(
        new Set([FRIEND_ID, STRANGER_ID]),
      );
    });
  });
});
