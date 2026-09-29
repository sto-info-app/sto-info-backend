import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import {
  And,
  DataSource,
  EntityManager,
  Equal,
  FindOptionsWhere,
  ILike,
  In,
  IsNull,
  LessThan,
  MoreThan,
  MoreThanOrEqual,
  Not,
  QueryFailedError,
} from 'typeorm';

import { NotificationOutboxKind } from 'src/notification/outbox/notification-outbox-kind.enum';
import {
  OutboxEntry,
  queueOutbox,
} from 'src/notification/outbox/notification-outbox.utility';
import { escapeSqlLikeTerm } from 'src/shared/utilities/sql-like.utility';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { FleetPolicyService } from '../../fleet-policy.service';
import { usernamesFor } from '../../recruitment/utilities/recruitment-names.utility';
import { purgeInBatches } from '../../retention/purge-in-batches.utility';
import { RetentionOutcome } from '../../retention/retention-run.service';
import {
  CHAT_REPLY_EXCERPT_LENGTH,
  ChatMessageDto,
  ChatMessagePageDto,
  ChatMessagesQueryDto,
  ChatPersonDto,
  ChatPostDto,
  ChatRemoveDto,
  ChatReplyDto,
} from '../dto/chat.dto';
import { ChatActionEntity } from '../entities/chat-action.entity';
import { ChatChannelEntity } from '../entities/chat-channel.entity';
import { ChatMessageEntity } from '../entities/chat-message.entity';
import { ChatActionKind } from '../enums/chat.enums';
import { heldAuthors } from '../holds/moderation-hold.utility';
import { ChatAccessService, ChatStanding } from './chat-access.service';
import { ChatDirectService } from './chat-direct.service';

/** How many messages a page holds. */
export const CHAT_PAGE_SIZE = 50;

/** How many messages one person may post in {@link CHAT_RATE_WINDOW_MS}. */
export const CHAT_RATE_LIMIT = 10;

/** The span the rate limit counts over, in milliseconds. */
export const CHAT_RATE_WINDOW_MS = 10_000;

/** One hour, in milliseconds. */
const HOUR = 3_600_000;

/** One day, in milliseconds. */
const DAY = 86_400_000;

/** How many people the mention list offers. */
const PEOPLE_OFFERED = 10;

/** How many usernames are weighed to find them. */
const PEOPLE_WEIGHED = 25;

/** Where a message is: a channel or a conversation. */
export type ChatPlace =
  | { readonly channelId: string; readonly conversationId?: undefined }
  | { readonly conversationId: string; readonly channelId?: undefined };

/** A channel somebody may read, and who they are there. */
interface ReadableChannel {
  readonly channel: ChatChannelEntity;
  readonly standing: ChatStanding;
}

/** Who a message's place lets be named and told (FC-033). */
interface ChatAudience {
  /** Of some people, those who can read the place. */
  readonly readersAmong: (userIds: readonly string[]) => Promise<string[]>;
  /** The direct-message notice, when the place is a conversation. */
  readonly directNotice?: (
    manager: EntityManager,
    message: ChatMessageEntity,
  ) => Promise<OutboxEntry[]>;
}

/**
 * Messages in channels and conversations (FC-031).
 *
 * R22 and Steve's decisions of 28 September 2026: nothing older than four
 * hours is ever read here — not by cursor, search or ID — and a message is
 * plain text, 2,000 characters at most, ten a person in any ten seconds.
 * A resend with the same client ID is the same message. Authors delete their
 * own; a scope's `chat.moderate` holders remove anyone's in its channels,
 * with a reason, logged. Messages go after the retention period.
 */
@Injectable()
export class ChatMessageService {
  /**
   * Creates an instance of ChatMessageService.
   *
   * @param _dataSource - The database.
   * @param _access - Says who somebody is in a scope's chat.
   * @param _direct - Says who may use a conversation.
   * @param _policy - The published chat limits.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _access: ChatAccessService,
    private readonly _direct: ChatDirectService,
    private readonly _policy: FleetPolicyService,
  ) {}

  /**
   * Reads a page of a channel.
   *
   * @param channelId - The channel.
   * @param userId - The reader.
   * @param query - Where to carry on from, and any words to find.
   * @returns The page, oldest first.
   * @throws NotFoundException when they may not read it.
   */
  async readChannel(
    channelId: string,
    userId: string,
    query: ChatMessagesQueryDto,
  ): Promise<ChatMessagePageDto> {
    await this.readableChannel(channelId, userId);

    return this.page({ channelId }, userId, query);
  }

