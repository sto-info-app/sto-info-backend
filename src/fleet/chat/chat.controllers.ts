import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';

import { FLEET_FEATURE_FLAGS } from '../constants/fleet-feature.constants';
import { FleetFeatureService } from '../fleet-feature.service';
import {
  armadaScope,
  communityScope,
  fleetScope,
  GovernanceScope,
} from '../governance/utilities/governance-scope.utility';
import {
  ChatChannelDto,
  ChatChannelInputDto,
  ChatConversationDto,
  ChatMessageDto,
  ChatMessagePageDto,
  ChatMessagesQueryDto,
  ChatOpenConversationDto,
  ChatPeopleQueryDto,
  ChatPersonDto,
  ChatPostDto,
  ChatPresenceDto,
  ChatPresenceQueryDto,
  ChatRemoveDto,
  ChatScopeChannelsDto,
} from './dto/chat.dto';
import { ChatDeliveryService } from './realtime/chat-delivery.service';
import { ChatPresenceService } from './realtime/chat-presence.service';
import { ChatChannelService } from './services/chat-channel.service';
import { ChatDirectService } from './services/chat-direct.service';
import { ChatMessageService } from './services/chat-message.service';

/** Where one kind of scope's channels are addressed. */
interface ChatRoutes {
  /** The route prefix, ending in `/chat/channels`. */
  readonly path: string;
  /** The path parameter naming the scope itself. */
  readonly param: string;
  /** Names the scope from the Community and the scope's own ID. */
  readonly scopeOf: (communityId: string, id: string) => GovernanceScope;
}

/**
 * Builds one kind of scope's channel routes (FC-031), as its news and events
 * are built: one definition under three prefixes. Every route needs the
 * chat switch, and somebody signed in who takes part in the scope's chat.
 *
 * @param routes - Where this kind of scope's channels are addressed.
 * @returns The controller class.
 */
function chatChannelController(routes: ChatRoutes) {
  @ApiTags('Fleet chat')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Controller(routes.path)
  class ChatChannelController {
    /**
     * Creates an instance of the controller.
     *
     * @param _featureService - Reports whether chat is switched on.
     * @param _channels - The scope's channels.
     */
    constructor(
      readonly _featureService: FleetFeatureService,
      readonly _channels: ChatChannelService,
    ) {}

    /**
     * Lists the scope's channels the caller may read.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param userId - The caller.
     * @returns Its channels.
     */
    @Get()
    @ApiOperation({ summary: 'List a scope’s chat channels' })
    @ApiOkResponse({ type: [ChatChannelDto] })
    @ApiNotFoundResponse({ description: 'The caller takes no part in it.' })
    async list(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @UserId() userId: string,
    ): Promise<ChatChannelDto[]> {
      await this.assertEnabled();

      return this._channels.list(routes.scopeOf(communityId, id), userId);
    }

    /**
     * Adds a custom channel.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param dto - Its name, and who may read and post.
     * @param userId - The moderator.
     * @returns The channel.
     */
    @Post()
    @ApiOperation({ summary: 'Add a custom chat channel' })
    @ApiOkResponse({ type: ChatChannelDto })
    async create(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Body() dto: ChatChannelInputDto,
      @UserId() userId: string,
    ): Promise<ChatChannelDto> {
      await this.assertEnabled();

      return this._channels.create(
        routes.scopeOf(communityId, id),
        dto,
        userId,
      );
    }

    /**
     * Renames a custom channel, or changes who may read and post.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param channelId - The channel.
     * @param dto - Its name, and who may read and post.
     * @param userId - The moderator.
     * @returns The channel.
     */
    @Patch(':channelId')
    @ApiOperation({ summary: 'Change a custom chat channel' })
    @ApiOkResponse({ type: ChatChannelDto })
    async update(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Param('channelId', ParseUUIDPipe) channelId: string,
      @Body() dto: ChatChannelInputDto,
      @UserId() userId: string,
    ): Promise<ChatChannelDto> {
      await this.assertEnabled();

      return this._channels.update(
        routes.scopeOf(communityId, id),
        channelId,
        dto,
        userId,
      );
    }

    /**
     * Archives a custom channel.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param channelId - The channel.
     * @param userId - The moderator.
     */
    @Post(':channelId/archive')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Archive a custom chat channel' })
    async archive(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Param('channelId', ParseUUIDPipe) channelId: string,
      @UserId() userId: string,
    ): Promise<void> {
      await this.assertEnabled();

      await this._channels.archive(
        routes.scopeOf(communityId, id),
        channelId,
        userId,
      );
    }

    /**
     * Refuses while chat is switched off.
     *
     * @throws NotFoundException when it is.
     */
    async assertEnabled(): Promise<void> {
      await this._featureService.assertFlagEnabled(
        FLEET_FEATURE_FLAGS.CHAT_ENABLED,
      );
    }
  }

  return ChatChannelController;
}

