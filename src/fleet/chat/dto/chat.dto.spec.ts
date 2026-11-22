import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import {
  CHAT_MENTIONS_MAX,
  CHAT_MESSAGE_MAX_LENGTH,
  ChatChannelInputDto,
  ChatJoinDto,
  ChatMessagesQueryDto,
  ChatOpenConversationDto,
  ChatPeopleQueryDto,
  ChatPostDto,
  ChatPresenceQueryDto,
  ChatRemoveDto,
  ChatSendDto,
} from './chat.dto';

const ID = '31000000-0000-4000-8000-000000000001';
const CURSOR = `2026-09-28T12:00:00.000Z_${ID}`;

/**
 * Lists the properties a body fails on.
 *
 * @param type - The DTO.
 * @param body - What was sent.
 * @returns The failing properties.
 */
async function failures(
  type: new () => object,
  body: object,
): Promise<string[]> {
  return (await validate(plainToInstance(type, body))).map(
    error => error.property,
  );
}

describe('chat DTOs', () => {
  describe('ChatChannelInputDto', () => {
    it('trims the name, and takes the posting role as optional', async () => {
      const dto = plainToInstance(ChatChannelInputDto, {
        name: '  Away team  ',
        readRole: FleetScopeRole.OFFICER,
      });

      expect(dto.name).toBe('Away team');
      await expect(validate(dto)).resolves.toEqual([]);
    });

    it.each([
      [
        'a blank name',
        { name: '   ', readRole: FleetScopeRole.MEMBER },
        'name',
      ],
      [
        'a long name',
        { name: 'x'.repeat(51), readRole: FleetScopeRole.MEMBER },
        'name',
      ],
      ['a name that is not text', { name: 7, readRole: 'MEMBER' }, 'name'],
      ['an unknown role', { name: 'Ops', readRole: 'CAPTAIN' }, 'readRole'],
      [
        'an unknown posting role',
        { name: 'Ops', readRole: 'MEMBER', postRole: 'CAPTAIN' },
        'postRole',
      ],
    ])('refuses %s', async (_label, body, property) => {
      await expect(failures(ChatChannelInputDto, body)).resolves.toEqual([
        property,
      ]);
    });
  });

  describe('ChatMessagesQueryDto', () => {
    it.each([
      ['nothing', {}],
      ['a cursor before', { before: CURSOR }],
      ['a cursor after', { after: CURSOR }],
      ['words', { q: '  red alert ' }],
    ])('accepts %s', async (_label, query) => {
      await expect(failures(ChatMessagesQueryDto, query)).resolves.toEqual([]);
    });

    it.each([
      ['a bare instant before', { before: '2026-09-28T12:00:00Z' }, 'before'],
      ['a bare ID after', { after: ID }, 'after'],
      ['blank words', { q: '  ' }, 'q'],
      ['too many words', { q: 'x'.repeat(101) }, 'q'],
    ])('refuses %s', async (_label, query, property) => {
      await expect(failures(ChatMessagesQueryDto, query)).resolves.toEqual([
        property,
      ]);
    });
  });

  describe('ChatPostDto', () => {
    it('accepts a message at the limit', async () => {
      await expect(
        failures(ChatPostDto, {
          body: 'x'.repeat(CHAT_MESSAGE_MAX_LENGTH),
          clientMessageId: ID,
        }),
      ).resolves.toEqual([]);
    });

    it.each([
      ['a blank message', { body: ' \n ', clientMessageId: ID }, 'body'],
      [
        'a message over the limit',
        { body: 'x'.repeat(CHAT_MESSAGE_MAX_LENGTH + 1), clientMessageId: ID },
        'body',
      ],
      [
        'a client ID that is no UUID',
        { body: 'Hi', clientMessageId: '1' },
        'clientMessageId',
      ],
    ])('refuses %s', async (_label, body, property) => {
      await expect(failures(ChatPostDto, body)).resolves.toEqual([property]);
    });
  });

  describe('ChatRemoveDto', () => {
    it('takes a reason as optional', async () => {
      await expect(failures(ChatRemoveDto, {})).resolves.toEqual([]);
      await expect(
        failures(ChatRemoveDto, { reason: 'Off topic' }),
      ).resolves.toEqual([]);
    });

    it('refuses a long reason', async () => {
      await expect(
        failures(ChatRemoveDto, { reason: 'x'.repeat(501) }),
      ).resolves.toEqual(['reason']);
    });
  });

  describe('ChatOpenConversationDto', () => {
    it('takes a friendship instead of a user ID', async () => {
      await expect(
        failures(ChatOpenConversationDto, { friendshipId: ID }),
      ).resolves.toEqual([]);
      await expect(
        failures(ChatOpenConversationDto, { friendshipId: 'mine' }),
      ).resolves.toEqual(['friendshipId']);
    });

    it('checks a user ID', async () => {
      await expect(
        failures(ChatOpenConversationDto, { userId: ID }),
      ).resolves.toEqual([]);
      await expect(
        failures(ChatOpenConversationDto, { userId: 'friend' }),
      ).resolves.toEqual(['userId']);
    });
  });

  describe('socket payloads', () => {
    it('joins a channel after a cursor, or a conversation', async () => {
      await expect(
        failures(ChatJoinDto, { channelId: ID, after: CURSOR }),
      ).resolves.toEqual([]);
      await expect(
        failures(ChatJoinDto, { conversationId: ID }),
      ).resolves.toEqual([]);
    });

    it.each([
      ['a channel that is no ID', { channelId: 'general' }, 'channelId'],
      [
        'a conversation that is no ID',
        { conversationId: 'k' },
        'conversationId',
      ],
      ['a cursor that is no cursor', { channelId: ID, after: 'then' }, 'after'],
    ])('refuses to join %s', async (_label, body, property) => {
      await expect(failures(ChatJoinDto, body)).resolves.toEqual([property]);
    });

    it('sends a trimmed message with a client ID', async () => {
      const dto = plainToInstance(ChatSendDto, {
        channelId: ID,
        body: '  Hail  ',
        clientMessageId: ID,
      });

      expect(dto.body).toBe('Hail');
      await expect(validate(dto)).resolves.toEqual([]);
      await expect(
        failures(ChatSendDto, {
          channelId: ID,
          body: ' ',
          clientMessageId: '1',
        }),
      ).resolves.toEqual(['body', 'clientMessageId']);
    });
  });

  describe('mentions and replies (FC-033)', () => {
    const base = { body: 'Hail', clientMessageId: ID };

    it('takes mentions by ID and a message answered', async () => {
      await expect(
        failures(ChatPostDto, {
          ...base,
          mentions: [ID],
          replyToMessageId: ID,
        }),
      ).resolves.toEqual([]);
      await expect(
        failures(ChatSendDto, {
          ...base,
          channelId: ID,
          mentions: [ID],
          replyToMessageId: ID,
        }),
      ).resolves.toEqual([]);
    });

    it.each([
      ['mentions that are not a list', { mentions: ID }, 'mentions'],
      ['a mention by name', { mentions: ['Kira'] }, 'mentions'],
      [
        'too many mentions',
        { mentions: Array.from({ length: CHAT_MENTIONS_MAX + 1 }, () => ID) },
        'mentions',
      ],
      [
        'an answer that is no ID',
        { replyToMessageId: 'that one' },
        'replyToMessageId',
      ],
    ])('refuses %s', async (_label, extra, property) => {
      await expect(
        failures(ChatPostDto, { ...base, ...extra }),
      ).resolves.toEqual([property]);
      await expect(
        failures(ChatSendDto, { ...base, channelId: ID, ...extra }),
      ).resolves.toEqual([property]);
    });

    it('looks people up by one to fifty characters, trimmed', async () => {
      await expect(
        failures(ChatPeopleQueryDto, { q: ' Ki ' }),
      ).resolves.toEqual([]);
      await expect(failures(ChatPeopleQueryDto, { q: '  ' })).resolves.toEqual([
        'q',
      ]);
      await expect(
        failures(ChatPeopleQueryDto, { q: 'x'.repeat(51) }),
      ).resolves.toEqual(['q']);
    });
  });

  describe('ChatPresenceQueryDto (FC-034)', () => {
    it('reads usernames from a list separated by commas', async () => {
      const dto = plainToInstance(ChatPresenceQueryDto, {
        usernames: ' Kira, ,Odo ',
      });

      expect(dto.usernames).toEqual(['Kira', 'Odo']);
      await expect(validate(dto)).resolves.toEqual([]);
    });

    it.each([
      [
        'more than fifty',
        Array.from({ length: 51 }, (_, i) => `user${i}`).join(','),
      ],
      ['a name too long', 'x'.repeat(51)],
      ['a list that is not text', 7],
    ])('refuses %s', async (_label, usernames) => {
      await expect(
        failures(ChatPresenceQueryDto, { usernames }),
      ).resolves.toEqual(['usernames']);
    });
  });
});
