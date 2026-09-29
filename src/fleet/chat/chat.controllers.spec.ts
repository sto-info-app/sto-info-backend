import { PATH_METADATA } from '@nestjs/common/constants';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { FLEET_FEATURE_FLAGS } from '../constants/fleet-feature.constants';
import { FleetScopeRole } from '../enums/fleet-scope-role.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import {
  armadaScope,
  communityScope,
  fleetScope,
} from '../governance/utilities/governance-scope.utility';
import {
  ArmadaChatController,
  ChatController,
  CommunityChatController,
  FleetChatController,
} from './chat.controllers';
import { ChatDeliveryService } from './realtime/chat-delivery.service';
import { ChatPresenceService } from './realtime/chat-presence.service';
import { ChatChannelService } from './services/chat-channel.service';
import { ChatDirectService } from './services/chat-direct.service';
import { ChatMessageService } from './services/chat-message.service';

const COMMUNITY_ID = '31000000-0000-4000-8000-000000000001';
const SCOPE_ID = '31000000-0000-4000-8000-000000000002';
const CHANNEL_ID = '31000000-0000-4000-8000-0000000000c1';
const MESSAGE_ID = '31000000-0000-4000-8000-0000000000d1';
const USER_ID = '31000000-0000-4000-8000-000000000010';
const DTO = { name: 'Away team', readRole: FleetScopeRole.MEMBER };
const POST = { body: 'Hello', clientMessageId: MESSAGE_ID };
const ANSWER = { answered: true };

/** A mocked call that answers {@link ANSWER}. */
type Answering = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

/**
 * A mocked call that answers.
 *
 * @returns The mock.
 */
const answering = (): Answering => jest.fn(async () => ANSWER);

const CASES = [
  {
    name: 'CommunityChatController',
    type: CommunityChatController,
    path: 'fleet-communities/:communityId/chat/channels',
    id: COMMUNITY_ID,
    scope: communityScope(COMMUNITY_ID),
  },
  {
    name: 'FleetChatController',
    type: FleetChatController,
    path: 'fleet-communities/:communityId/fleets/:fleetId/chat/channels',
    id: SCOPE_ID,
    scope: fleetScope(COMMUNITY_ID, SCOPE_ID),
  },
  {
    name: 'ArmadaChatController',
    type: ArmadaChatController,
    path: 'fleet-communities/:communityId/armadas/:armadaId/chat/channels',
    id: SCOPE_ID,
    scope: armadaScope(COMMUNITY_ID, SCOPE_ID),
  },
];

