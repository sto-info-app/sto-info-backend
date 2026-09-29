import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  QueryDeepPartialEntity,
} from 'typeorm';

import { BlockService } from 'src/community/block.service';
import { FriendshipEntity } from 'src/community/entities/friendship.entity';
import { FriendshipStatus } from 'src/community/enums/friendship-status.enum';
import { FriendshipService } from 'src/community/friendship.service';

import { usernamesFor } from '../../recruitment/utilities/recruitment-names.utility';
import { ChatConversationDto } from '../dto/chat.dto';
import { ChatDirectConversationEntity } from '../entities/chat-direct-conversation.entity';

/** A conversation somebody may use, and who it is with. */
export interface UsableConversation {
  readonly conversation: ChatDirectConversationEntity;
  readonly otherUserId: string;
}

/**
 * Conversations between two people (FC-031).
 *
 * Steve's decisions of 28 September 2026: only between friends, and only
 * two people — there is no group route. Whether a pair may use theirs is
 * asked at every read and post: once they stop being friends, or either
 * blocks the other, it is closed and its history hidden, and becoming
 * friends again opens it with only the last four hours to read, as ever. A
 * closed conversation answers as absent, so a block's existence is never
 * told.
 */
@Injectable()
export class ChatDirectService {
  /**
   * Creates an instance of ChatDirectService.
   *
   * @param _dataSource - The database.
   * @param _friendships - Says who is friends with whom.
   * @param _blocks - Says who has blocked whom.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _friendships: FriendshipService,
    private readonly _blocks: BlockService,
  ) {}

  /**
   * Opens the conversation with a friend, making it the first time.
   *
   * @param userId - Who is opening it.
   * @param otherUserId - The friend.
   * @returns The conversation.
   * @throws BadRequestException when they name themselves.
   * @throws NotFoundException when they are not friends, or either has
   *   blocked the other.
   */
  async open(
    userId: string,
    otherUserId: string,
  ): Promise<ChatConversationDto> {
    if (userId === otherUserId) {
      throw new BadRequestException('A conversation needs somebody else.');
    }

    await this.assertMayTalk(userId, otherUserId);

    const [userLowId, userHighId] = [userId, otherUserId].sort();
    const manager = this._dataSource.manager;

    await manager
      .createQueryBuilder()
      .insert()
      .into(ChatDirectConversationEntity)
      .values({
        userLowId,
        userHighId,
      } as QueryDeepPartialEntity<ChatDirectConversationEntity>)
      .orIgnore()
      .execute();

    const conversation = (await manager.findOne(ChatDirectConversationEntity, {
      where: { userLowId, userHighId },
    })) as ChatDirectConversationEntity;

    return (await this.toDtos([{ conversation, otherUserId }]))[0];
  }

  /**
   * The other person in one of somebody's friendships.
   *
   * @param userId - The person.
   * @param friendshipId - The friendship.
   * @returns The friend.
   * @throws NotFoundException when it is not an accepted friendship of theirs.
   */
  async friendOf(userId: string, friendshipId: string): Promise<string> {
    const friendship = await this._dataSource.manager.findOne(
      FriendshipEntity,
      { where: { id: friendshipId, status: FriendshipStatus.ACCEPTED } },
    );

    if (
      friendship === null ||
      (friendship.requesterId !== userId && friendship.addresseeId !== userId)
    ) {
      throw new NotFoundException('Not found');
    }

    return friendship.requesterId === userId
      ? friendship.addresseeId
      : friendship.requesterId;
  }

  /**
   * Lists somebody's conversations still open to them, by the friend's name.
   *
   * @param userId - The person.
   * @returns Each conversation with a friend neither has blocked.
   */
  async conversations(userId: string): Promise<ChatConversationDto[]> {
    const manager = this._dataSource.manager;
    const [low, high, blocked] = await Promise.all([
      manager.find(ChatDirectConversationEntity, {
        where: { userLowId: userId },
      }),
      manager.find(ChatDirectConversationEntity, {
        where: { userHighId: userId },
      }),
      this._blocks.getBlockedUserIds(userId),
    ]);
    const all = [
      ...low.map(conversation => ({
        conversation,
        otherUserId: conversation.userHighId,
      })),
      ...high.map(conversation => ({
        conversation,
        otherUserId: conversation.userLowId,
      })),
    ].filter(entry => !blocked.includes(entry.otherUserId));
    const friends = await this.friendsAmong(
      userId,
      all.map(entry => entry.otherUserId),
    );

    return (
      await this.toDtos(all.filter(entry => friends.has(entry.otherUserId)))
    ).sort((a, b) =>
      (a.other.username ?? '').localeCompare(b.other.username ?? '', 'en'),
    );
  }