  /**
   * Reads a page of a conversation.
   *
   * @param conversationId - The conversation.
   * @param userId - The reader.
   * @param query - Where to carry on from, and any words to find.
   * @returns The page, oldest first.
   * @throws NotFoundException when it is not theirs to use.
   */
  async readConversation(
    conversationId: string,
    userId: string,
    query: ChatMessagesQueryDto,
  ): Promise<ChatMessagePageDto> {
    const { conversation } = await this._direct.usable(conversationId, userId);

    // Opening it lets the next message while they are away tell them.
    await this._direct.rearmNotice(conversation, userId);

    return this.page({ conversationId }, userId, query);
  }

  /**
   * Reads one message, while it is within the window and the reader may.
   *
   * @param messageId - The message.
   * @param userId - The reader.
   * @returns The message.
   * @throws NotFoundException when it is older, or not theirs to read.
   */
  async readOne(messageId: string, userId: string): Promise<ChatMessageDto> {
    const message = await this.readableMessage(messageId, userId);

    return (await this.toDtos([message], userId))[0];
  }

  /**
   * Posts in a channel.
   *
   * @param channelId - The channel.
   * @param userId - The author.
   * @param dto - What it says, and the client's ID for it.
   * @returns The message.
   * @throws NotFoundException when they may not read it.
   * @throws ForbiddenException when they may read but not post.
   */
  async postToChannel(
    channelId: string,
    userId: string,
    dto: ChatPostDto,
  ): Promise<ChatMessageDto> {
    const { channel, standing } = await this.readableChannel(channelId, userId);

    if (!this._access.canPost(channel, standing)) {
      throw new ForbiddenException('You cannot post in this channel.');
    }

    return this.post({ channelId }, userId, dto, {
      readersAmong: userIds => this.readersAmong(channel, userIds),
    });
  }

  /**
   * Posts in a conversation.
   *
   * @param conversationId - The conversation.
   * @param userId - The author.
   * @param dto - What it says, and the client's ID for it.
   * @returns The message.
   * @throws NotFoundException when it is not theirs to use.
   */
  async postToConversation(
    conversationId: string,
    userId: string,
    dto: ChatPostDto,
  ): Promise<ChatMessageDto> {
    const { conversation, otherUserId } = await this._direct.usable(
      conversationId,
      userId,
    );

    return this.post({ conversationId }, userId, dto, {
      readersAmong: userIds =>
        Promise.resolve(userIds.filter(each => each === otherUserId)),
      directNotice: async (manager, message) =>
        (await this._direct.takeNotice(manager, conversation, otherUserId))
          ? [
              {
                userId: otherUserId,
                kind: NotificationOutboxKind.CHAT_DIRECT_MESSAGE,
                subjectId: message.id,
                dedupeKey: `${NotificationOutboxKind.CHAT_DIRECT_MESSAGE}:${message.id}`,
              },
            ]
          : [],
    });
  }

  /**
   * Deletes a message: the author's own, or anybody's in a channel its
   * moderators run, with a reason.
   *
   * @param messageId - The message.
   * @param userId - Who is deleting it.
   * @param dto - Why, for a moderator.
   * @throws NotFoundException when it is older, or not theirs to read.
   * @throws ForbiddenException when it is somebody else's and they do not
   *   moderate its channel.
   * @returns Where it was, to tell its readers; null when it was already
   *   deleted.
   * @throws BadRequestException when a moderator gives no reason.
   */
  async remove(
    messageId: string,
    userId: string,
    dto: ChatRemoveDto,
  ): Promise<ChatPlace | null> {
    const message = await this.readableMessage(messageId, userId);

    if (message.deletedAt !== null) {
      return null;
    }

    if (message.authorUserId === userId) {
      await this.markDeleted(message, userId);

      return placeOfMessage(message);
    }

    const standing =
      message.channelId === null
        ? null
        : (await this.readableChannel(message.channelId, userId)).standing;

    if (!standing?.mayModerate) {
      throw new ForbiddenException('You may only delete your own messages.');
    }

    if (!dto.reason) {
      throw new BadRequestException('Say why the message is being removed.');
    }

    await this._dataSource.transaction(async manager => {
      await manager.update(
        ChatMessageEntity,
        { id: message.id },
        { deletedAt: new Date(), deletedByUserId: userId },
      );
      await manager.save(ChatActionEntity, {
        channelId: message.channelId,
        messageId: message.id,
        action: ChatActionKind.MESSAGE_REMOVED,
        actorUserId: userId,
        reason: dto.reason,
        detail: { authorUserId: message.authorUserId },
      });
    });

    return placeOfMessage(message);
  }