describe('chat controllers', () => {
  let featureService: { assertFlagEnabled: Answering };
  let channels: Record<
    'list' | 'create' | 'update' | 'archive' | 'mine',
    Answering
  >;
  let messages: Record<
    | 'readChannel'
    | 'postToChannel'
    | 'readOne'
    | 'remove'
    | 'readConversation'
    | 'postToConversation'
    | 'people',
    Answering
  >;
  let direct: Record<'conversations' | 'open' | 'friendOf', Answering>;
  let delivery: { publish: Answering };
  let presence: { onlineFor: Answering };

  beforeEach(() => {
    featureService = { assertFlagEnabled: answering() };
    channels = {
      list: answering(),
      create: answering(),
      update: answering(),
      archive: answering(),
      mine: answering(),
    };
    messages = {
      readChannel: answering(),
      postToChannel: answering(),
      readOne: answering(),
      remove: answering(),
      readConversation: answering(),
      postToConversation: answering(),
      people: answering(),
    };
    direct = {
      conversations: answering(),
      open: answering(),
      friendOf: jest.fn(async () => 'friend'),
    };
    delivery = { publish: answering() };
    presence = { onlineFor: answering() };
  });

  describe.each(CASES)('$name', ({ type, path, id, scope }) => {
    const controller = () =>
      new type(
        featureService as unknown as FleetFeatureService,
        channels as unknown as ChatChannelService,
      );

    it('is addressed under its scope', () => {
      expect(Reflect.getMetadata(PATH_METADATA, type)).toBe(path);
    });

    it('lists, adds, changes and archives the scope’s channels', async () => {
      await expect(controller().list(COMMUNITY_ID, id, USER_ID)).resolves.toBe(
        ANSWER,
      );
      expect(channels.list).toHaveBeenCalledWith(scope, USER_ID);

      await expect(
        controller().create(COMMUNITY_ID, id, DTO, USER_ID),
      ).resolves.toBe(ANSWER);
      expect(channels.create).toHaveBeenCalledWith(scope, DTO, USER_ID);

      await expect(
        controller().update(COMMUNITY_ID, id, CHANNEL_ID, DTO, USER_ID),
      ).resolves.toBe(ANSWER);
      expect(channels.update).toHaveBeenCalledWith(
        scope,
        CHANNEL_ID,
        DTO,
        USER_ID,
      );

      await expect(
        controller().archive(COMMUNITY_ID, id, CHANNEL_ID, USER_ID),
      ).resolves.toBeUndefined();
      expect(channels.archive).toHaveBeenCalledWith(scope, CHANNEL_ID, USER_ID);
      expect(featureService.assertFlagEnabled).toHaveBeenCalledWith(
        FLEET_FEATURE_FLAGS.CHAT_ENABLED,
      );
    });

    it('does nothing while chat is off', async () => {
      featureService.assertFlagEnabled.mockRejectedValue(new Error('off'));

      await expect(
        controller().list(COMMUNITY_ID, id, USER_ID),
      ).rejects.toThrow('off');
      expect(channels.list).not.toHaveBeenCalled();
    });
  });

  describe('ChatController', () => {
    const controller = () =>
      new ChatController(
        featureService as unknown as FleetFeatureService,
        channels as unknown as ChatChannelService,
        messages as unknown as ChatMessageService,
        direct as unknown as ChatDirectService,
        delivery as unknown as ChatDeliveryService,
        presence as unknown as ChatPresenceService,
      );

    it('is addressed at chat', () => {
      expect(Reflect.getMetadata(PATH_METADATA, ChatController)).toBe('chat');
    });

    it('lists the caller’s channels and conversations', async () => {
      await expect(controller().channels(USER_ID)).resolves.toBe(ANSWER);
      expect(channels.mine).toHaveBeenCalledWith(USER_ID);
      await expect(controller().conversations(USER_ID)).resolves.toBe(ANSWER);
      expect(direct.conversations).toHaveBeenCalledWith(USER_ID);
    });

    it('reads and posts in a channel', async () => {
      await expect(
        controller().channelMessages(CHANNEL_ID, USER_ID, { q: 'hail' }),
      ).resolves.toBe(ANSWER);
      expect(messages.readChannel).toHaveBeenCalledWith(CHANNEL_ID, USER_ID, {
        q: 'hail',
      });
      await expect(
        controller().postToChannel(CHANNEL_ID, USER_ID, POST),
      ).resolves.toBe(ANSWER);
      expect(messages.postToChannel).toHaveBeenCalledWith(
        CHANNEL_ID,
        USER_ID,
        POST,
      );
      expect(delivery.publish).toHaveBeenCalledWith({
        kind: 'message',
        place: { channelId: CHANNEL_ID },
        message: ANSWER,
      });
    });

    it('reads and deletes one message, telling its readers', async () => {
      await expect(controller().message(MESSAGE_ID, USER_ID)).resolves.toBe(
        ANSWER,
      );
      expect(messages.readOne).toHaveBeenCalledWith(MESSAGE_ID, USER_ID);
      messages.remove.mockResolvedValue({ channelId: CHANNEL_ID });
      await expect(
        controller().remove(MESSAGE_ID, USER_ID, { reason: 'Spam' }),
      ).resolves.toBeUndefined();
      expect(messages.remove).toHaveBeenCalledWith(MESSAGE_ID, USER_ID, {
        reason: 'Spam',
      });
      expect(delivery.publish).toHaveBeenCalledWith({
        kind: 'deleted',
        place: { channelId: CHANNEL_ID },
        messageId: MESSAGE_ID,
      });
    });

    it('tells nobody when the message was already deleted', async () => {
      messages.remove.mockResolvedValue(null);

      await controller().remove(MESSAGE_ID, USER_ID, {});

      expect(delivery.publish).not.toHaveBeenCalled();
    });

    it('opens, reads and posts in a conversation', async () => {
      await expect(
        controller().open(USER_ID, { userId: SCOPE_ID }),
      ).resolves.toBe(ANSWER);
      expect(direct.open).toHaveBeenCalledWith(USER_ID, SCOPE_ID);
      await expect(
        controller().conversationMessages(CHANNEL_ID, USER_ID, {}),
      ).resolves.toBe(ANSWER);
      expect(messages.readConversation).toHaveBeenCalledWith(
        CHANNEL_ID,
        USER_ID,
        {},
      );
      await expect(
        controller().postToConversation(CHANNEL_ID, USER_ID, POST),
      ).resolves.toBe(ANSWER);
      expect(messages.postToConversation).toHaveBeenCalledWith(
        CHANNEL_ID,
        USER_ID,
        POST,
      );
      expect(delivery.publish).toHaveBeenCalledWith({
        kind: 'message',
        place: { conversationId: CHANNEL_ID },
        message: ANSWER,
      });
    });

    it('says who is online, as the caller may know it', async () => {
      await expect(
        controller().presence(USER_ID, { usernames: ['Kira', 'Odo'] }),
      ).resolves.toBe(ANSWER);
      expect(presence.onlineFor).toHaveBeenCalledWith(USER_ID, ['Kira', 'Odo']);
    });

    it('finds people to mention', async () => {
      await expect(
        controller().people(CHANNEL_ID, USER_ID, { q: 'Ki' }),
      ).resolves.toBe(ANSWER);
      expect(messages.people).toHaveBeenCalledWith(CHANNEL_ID, USER_ID, 'Ki');
    });

    it('opens a conversation by the friendship, as a profile names it', async () => {
      await expect(
        controller().open(USER_ID, { friendshipId: MESSAGE_ID }),
      ).resolves.toBe(ANSWER);
      expect(direct.friendOf).toHaveBeenCalledWith(USER_ID, MESSAGE_ID);
      expect(direct.open).toHaveBeenCalledWith(USER_ID, 'friend');
    });

    it.each([
      ['neither', {}],
      ['both', { userId: SCOPE_ID, friendshipId: MESSAGE_ID }],
    ])('refuses to open a conversation naming %s', async (_label, dto) => {
      await expect(controller().open(USER_ID, dto)).rejects.toThrow(
        'Name one friend, or one friendship.',
      );
      expect(direct.open).not.toHaveBeenCalled();
    });

    it('does nothing while chat is off', async () => {
      featureService.assertFlagEnabled.mockRejectedValue(new Error('off'));

      await expect(controller().channels(USER_ID)).rejects.toThrow('off');
      expect(channels.mine).not.toHaveBeenCalled();
    });
  });
});