  /**
   * Requires that somebody may use a conversation now.
   *
   * @param conversationId - The conversation.
   * @param userId - The person.
   * @returns It, and who it is with.
   * @throws NotFoundException when it is not theirs, or is closed.
   */
  async usable(
    conversationId: string,
    userId: string,
  ): Promise<UsableConversation> {
    const conversation = await this._dataSource.manager.findOne(
      ChatDirectConversationEntity,
      { where: { id: conversationId } },
    );

    if (
      conversation === null ||
      (conversation.userLowId !== userId && conversation.userHighId !== userId)
    ) {
      throw new NotFoundException('Not found');
    }

    const otherUserId =
      conversation.userLowId === userId
        ? conversation.userHighId
        : conversation.userLowId;

    await this.assertMayTalk(userId, otherUserId);

    return { conversation, otherUserId };
  }

  /**
   * Takes the one notice a conversation may send somebody while they are
   * away, if it has not been sent since they last opened it (FC-033).
   *
   * @param manager - The transaction posting the message.
   * @param conversation - The conversation.
   * @param userId - Who would be told.
   * @returns True when they may be told now.
   */
  async takeNotice(
    manager: EntityManager,
    conversation: ChatDirectConversationEntity,
    userId: string,
  ): Promise<boolean> {
    const side = sideOf(conversation, userId);
    const taken = await manager.update(
      ChatDirectConversationEntity,
      { id: conversation.id, [side]: IsNull() },
      { [side]: new Date() },
    );

    return taken.affected === 1;
  }

  /**
   * Lets a conversation tell somebody of the next message while they are
   * away: they have opened it, or had chat open when told.
   *
   * @param conversation - The conversation.
   * @param userId - Who.
   * @param manager - The transaction to use, if any.
   */
  async rearmNotice(
    conversation: ChatDirectConversationEntity,
    userId: string,
    manager: EntityManager = this._dataSource.manager,
  ): Promise<void> {
    await manager.update(
      ChatDirectConversationEntity,
      { id: conversation.id },
      { [sideOf(conversation, userId)]: null },
    );
  }

  /**
   * The people on the other side of a block from somebody, either way
   * (FC-034).
   *
   * @param userId - The person.
   * @returns Who they have blocked, and who has blocked them.
   */
  async blockedFor(userId: string): Promise<Set<string>> {
    return new Set(await this._blocks.getBlockedUserIds(userId));
  }

  /**
   * Requires that two people are friends and neither has blocked the other.
   *
   * @param userId - One.
   * @param otherUserId - The other.
   * @throws NotFoundException when they may not talk.
   */
  async assertMayTalk(userId: string, otherUserId: string): Promise<void> {
    const [friendship, blocked] = await Promise.all([
      this._friendships.findFriendshipBetween(userId, otherUserId),
      this._blocks.isBlockedBetween(userId, otherUserId),
    ]);

    if (friendship?.status !== FriendshipStatus.ACCEPTED || blocked) {
      throw new NotFoundException('Not found');
    }
  }

  /**
   * Which of some people somebody is friends with.
   *
   * @param userId - The person.
   * @param others - The people.
   * @returns Those who are accepted friends.
   */
  async friendsAmong(
    userId: string,
    others: readonly string[],
  ): Promise<Set<string>> {
    if (others.length === 0) {
      return new Set();
    }

    const manager = this._dataSource.manager;
    const where = { status: FriendshipStatus.ACCEPTED };
    const rows = await manager.find(FriendshipEntity, {
      where: [
        { ...where, requesterId: userId, addresseeId: In([...others]) },
        { ...where, addresseeId: userId, requesterId: In([...others]) },
      ],
    });

    return new Set(
      rows.map(row =>
        row.requesterId === userId ? row.addresseeId : row.requesterId,
      ),
    );
  }

  /**
   * Shows conversations, naming the friend by username.
   *
   * @param entries - Each conversation and who it is with.
   * @returns Each.
   */
  private async toDtos(
    entries: readonly UsableConversation[],
  ): Promise<ChatConversationDto[]> {
    const names = await usernamesFor(
      this._dataSource.manager,
      entries.map(entry => entry.otherUserId),
    );

    return entries.map(entry => ({
      id: entry.conversation.id,
      other: {
        userId: entry.otherUserId,
        username: names.get(entry.otherUserId) ?? null,
      },
    }));
  }
}

/**
 * Which of a conversation's two columns is somebody's.
 *
 * @param conversation - The conversation.
 * @param userId - Who.
 * @returns Their notice column.
 */
function sideOf(
  conversation: Pick<ChatDirectConversationEntity, 'userLowId'>,
  userId: string,
): 'lowNoticedAt' | 'highNoticedAt' {
  return conversation.userLowId === userId ? 'lowNoticedAt' : 'highNoticedAt';
}