  /**
   * Finds people who can read a channel, for a mention.
   *
   * @param channelId - The channel.
   * @param userId - Who is writing.
   * @param q - The start of the username.
   * @returns Up to ten others who can read it, by username.
   * @throws NotFoundException when the writer may not read it.
   */
  async people(
    channelId: string,
    userId: string,
    q: string,
  ): Promise<ChatPersonDto[]> {
    const { channel } = await this.readableChannel(channelId, userId);
    const blocked = await this._direct.blockedFor(userId);
    const profiles = await this._dataSource.manager.find(UserProfileEntity, {
      where: {
        username: ILike(`${escapeSqlLikeTerm(q)}%`),
        userId: Not(userId),
      },
      select: { userId: true, username: true },
      order: { username: 'ASC' },
      take: PEOPLE_WEIGHED,
    });
    const readers = new Set(
      await this.readersAmong(
        channel,
        profiles.map(profile => profile.userId),
      ),
    );

    return profiles
      .filter(
        profile => readers.has(profile.userId) && !blocked.has(profile.userId),
      )
      .slice(0, PEOPLE_OFFERED)
      .map(profile => ({ userId: profile.userId, username: profile.username }));
  }

  /**
   * Forgets messages older than the retention period, but for those of a
   * member whose messages a site admin holds (FC-036), a batch at a time
   * (FC-037). Daily, by the Fleet's retention schedule.
   *
   * The purge is its own clock: what a member may read (four hours) and what
   * a transcript may take (seven days) are windows on what is still here,
   * and neither moves when this runs.
   *
   * @returns How many were forgotten, and whether that was all that is due.
   */
  async purge(): Promise<RetentionOutcome> {
    const manager = this._dataSource.manager;
    const cutOff = new Date(Date.now() - this._policy.chatRetentionDays * DAY);
    const held = await heldAuthors(manager);
    const old = { createdAt: LessThan(cutOff) };
    const tally = await purgeInBatches(
      manager,
      ChatMessageEntity,
      held.length === 0
        ? old
        : [
            { ...old, authorUserId: IsNull() },
            { ...old, authorUserId: Not(In(held)) },
          ],
    );

    return {
      counts: { messages: tally.deleted, heldAuthors: held.length },
      complete: tally.complete,
    };
  }

  /**
   * The earliest instant a reader may see.
   *
   * @returns Four hours ago.
   */
  windowStart(): Date {
    return new Date(Date.now() - this._policy.chatMemberHistoryHours * HOUR);
  }

  /**
   * Finds a channel somebody may read.
   *
   * @param channelId - The channel.
   * @param userId - The reader.
   * @returns It, and who they are at its scope.
   * @throws NotFoundException when there is none they may read.
   */
  async readableChannel(
    channelId: string,
    userId: string,
  ): Promise<ReadableChannel> {
    const channel = await this._dataSource.manager.findOne(ChatChannelEntity, {
      where: { id: channelId },
    });

    if (channel === null) {
      throw new NotFoundException('Not found');
    }

    const standing = await this._access.standingAt(
      this._access.scopeOf(channel),
      userId,
    );

    if (!this._access.canRead(channel, standing)) {
      throw new NotFoundException('Not found');
    }

    return { channel, standing };
  }