/** A Community's own channels. */
export class CommunityChatController extends chatChannelController({
  path: 'fleet-communities/:communityId/chat/channels',
  param: 'communityId',
  scopeOf: communityId => communityScope(communityId),
}) {}

/** A Fleet's channels. */
export class FleetChatController extends chatChannelController({
  path: 'fleet-communities/:communityId/fleets/:fleetId/chat/channels',
  param: 'fleetId',
  scopeOf: fleetScope,
}) {}

/** An Armada's channels. */
export class ArmadaChatController extends chatChannelController({
  path: 'fleet-communities/:communityId/armadas/:armadaId/chat/channels',
  param: 'armadaId',
  scopeOf: armadaScope,
}) {}

/**
 * Somebody's own chat (FC-031): every channel they may read, their
 * conversations with friends, and the messages in each.
 */
@ApiTags('Fleet chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  /**
   * Creates an instance of ChatController.
   *
   * @param _featureService - Reports whether chat is switched on.
   * @param _channels - Channels.
   * @param _messages - Messages.
   * @param _direct - Conversations.
   * @param _delivery - Tells sockets reading a place what changed.
   * @param _presence - Says who is online (FC-034).
   */
  constructor(
    private readonly _featureService: FleetFeatureService,
    private readonly _channels: ChatChannelService,
    private readonly _messages: ChatMessageService,
    private readonly _direct: ChatDirectService,
    private readonly _delivery: ChatDeliveryService,
    private readonly _presence: ChatPresenceService,
  ) {}

  /**
   * Lists every channel the caller may read, scope by scope.
   *
   * @param userId - The caller.
   * @returns Each scope's channels.
   */
  @Get('channels')
  @ApiOperation({ summary: 'List your chat channels' })
  @ApiOkResponse({ type: [ChatScopeChannelsDto] })
  async channels(@UserId() userId: string): Promise<ChatScopeChannelsDto[]> {
    await this.assertEnabled();

    return this._channels.mine(userId);
  }

  /**
   * Reads a page of a channel, within the last four hours.
   *
   * @param channelId - The channel.
   * @param userId - The caller.
   * @param query - Where to carry on from, and any words to find.
   * @returns The page.
   */
  @Get('channels/:channelId/messages')
  @ApiOperation({ summary: 'Read a chat channel' })
  @ApiOkResponse({ type: ChatMessagePageDto })
  async channelMessages(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @UserId() userId: string,
    @Query() query: ChatMessagesQueryDto,
  ): Promise<ChatMessagePageDto> {
    await this.assertEnabled();

    return this._messages.readChannel(channelId, userId, query);
  }

  /**
   * Posts in a channel.
   *
   * @param channelId - The channel.
   * @param userId - The caller.
   * @param dto - What it says, and the client's ID for it.
   * @returns The message.
   */
  @Post('channels/:channelId/messages')
  @ApiOperation({ summary: 'Post in a chat channel' })
  @ApiOkResponse({ type: ChatMessageDto })
  async postToChannel(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @UserId() userId: string,
    @Body() dto: ChatPostDto,
  ): Promise<ChatMessageDto> {
    await this.assertEnabled();

    const message = await this._messages.postToChannel(channelId, userId, dto);

    void this._delivery.publish({
      kind: 'message',
      place: { channelId },
      message,
    });

    return message;
  }

  /**
   * Finds people who can read a channel, for a mention.
   *
   * @param channelId - The channel.
   * @param userId - The caller.
   * @param query - The start of the username.
   * @returns Up to ten.
   */
  @Get('channels/:channelId/people')
  @ApiOperation({ summary: 'Find people to mention in a chat channel' })
  @ApiOkResponse({ type: [ChatPersonDto] })
  async people(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @UserId() userId: string,
    @Query() query: ChatPeopleQueryDto,
  ): Promise<ChatPersonDto[]> {
    await this.assertEnabled();

    return this._messages.people(channelId, userId, query.q);
  }

  /**
   * Says who of some people is online, as the caller may know it (FC-034).
   *
   * @param userId - The caller.
   * @param query - The people, by username.
   * @returns Each, online or not; anybody the caller may not see is not.
   */
  @Get('presence')
  @ApiOperation({ summary: 'Ask who is online' })
  @ApiOkResponse({ type: [ChatPresenceDto] })
  async presence(
    @UserId() userId: string,
    @Query() query: ChatPresenceQueryDto,
  ): Promise<ChatPresenceDto[]> {
    await this.assertEnabled();

    return this._presence.onlineFor(userId, query.usernames);
  }

  /**
   * Reads one message, within the last four hours.
   *
   * @param messageId - The message.
   * @param userId - The caller.
   * @returns The message.
   */
  @Get('messages/:messageId')
  @ApiOperation({ summary: 'Read one chat message' })
  @ApiOkResponse({ type: ChatMessageDto })
  async message(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @UserId() userId: string,
  ): Promise<ChatMessageDto> {
    await this.assertEnabled();

    return this._messages.readOne(messageId, userId);
  }

  /**
   * Deletes a message: the caller's own, or one a moderator removes.
   *
   * @param messageId - The message.
   * @param userId - The caller.
   * @param dto - Why, for a moderator.
   */
  @Delete('messages/:messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a chat message' })
  async remove(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @UserId() userId: string,
    @Body() dto: ChatRemoveDto,
  ): Promise<void> {
    await this.assertEnabled();

    const deletion = await this._messages.remove(messageId, userId, dto);

    if (deletion !== null) {
      void this._delivery.publish({
        kind: 'deleted',
        place: deletion.place,
        messageId,
        removed: deletion.removed,
      });
    }
  }

  /**
   * Lists the caller's conversations with friends.
   *
   * @param userId - The caller.
   * @returns Each conversation.
   */
  @Get('direct')
  @ApiOperation({ summary: 'List your direct conversations' })
  @ApiOkResponse({ type: [ChatConversationDto] })
  async conversations(
    @UserId() userId: string,
  ): Promise<ChatConversationDto[]> {
    await this.assertEnabled();

    return this._direct.conversations(userId);
  }

  /**
   * Opens the conversation with a friend, named by their ID or by the
   * friendship.
   *
   * @param userId - The caller.
   * @param dto - The friend, or the friendship.
   * @returns The conversation.
   * @throws BadRequestException when it names neither, or both.
   */
  @Post('direct')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Open a direct conversation with a friend' })
  @ApiOkResponse({ type: ChatConversationDto })
  async open(
    @UserId() userId: string,
    @Body() dto: ChatOpenConversationDto,
  ): Promise<ChatConversationDto> {
    await this.assertEnabled();

    if ((dto.userId === undefined) === (dto.friendshipId === undefined)) {
      throw new BadRequestException('Name one friend, or one friendship.');
    }

    return this._direct.open(
      userId,
      dto.userId ??
        (await this._direct.friendOf(userId, dto.friendshipId as string)),
    );
  }

  /**
   * Reads a page of a conversation, within the last four hours.
   *
   * @param conversationId - The conversation.
   * @param userId - The caller.
   * @param query - Where to carry on from, and any words to find.
   * @returns The page.
   */
  @Get('direct/:conversationId/messages')
  @ApiOperation({ summary: 'Read a direct conversation' })
  @ApiOkResponse({ type: ChatMessagePageDto })
  async conversationMessages(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @UserId() userId: string,
    @Query() query: ChatMessagesQueryDto,
  ): Promise<ChatMessagePageDto> {
    await this.assertEnabled();

    return this._messages.readConversation(conversationId, userId, query);
  }

  /**
   * Posts in a conversation.
   *
   * @param conversationId - The conversation.
   * @param userId - The caller.
   * @param dto - What it says, and the client's ID for it.
   * @returns The message.
   */
  @Post('direct/:conversationId/messages')
  @ApiOperation({ summary: 'Post in a direct conversation' })
  @ApiOkResponse({ type: ChatMessageDto })
  async postToConversation(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @UserId() userId: string,
    @Body() dto: ChatPostDto,
  ): Promise<ChatMessageDto> {
    await this.assertEnabled();

    const message = await this._messages.postToConversation(
      conversationId,
      userId,
      dto,
    );

    void this._delivery.publish({
      kind: 'message',
      place: { conversationId },
      message,
    });

    return message;
  }

  /**
   * Refuses while chat is switched off.
   *
   * @throws NotFoundException when it is.
   */
  private async assertEnabled(): Promise<void> {
    await this._featureService.assertFlagEnabled(
      FLEET_FEATURE_FLAGS.CHAT_ENABLED,
    );
  }
}
