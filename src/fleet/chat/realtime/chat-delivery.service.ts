import { HttpException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { Namespace } from 'socket.io';
import { DataSource } from 'typeorm';

import { UserEntity } from 'src/user/entities/user.entity';

import { ChatMessageDto, ChatPersonDto } from '../dto/chat.dto';
import { ChatChannelEntity } from '../entities/chat-channel.entity';
import { ChatDirectConversationEntity } from '../entities/chat-direct-conversation.entity';
import { ChatDirectService } from '../services/chat-direct.service';
import {
  ChatMessageService,
  ChatPlace,
} from '../services/chat-message.service';
import { ChatPresenceService } from './chat-presence.service';
import {
  channelRoom,
  CHAT_DELIVERY_CHECK_TTL_MS,
  CHAT_FANOUT_EVENT,
  CHAT_REVOKE_EVENT,
  CHAT_SERVER_EVENTS,
  conversationRoom,
  userRoom,
} from './chat-socket.constants';

/** Something to tell a place's readers. */
export type ChatFanout =
  | {
      readonly kind: 'message';
      readonly place: ChatPlace;
      readonly message: ChatMessageDto;
    }
  | {
      readonly kind: 'deleted';
      readonly place: ChatPlace;
      readonly messageId: string;
      /** Whether somebody other than its author removed it (FC-050). */
      readonly removed: boolean;
    }
  | {
      readonly kind: 'typing';
      readonly place: ChatPlace;
      readonly user: ChatPersonDto;
    };

/** Whose right to read may have changed (FC-034). */
export type ChatAccessChange =
  | { readonly kind: 'people'; readonly userIds: readonly string[] }
  | { readonly kind: 'everyone' };

/** How many remembered answers are kept before the stale ones are cleared. */
const CHECKS_KEPT = 5_000;

/**
 * The room a place's readers are in.
 *
 * @param place - The channel or conversation.
 * @returns Its room.
 */
export function roomOf(place: ChatPlace): string {
  return place.channelId === undefined
    ? conversationRoom(place.conversationId)
    : channelRoom(place.channelId);
}

/**
 * The place a room is for, if it is a place's.
 *
 * @param room - The room.
 * @returns Its channel or conversation, or null for a person's room.
 */
export function placeOfRoom(room: string): ChatPlace | null {
  const [kind, id] = room.split(':');

  if (kind === 'channel') {
    return { channelId: id };
  }

  return kind === 'conversation' ? { conversationId: id } : null;
}

/**
 * A message as somebody across a block from its author sees it: nobody and
 * nothing (FC-034).
 *
 * @param message - The message.
 * @returns It, hidden.
 */
function hidden(message: ChatMessageDto): ChatMessageDto {
  return {
    ...message,
    author: null,
    body: null,
    clientMessageId: message.id,
    mine: false,
    hidden: true,
    mentions: [],
    replyTo: null,
  };
}

/**
 * Carries committed messages to the sockets reading their place (FC-032),
 * and takes away what may no longer be read (FC-034).
 *
 * Steve's decisions of 28 and 29 September 2026: a message is told to a
 * reader only if they may read its place at that moment — their account
 * still in use, still a member with the channel's role, still friends and
 * unblocked — each answer trusted for a few seconds at most, and forgotten at
 * once when a membership, role, Armada placement, friendship or block
 * changes. A socket that may no longer read a place leaves its room and is
 * told so. A message from somebody across a block from the reader arrives
 * with nobody and nothing in it, and a reply shows nothing of a message they
 * wrote. Every instance delivers to its own sockets, and passes the message
 * to the others through the Redis adapter. Delivery is at least once: a
 * client keeps the first copy of each message ID. Nothing is kept here that a
 * reconnect cannot fetch again from the database.
 */
@Injectable()
export class ChatDeliveryService {
  private readonly _logger = new Logger(ChatDeliveryService.name);

  /** The chat namespace, once the gateway has started. */
  private _server: Namespace | null = null;

  /** Recent answers, by reader and place: allowed, and until when. */
  private readonly _checks = new Map<
    string,
    { readonly allowed: boolean; readonly until: number }
  >();

  /** Recent blocks, by person: who is across one from them, and until when. */
  private readonly _blocks = new Map<
    string,
    { readonly value: ReadonlySet<string>; readonly until: number }
  >();

  /**
   * Creates an instance of ChatDeliveryService.
   *
   * @param _dataSource - The database.
   * @param _messages - Says who may read a channel.
   * @param _direct - Says who may use a conversation, and who is blocked.
   * @param _presence - Says whose typing to share.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _messages: ChatMessageService,
    private readonly _direct: ChatDirectService,
    private readonly _presence: ChatPresenceService,
  ) {}

  /**
   * Starts delivering through the chat namespace, and hearing what the other
   * instances pass on.
   *
   * @param server - The namespace.
   */
  attach(server: Namespace): void {
    this._server = server;
    server.on(CHAT_FANOUT_EVENT, (fanout: ChatFanout) => {
      void this.deliverLocally(fanout);
    });
    server.on(CHAT_REVOKE_EVENT, (change: ChatAccessChange) => {
      void this.recheckLocally(change);
    });
  }

  /**
   * Tells a place's readers, on every instance, and the people a new message
   * is for — its mentions, or the other person in a conversation — wherever
   * they are on the site. Does nothing before the gateway has started.
   *
   * @param fanout - What to tell them.
   */
  async publish(fanout: ChatFanout): Promise<void> {
    if (this._server === null) {
      return;
    }

    this._server.serverSideEmit(CHAT_FANOUT_EVENT, fanout);
    await this.deliverLocally(fanout);

    if (fanout.kind === 'message') {
      await this.notice(fanout.place, fanout.message);
    }
  }

  /**
   * Has every instance check again the sockets a change may concern.
   *
   * @param change - Whose right to read may have changed.
   */
  async revoke(change: ChatAccessChange): Promise<void> {
    if (this._server === null) {
      return;
    }

    this._server.serverSideEmit(CHAT_REVOKE_EVENT, change);
    await this.recheckLocally(change);

    if (change.kind === 'people') {
      await this._presence.refresh(change.userIds);
    }
  }

  /**
   * Checks again this instance's sockets a change may concern, forgetting
   * what was known of them first, and takes each out of every place it may
   * no longer read.
   *
   * @param change - Whose right to read may have changed.
   */
  async recheckLocally(change: ChatAccessChange): Promise<void> {
    const server = this._server as Namespace;

    this.forget(change);

    try {
      const sockets =
        change.kind === 'everyone'
          ? await server.local.fetchSockets()
          : (
              await Promise.all(
                change.userIds.map(userId =>
                  server.local.in(userRoom(userId)).fetchSockets(),
                ),
              )
            ).flat();

      for (const socket of sockets) {
        for (const room of [...socket.rooms]) {
          const place = placeOfRoom(room);

          if (
            place !== null &&
            !(await this.mayReceive(socket.data.userId as string, place))
          ) {
            socket.leave(room);
            socket.emit(CHAT_SERVER_EVENTS.REMOVED, place);
          }
        }
      }
    } catch (error) {
      this._logger.error(
        '[revoke] Chat access check failed',
        (error as Error).stack,
      );
    }
  }

  /**
   * Tells this instance's sockets in a place's room, each only if its reader
   * may still read it; the others leave the room.
   *
   * @param fanout - What to tell them.
   */
  async deliverLocally(fanout: ChatFanout): Promise<void> {
    const server = this._server as Namespace;
    const room = roomOf(fanout.place);

    try {
      const sockets = await server.local.in(room).fetchSockets();

      for (const socket of sockets) {
        const userId = socket.data.userId as string;

        if (!(await this.mayReceive(userId, fanout.place))) {
          socket.leave(room);
          socket.emit(CHAT_SERVER_EVENTS.REMOVED, fanout.place);
          continue;
        }

        const blocked = await this.blockedFor(userId);

        if (fanout.kind === 'message') {
          socket.emit(
            CHAT_SERVER_EVENTS.MESSAGE,
            this.asSeenBy(fanout.message, userId, blocked),
          );
        } else if (fanout.kind === 'deleted') {
          socket.emit(CHAT_SERVER_EVENTS.DELETED, {
            ...fanout.place,
            messageId: fanout.messageId,
            removed: fanout.removed,
          });
        } else if (
          fanout.user.userId !== userId &&
          !blocked.has(fanout.user.userId) &&
          (await this._presence.typingEnabled(userId))
        ) {
          socket.emit(CHAT_SERVER_EVENTS.TYPING, {
            ...fanout.place,
            user: fanout.user,
          });
        }
      }
    } catch (error) {
      this._logger.error(
        `[deliver] Chat delivery failed - Room: ${room}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Whether somebody has chat open anywhere, on any instance.
   *
   * @param userId - The person.
   * @returns True while any of their sockets is connected.
   */
  async isConnected(userId: string): Promise<boolean> {
    if (this._server === null) {
      return false;
    }

    return (await this._server.in(userRoom(userId)).fetchSockets()).length > 0;
  }

  /**
   * Whether somebody's account is still in use.
   *
   * @param userId - The person.
   * @returns True while it exists and is not disabled.
   */
  async isActive(userId: string): Promise<boolean> {
    return this.remembered(`account:${userId}`, async () => {
      const user = await this._dataSource.manager.findOne(UserEntity, {
        where: { id: userId },
        select: { id: true, isAccountDisabled: true },
      });

      return user !== null && !user.isAccountDisabled;
    });
  }

  /**
   * Whether somebody may be told about a place now.
   *
   * @param userId - The reader.
   * @param place - The channel or conversation.
   * @returns True while their account is in use and they may read it.
   */
  async mayReceive(userId: string, place: ChatPlace): Promise<boolean> {
    if (!(await this.isActive(userId))) {
      return false;
    }

    return this.remembered(`${userId}:${roomOf(place)}`, async () => {
      try {
        if (place.channelId === undefined) {
          await this._direct.usable(place.conversationId, userId);
        } else {
          await this._messages.readableChannel(place.channelId, userId);
        }

        return true;
      } catch (error) {
        if (error instanceof HttpException) {
          return false;
        }

        throw error;
      }
    });
  }

  /**
   * Who is across a block from somebody, trusted for a few seconds.
   *
   * @param userId - The person.
   * @returns Who they have blocked, and who has blocked them.
   */
  async blockedFor(userId: string): Promise<ReadonlySet<string>> {
    const known = this._blocks.get(userId);

    if (known !== undefined && known.until > Date.now()) {
      return known.value;
    }

    const value = await this._direct.blockedFor(userId);

    this._blocks.set(userId, {
      value,
      until: Date.now() + CHAT_DELIVERY_CHECK_TTL_MS,
    });

    return value;
  }

  /**
   * A message as one reader sees it: theirs or not, and nothing of anybody
   * across a block from them.
   *
   * @param message - The message.
   * @param userId - The reader.
   * @param blocked - Who is across a block from them.
   * @returns What they are told.
   */
  private asSeenBy(
    message: ChatMessageDto,
    userId: string,
    blocked: ReadonlySet<string>,
  ): ChatMessageDto {
    if (message.author !== null && blocked.has(message.author.userId)) {
      return hidden(message);
    }

    const answeredAuthor = message.replyTo?.author?.userId;

    return {
      ...message,
      mine: message.author?.userId === userId,
      replyTo:
        answeredAuthor !== undefined && blocked.has(answeredAuthor)
          ? {
              id: (message.replyTo as { id: string }).id,
              author: null,
              excerpt: null,
            }
          : message.replyTo,
    };
  }

  /**
   * Tells the people a new message is for, wherever they are on the site:
   * the other person in a conversation, or each person it mentions in a
   * channel. Who and where, never what.
   *
   * @param place - Where it is.
   * @param message - The message.
   */
  private async notice(
    place: ChatPlace,
    message: ChatMessageDto,
  ): Promise<void> {
    const server = this._server as Namespace;
    const manager = this._dataSource.manager;
    const from = message.author;

    if (place.channelId === undefined) {
      const conversation = (await manager.findOne(
        ChatDirectConversationEntity,
        {
          where: { id: place.conversationId },
        },
      )) as ChatDirectConversationEntity;
      const other =
        conversation.userLowId === from?.userId
          ? conversation.userHighId
          : conversation.userLowId;

      server
        .in(userRoom(other))
        .emit(CHAT_SERVER_EVENTS.NOTICE, { kind: 'direct', ...place, from });

      return;
    }

    if (message.mentions.length === 0) {
      return;
    }

    const channel = (await manager.findOne(ChatChannelEntity, {
      where: { id: place.channelId },
    })) as ChatChannelEntity;

    for (const person of message.mentions) {
      server.in(userRoom(person.userId)).emit(CHAT_SERVER_EVENTS.NOTICE, {
        kind: 'mention',
        ...place,
        channelName: channel.name,
        from,
      });
    }
  }

  /**
   * Forgets what was known of the people a change concerns, or of everybody.
   *
   * @param change - Whose right to read may have changed.
   */
  private forget(change: ChatAccessChange): void {
    if (change.kind === 'everyone') {
      this._checks.clear();
      this._blocks.clear();

      return;
    }

    for (const userId of change.userIds) {
      this._blocks.delete(userId);

      for (const key of [...this._checks.keys()]) {
        if (key.includes(userId)) {
          this._checks.delete(key);
        }
      }
    }
  }

  /**
   * An answer from the last few seconds, or a fresh one.
   *
   * @param key - What was asked.
   * @param ask - How to find out.
   * @returns The answer.
   */
  private async remembered(
    key: string,
    ask: () => Promise<boolean>,
  ): Promise<boolean> {
    const now = Date.now();
    const known = this._checks.get(key);

    if (known !== undefined && known.until > now) {
      return known.allowed;
    }

    const allowed = await ask();

    if (this._checks.size >= CHECKS_KEPT) {
      for (const [each, check] of this._checks) {
        if (check.until <= now) {
          this._checks.delete(each);
        }
      }
    }

    this._checks.set(key, { allowed, until: now + CHAT_DELIVERY_CHECK_TTL_MS });

    return allowed;
  }
}