  /**
   * Shows messages to a reader, by author username.
   *
   * @param messages - The messages.
   * @param userId - The reader.
   * @returns Each, a deleted one without its text.
   */
  async toDtos(
    messages: readonly ChatMessageEntity[],
    userId: string,
  ): Promise<ChatMessageDto[]> {
    const manager = this._dataSource.manager;
    const replyIds = messages
      .map(message => message.replyToMessageId)
      .filter((id): id is string => id !== null);
    const answered =
      replyIds.length === 0
        ? []
        : await manager.find(ChatMessageEntity, {
            where: {
              id: In(replyIds),
              createdAt: MoreThanOrEqual(this.windowStart()),
              deletedAt: IsNull(),
            },
          });
    const answeredById = new Map(answered.map(each => [each.id, each]));
    const names = await usernamesFor(manager, [
      ...messages.map(message => message.authorUserId),
      ...messages.flatMap(message => message.mentions),
      ...answered.map(each => each.authorUserId),
    ]);
    const personOf = (id: string | null): ChatPersonDto | null =>
      id === null ? null : { userId: id, username: names.get(id) ?? null };
    const blocked = await this._direct.blockedFor(userId);

    return messages.map(message =>
      blocked.has(message.authorUserId as string)
        ? hiddenFrom(message)
        : {
            id: message.id,
            channelId: message.channelId,
            conversationId: message.conversationId,
            author:
              message.authorUserId === null
                ? null
                : {
                    userId: message.authorUserId,
                    username: names.get(message.authorUserId) ?? null,
                  },
            body: message.deletedAt === null ? message.body : null,
            clientMessageId: message.clientMessageId,
            createdAt: message.createdAt,
            deleted: message.deletedAt !== null,
            mine: message.authorUserId === userId,
            hidden: false,
            mentions:
              message.deletedAt === null
                ? message.mentions.map(id => personOf(id) as ChatPersonDto)
                : [],
            replyTo:
              message.deletedAt !== null || message.replyToMessageId === null
                ? null
                : replyOf(
                    message.replyToMessageId,
                    blocked.has(
                      answeredById.get(message.replyToMessageId)
                        ?.authorUserId as string,
                    )
                      ? undefined
                      : answeredById.get(message.replyToMessageId),
                    personOf,
                  ),
          },
    );
  }

  /**
   * Finds a message within the window that somebody may read.
   *
   * @param messageId - The message.
   * @param userId - The reader.
   * @returns The message.
   * @throws NotFoundException when there is none.
   */
  private async readableMessage(
    messageId: string,
    userId: string,
  ): Promise<ChatMessageEntity> {
    const message = await this._dataSource.manager.findOne(ChatMessageEntity, {
      where: { id: messageId, createdAt: MoreThanOrEqual(this.windowStart()) },
    });

    if (message === null) {
      throw new NotFoundException('Not found');
    }

    if (message.channelId !== null) {
      await this.readableChannel(message.channelId, userId);
    } else {
      await this._direct.usable(message.conversationId as string, userId);
    }

    return message;
  }

  /**
   * Reads a page within the window, newest first from the database and
   * oldest first to the reader.
   *
   * @param place - The channel or conversation.
   * @param userId - The reader.
   * @param query - Where to carry on from, and any words to find.
   * @returns The page.
   */
  private async page(
    place: ChatPlace,
    userId: string,
    query: ChatMessagesQueryDto,
  ): Promise<ChatMessagePageDto> {
    const floor = this.windowStart();
    const base: FindOptionsWhere<ChatMessageEntity> = {
      ...(place.channelId === undefined
        ? { conversationId: place.conversationId }
        : { channelId: place.channelId }),
      ...(query.q === undefined
        ? {}
        : {
            body: ILike(`%${escapeSqlLikeTerm(query.q)}%`),
            deletedAt: IsNull(),
          }),
    };
    const newer = query.after !== undefined;
    const where = windowed(base, query.after ?? query.before, newer, floor);
    const rows = await this._dataSource.manager.find(ChatMessageEntity, {
      where,
      order: newer
        ? { createdAt: 'ASC', id: 'ASC' }
        : { createdAt: 'DESC', id: 'DESC' },
      take: CHAT_PAGE_SIZE,
    });
    const oldestFirst = newer ? rows : [...rows].reverse();
    const full = rows.length === CHAT_PAGE_SIZE;

    return {
      messages: await this.toDtos(oldestFirst, userId),
      before: !newer && full ? cursorOf(oldestFirst[0]) : null,
    };
  }

  /**
   * Posts a message, once.
   *
   * @param place - The channel or conversation.
   * @param userId - The author.
   * @param dto - What it says, and the client's ID for it.
   * @returns The message, or the one already posted with that ID.
   * @throws ConflictException when that ID was used somewhere else.
   * @throws HttpException 429 when they have posted too many too quickly.
   */
  private async post(
    place: ChatPlace,
    userId: string,
    dto: ChatPostDto,
    audience: ChatAudience,
  ): Promise<ChatMessageDto> {
    const again = await this.alreadyPosted(place, userId, dto.clientMessageId);

    if (again !== null) {
      return again;
    }

    const recent = await this._dataSource.manager.count(ChatMessageEntity, {
      where: {
        authorUserId: userId,
        createdAt: MoreThan(new Date(Date.now() - CHAT_RATE_WINDOW_MS)),
      },
    });

    if (recent >= CHAT_RATE_LIMIT) {
      throw new HttpException(
        `Slow down: at most ${CHAT_RATE_LIMIT} messages every ten seconds.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const blocked = await this._direct.blockedFor(userId);
    const answered = await this.answerable(
      place,
      dto.replyToMessageId,
      blocked,
    );
    const mentions = await audience.readersAmong(
      [...new Set(dto.mentions ?? [])].filter(
        each => each !== userId && !blocked.has(each),
      ),
    );

    try {
      const saved = await this._dataSource.transaction(async manager => {
        const message = await manager.save(ChatMessageEntity, {
          channelId: place.channelId ?? null,
          conversationId: place.conversationId ?? null,
          authorUserId: userId,
          clientMessageId: dto.clientMessageId,
          body: dto.body,
          mentions,
          replyToMessageId: answered?.id ?? null,
          deletedAt: null,
          deletedByUserId: null,
        });

        await queueOutbox(manager, [
          ...noticesOf(message, answered, userId),
          ...((await audience.directNotice?.(manager, message)) ?? []),
        ]);

        return message;
      });

      return (await this.toDtos([saved], userId))[0];
    } catch (error) {
      // The same message sent twice at once: the other one won.
      if (
        error instanceof QueryFailedError &&
        (error as { driverError?: { code?: string } }).driverError?.code ===
          '23505'
      ) {
        return (await this.alreadyPosted(
          place,
          userId,
          dto.clientMessageId,
        )) as ChatMessageDto;
      }

      throw error;
    }
  }

  /**
   * Finds the message a reply answers: in the same place, within the window,
   * not deleted, and not from somebody across a block from the writer.
   *
   * @param place - Where the reply goes.
   * @param messageId - What it answers, if anything.
   * @param blocked - Who is across a block from the writer.
   * @returns The message, or null for no reply.
   * @throws BadRequestException when it cannot be answered.
   */
  private async answerable(
    place: ChatPlace,
    messageId: string | undefined,
    blocked: ReadonlySet<string>,
  ): Promise<ChatMessageEntity | null> {
    if (messageId === undefined) {
      return null;
    }

    const answered = await this._dataSource.manager.findOne(ChatMessageEntity, {
      where: {
        id: messageId,
        createdAt: MoreThanOrEqual(this.windowStart()),
        deletedAt: IsNull(),
      },
    });

    if (
      answered === null ||
      answered.channelId !== (place.channelId ?? null) ||
      answered.conversationId !== (place.conversationId ?? null) ||
      blocked.has(answered.authorUserId as string)
    ) {
      throw new BadRequestException('That message can no longer be answered.');
    }

    return answered;
  }

  /**
   * Of some people, those who can read a channel now.
   *
   * @param channel - The channel.
   * @param userIds - The people.
   * @returns Those who can.
   */
  private async readersAmong(
    channel: ChatChannelEntity,
    userIds: readonly string[],
  ): Promise<string[]> {
    const scope = this._access.scopeOf(channel);
    const readers: string[] = [];

    for (const userId of userIds) {
      if (
        this._access.canRead(
          channel,
          await this._access.standingAt(scope, userId),
        )
      ) {
        readers.push(userId);
      }
    }

    return readers;
  }

  /**
   * Finds a message the author already posted with a client ID.
   *
   * @param place - Where it was meant to go.
   * @param userId - The author.
   * @param clientMessageId - The client's ID for it.
   * @returns It, or null when there is none.
   * @throws ConflictException when that ID was used somewhere else.
   */
  private async alreadyPosted(
    place: ChatPlace,
    userId: string,
    clientMessageId: string,
  ): Promise<ChatMessageDto | null> {
    const existing = await this._dataSource.manager.findOne(ChatMessageEntity, {
      where: { authorUserId: userId, clientMessageId },
    });

    if (existing === null) {
      return null;
    }

    if (
      existing.channelId !== (place.channelId ?? null) ||
      existing.conversationId !== (place.conversationId ?? null)
    ) {
      throw new ConflictException('That message ID was used somewhere else.');
    }

    return (await this.toDtos([existing], userId))[0];
  }

  /**
   * Marks the author's own message deleted.
   *
   * @param message - The message.
   * @param userId - The author.
   */
  private async markDeleted(
    message: ChatMessageEntity,
    userId: string,
  ): Promise<void> {
    await this._dataSource.manager.update(
      ChatMessageEntity,
      { id: message.id },
      { deletedAt: new Date(), deletedByUserId: userId },
    );
  }
}

/**
 * The notices a new message sends: one to each person it mentions, and one
 * to the author of what it answers, unless also mentioned or answering
 * themselves.
 *
 * @param message - The message.
 * @param answered - What it answers, if anything.
 * @param userId - Its author.
 * @returns The notices.
 */
function noticesOf(
  message: ChatMessageEntity,
  answered: ChatMessageEntity | null,
  userId: string,
): OutboxEntry[] {
  const notices: OutboxEntry[] = message.mentions.map(mentioned => ({
    userId: mentioned,
    kind: NotificationOutboxKind.CHAT_MENTION,
    subjectId: message.id,
    dedupeKey: `${NotificationOutboxKind.CHAT_MENTION}:${message.id}:${mentioned}`,
  }));
  const answeredAuthor = answered?.authorUserId ?? null;

  if (
    answeredAuthor !== null &&
    answeredAuthor !== userId &&
    !message.mentions.includes(answeredAuthor)
  ) {
    notices.push({
      userId: answeredAuthor,
      kind: NotificationOutboxKind.CHAT_REPLY,
      subjectId: message.id,
      dedupeKey: `${NotificationOutboxKind.CHAT_REPLY}:${message.id}`,
    });
  }

  return notices;
}

/**
 * A message from somebody across a block from the reader: its place and time,
 * and nothing that says who or what (FC-034).
 *
 * @param message - The message.
 * @returns It, hidden.
 */
export function hiddenFrom(message: ChatMessageEntity): ChatMessageDto {
  return {
    id: message.id,
    channelId: message.channelId,
    conversationId: message.conversationId,
    author: null,
    body: null,
    clientMessageId: message.id,
    createdAt: message.createdAt,
    deleted: false,
    mine: false,
    hidden: true,
    mentions: [],
    replyTo: null,
  };
}

/**
 * What a reply shows of the message it answers.
 *
 * @param id - The answered message.
 * @param answered - It, when still within the window and not deleted.
 * @param personOf - Names somebody.
 * @returns Its author and first words, or neither.
 */
function replyOf(
  id: string,
  answered: ChatMessageEntity | undefined,
  personOf: (userId: string | null) => ChatPersonDto | null,
): ChatReplyDto {
  if (answered === undefined) {
    return { id, author: null, excerpt: null };
  }

  const characters = Array.from(answered.body);

  return {
    id,
    author: personOf(answered.authorUserId),
    excerpt:
      characters.length > CHAT_REPLY_EXCERPT_LENGTH
        ? `${characters.slice(0, CHAT_REPLY_EXCERPT_LENGTH).join('')}…`
        : answered.body,
  };
}

/**
 * Where a message is.
 *
 * @param message - The message.
 * @returns Its channel or its conversation.
 */
function placeOfMessage(
  message: Pick<ChatMessageEntity, 'channelId' | 'conversationId'>,
): ChatPlace {
  return message.channelId === null
    ? { conversationId: message.conversationId as string }
    : { channelId: message.channelId };
}

/**
 * The cursor naming a message, for carrying on from it.
 *
 * @param message - The message.
 * @returns `<ISO instant>_<ID>`.
 */
export function cursorOf(
  message: Pick<ChatMessageDto, 'createdAt' | 'id'>,
): string {
  return `${new Date(message.createdAt).toISOString()}_${message.id}`;
}

/**
 * The conditions for a page: the place, within the window, and after or
 * before a cursor where there is one. The window holds on every path, so a
 * cursor from before it reads nothing older.
 *
 * @param base - The place, and any words to find.
 * @param cursor - The message to carry on from, if any.
 * @param newer - Whether to read after it rather than before.
 * @param floor - The window's start.
 * @returns The conditions, any of which a message may meet.
 */
function windowed(
  base: FindOptionsWhere<ChatMessageEntity>,
  cursor: string | undefined,
  newer: boolean,
  floor: Date,
): FindOptionsWhere<ChatMessageEntity>[] {
  if (cursor === undefined) {
    return [{ ...base, createdAt: MoreThanOrEqual(floor) }];
  }

  const split = cursor.lastIndexOf('_');
  const at = new Date(cursor.slice(0, split));
  const id = cursor.slice(split + 1);
  const conditions: FindOptionsWhere<ChatMessageEntity>[] = [
    {
      ...base,
      createdAt: And(
        newer ? MoreThan(at) : LessThan(at),
        MoreThanOrEqual(floor),
      ),
    },
  ];

  if (at >= floor) {
    conditions.push({
      ...base,
      createdAt: Equal(at),
      id: newer ? MoreThan(id) : LessThan(id),
    });
  }

  return conditions;
}
