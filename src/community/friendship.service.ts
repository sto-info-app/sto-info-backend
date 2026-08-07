import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { NotificationSeverity } from '../notification/enums/notification-severity.enum';
import { NotificationTarget } from '../notification/enums/notification-target.enum';
import { NotificationService } from '../notification/notification.service';
import { UserProfileEntity } from '../user/entities/user-profile.entity';
import { BlockService } from './block.service';
import { CreateFriendRequestDto } from './dto/create-friend-request.dto';
import { FriendsQueryDto } from './dto/friends-query.dto';
import {
  CommunitySummaryDto,
  FriendDto,
  FriendRequestDto,
  PaginatedFriendsDto,
  RelationshipDto,
} from './dto/friendship.dto';
import { FriendshipEntity } from './entities/friendship.entity';
import { FriendRequestDirection } from './enums/friend-request-direction.enum';
import { FriendshipStatus } from './enums/friendship-status.enum';
import { RelationshipStatus } from './enums/relationship-status.enum';
import { PublicMemberService } from './public-member.service';
import { escapeSqlLikeTerm } from '../shared/utilities/sql-like.utility';

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 50;
const MIN_PAGE_SIZE = 1;

/**
 * Select alias for the other member's lower-cased username, used to order the
 * friend list alphabetically from the caller's point of view.
 */
const FRIEND_USERNAME_SORT_ALIAS = 'friend_username_lower';

/**
 * Where the friend-request notifications deep-link to.
 *
 * @returns The absolute URL of the friends page, or null when the frontend URL
 *   is not configured.
 */
const friendsPageUrl = (): string | null => {
  const frontendUrl = process.env.APP_FRONTEND_URL;
  return frontendUrl ? `${frontendUrl}/community/friends` : null;
};

/**
 * Friend requests and the friendships they become.
 *
 * The friendship table stores one row per pair, keeping the direction of the
 * original request so the service knows who may cancel and who may respond.
 * Every mutation here re-checks blocking first: a block is the stronger
 * signal, and it must not be possible to route around one by replying to a
 * request that predates it.
 */
@Injectable()
export class FriendshipService {
  /**
   * Creates an instance of FriendshipService.
   *
   * @param _friendshipRepository - The friendship repository.
   * @param _publicMemberService - Resolves and maps members.
   * @param _blockService - Enforces blocking between members.
   * @param _notificationService - Sends friend-request notifications.
   */
  constructor(
    @InjectRepository(FriendshipEntity)
    private readonly _friendshipRepository: Repository<FriendshipEntity>,
    private readonly _publicMemberService: PublicMemberService,
    private readonly _blockService: BlockService,
    private readonly _notificationService: NotificationService,
  ) {}

  /**
   * Sends a friend request.
   *
   * Two conveniences fall out of storing one row per pair: requesting someone
   * who has already requested you accepts their request instead of creating a
   * second one, and requesting someone who previously declined revives that
   * row rather than being blocked by the unique index.
   *
   * @param userId - The requesting member's user ID.
   * @param dto - The recipient's username.
   * @returns The pending request, or the accepted friendship when the request
   *   completed a mutual pair.
   * @throws {BadRequestException} When a member requests themselves.
   * @throws {NotFoundException} When the recipient has no public record.
   * @throws {ForbiddenException} When either member has blocked the other.
   * @throws {ConflictException} When a request or friendship already exists.
   */
  async sendRequest(
    userId: string,
    dto: CreateFriendRequestDto,
  ): Promise<FriendRequestDto | FriendDto> {
    const target = await this._publicMemberService.requireActiveMember(
      dto.username,
    );

    if (target.userId === userId) {
      throw new BadRequestException('You cannot add yourself as a friend');
    }

    // Only members who have opened their record can be found in the registry,
    // so only they can be sent a request. Blocking, by contrast, works against
    // any member — see `BlockService.blockMember`.
    if (!target.publiclyVisible) {
      throw new NotFoundException('Member not found');
    }

    await this.assertNotBlocked(userId, target.userId);

    const existing = await this.findFriendshipBetween(userId, target.userId);

    if (existing) {
      return this.resolveExistingOnRequest(userId, target, existing);
    }

    const friendship = await this._friendshipRepository.save(
      this._friendshipRepository.create({
        requesterId: userId,
        addresseeId: target.userId,
        status: FriendshipStatus.PENDING,
      }),
    );

    await this.notifyRequestReceived(userId, target.userId);

    return this.toOutgoingRequest(friendship, userId);
  }

  /**
   * Accepts a friend request addressed to the caller.
   *
   * @param userId - The responding member's user ID.
   * @param friendshipId - The request to accept.
   * @returns The resulting friendship.
   * @throws {NotFoundException} When the caller has no such pending request.
   */
  async acceptRequest(
    userId: string,
    friendshipId: string,
  ): Promise<FriendDto> {
    const friendship = await this.requireIncomingRequest(userId, friendshipId);

    const accepted = await this.accept(friendship);
    await this.notifyRequestAccepted(userId, friendship.requesterId);

    return this.toFriend(accepted, userId);
  }

  /**
   * Declines a friend request addressed to the caller.
   *
   * The row is kept as declined rather than deleted so the decision is not
   * silently lost; the requester may ask again, which revives the same row.
   * The requester is not notified.
   *
   * @param userId - The responding member's user ID.
   * @param friendshipId - The request to decline.
   * @throws {NotFoundException} When the caller has no such pending request.
   */
  async declineRequest(userId: string, friendshipId: string): Promise<void> {
    const friendship = await this.requireIncomingRequest(userId, friendshipId);

    friendship.status = FriendshipStatus.DECLINED;
    friendship.respondedAt = new Date();

    await this._friendshipRepository.save(friendship);
  }

  /**
   * Withdraws a request the caller sent.
   *
   * @param userId - The requesting member's user ID.
   * @param friendshipId - The request to withdraw.
   * @throws {NotFoundException} When the caller has no such pending request.
   */
  async cancelRequest(userId: string, friendshipId: string): Promise<void> {
    const friendship = await this._friendshipRepository.findOne({
      where: {
        id: friendshipId,
        requesterId: userId,
        status: FriendshipStatus.PENDING,
        deletedAt: IsNull(),
      },
    });

    if (!friendship) {
      throw new NotFoundException('Friend request not found');
    }

    await this._friendshipRepository.softRemove(friendship);
  }

  /**
   * Ends a friendship. Either member may do this, and the other is not told.
   *
   * @param userId - The member ending the friendship.
   * @param friendshipId - The friendship to end.
   * @throws {NotFoundException} When the caller has no such friendship.
   */
  async removeFriend(userId: string, friendshipId: string): Promise<void> {
    const friendship = await this._friendshipRepository
      .createQueryBuilder('friendship')
      .where('friendship.id = :friendshipId', { friendshipId })
      .andWhere('friendship.status = :status', {
        status: FriendshipStatus.ACCEPTED,
      })
      .andWhere(
        '(friendship.requesterId = :userId OR friendship.addresseeId = :userId)',
        { userId },
      )
      .andWhere('friendship.deletedAt IS NULL')
      .getOne();

    if (!friendship) {
      throw new NotFoundException('Friendship not found');
    }

    await this._friendshipRepository.softRemove(friendship);
  }

  /**
   * Lists the caller's friends alphabetically.
   *
   * A friend who has since made their record private stays in the list — they
   * are still a friend — but is flagged as no longer publicly visible so the
   * client can stop linking to a profile that would 404.
   *
   * @param userId - The caller's user ID.
   * @param query - Search and pagination options.
   * @returns A page of friends.
   */
  async findFriends(
    userId: string,
    query: FriendsQueryDto,
  ): Promise<PaginatedFriendsDto> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = this.clampPageSize(query.pageSize);

    const queryBuilder = this.friendsQuery(userId);
    this.applySearch(queryBuilder, query.search);

    const [friendships, total] = await queryBuilder
      .orderBy(FRIEND_USERNAME_SORT_ALIAS, 'ASC')
      // Stable tie-break so paging cannot repeat or skip a friend.
      .addOrderBy('friendship.id', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    const items = await this.toFriends(friendships, userId);

    return { items, total, page, pageSize };
  }

  /**
   * Lists the caller's pending requests in one direction, newest first.
   *
   * @param userId - The caller's user ID.
   * @param direction - Whether to list requests received or sent.
   * @returns The pending requests.
   */
  async findRequests(
    userId: string,
    direction: FriendRequestDirection,
  ): Promise<FriendRequestDto[]> {
    const isIncoming = direction === FriendRequestDirection.INCOMING;

    const friendships = await this._friendshipRepository.find({
      where: {
        ...(isIncoming ? { addresseeId: userId } : { requesterId: userId }),
        status: FriendshipStatus.PENDING,
        deletedAt: IsNull(),
      },
      order: { createdAt: 'DESC' },
    });

    const members = await this._publicMemberService.findMembersByUserIds(
      friendships.map(friendship => friendship.otherUserId(userId)),
    );

    return friendships
      .filter(friendship => members.has(friendship.otherUserId(userId)))
      .map(friendship => ({
        id: friendship.id,
        direction,
        member: members.get(friendship.otherUserId(userId))!,
        requestedAt: friendship.createdAt,
      }));
  }

  /**
   * Returns the caller's friend and request counts, for navigation badges.
   *
   * @param userId - The caller's user ID.
   * @returns The community counts.
   */
  async getSummary(userId: string): Promise<CommunitySummaryDto> {
    const [
      friendCount,
      incomingRequestCount,
      outgoingRequestCount,
      blockedCount,
    ] = await Promise.all([
      this.friendsQuery(userId).getCount(),
      this._friendshipRepository.count({
        where: {
          addresseeId: userId,
          status: FriendshipStatus.PENDING,
          deletedAt: IsNull(),
        },
      }),
      this._friendshipRepository.count({
        where: {
          requesterId: userId,
          status: FriendshipStatus.PENDING,
          deletedAt: IsNull(),
        },
      }),
      this._blockService.countBlocked(userId),
    ]);

    return {
      friendCount,
      incomingRequestCount,
      outgoingRequestCount,
      blockedCount,
    };
  }

  /**
   * Describes how the caller relates to another member.
   *
   * Only the caller's own block is reported. A block held against them reads
   * as no relationship, matching the 404 the registry gives for that member.
   *
   * @param userId - The caller's user ID.
   * @param otherUserId - The member being viewed.
   * @returns The relationship, with the row ID the matching action needs.
   */
  async getRelationship(
    userId: string,
    otherUserId: string,
  ): Promise<RelationshipDto> {
    if (userId === otherUserId) {
      return {
        status: RelationshipStatus.SELF,
        friendshipId: null,
        blockId: null,
      };
    }

    const ownBlock = await this._blockService.findOwnBlock(userId, otherUserId);
    if (ownBlock) {
      return {
        status: RelationshipStatus.BLOCKED,
        friendshipId: null,
        blockId: ownBlock.id,
      };
    }

    const friendship = await this.findFriendshipBetween(userId, otherUserId);

    return friendship
      ? this.toRelationship(friendship, userId)
      : this.noRelationship();
  }

  /**
   * Describes how the caller relates to each of a set of members, in one query.
   *
   * Used by the registry listing, which needs a relationship per card and must
   * not fan out into a query per member. Blocking is not consulted: the listing
   * has already excluded every member on either end of a block with the caller,
   * so no card can be in a blocked state.
   *
   * @param userId - The caller's user ID.
   * @param otherUserIds - The members being listed.
   * @returns A map from user ID to relationship, with an entry for every member
   *   asked about.
   */
  async getRelationships(
    userId: string,
    otherUserIds: string[],
  ): Promise<Map<string, RelationshipDto>> {
    const relationships = new Map<string, RelationshipDto>();
    if (otherUserIds.length === 0) {
      return relationships;
    }

    const friendships = await this._friendshipRepository
      .createQueryBuilder('friendship')
      .where(
        '((friendship.requesterId = :userId AND friendship.addresseeId IN (:...otherUserIds)) OR ' +
          '(friendship.addresseeId = :userId AND friendship.requesterId IN (:...otherUserIds)))',
        { userId, otherUserIds },
      )
      .andWhere('friendship.deletedAt IS NULL')
      .getMany();

    for (const friendship of friendships) {
      relationships.set(
        friendship.otherUserId(userId),
        this.toRelationship(friendship, userId),
      );
    }

    for (const otherUserId of otherUserIds) {
      if (otherUserId === userId) {
        relationships.set(userId, {
          status: RelationshipStatus.SELF,
          friendshipId: null,
          blockId: null,
        });
      } else if (!relationships.has(otherUserId)) {
        relationships.set(otherUserId, this.noRelationship());
      }
    }

    return relationships;
  }

  /**
   * Finds the live friendship row between two members, in either direction.
   *
   * @param userId - The first member's user ID.
   * @param otherUserId - The second member's user ID.
   * @returns The friendship, or null when the pair has none.
   */
  findFriendshipBetween(
    userId: string,
    otherUserId: string,
  ): Promise<FriendshipEntity | null> {
    return this._friendshipRepository
      .createQueryBuilder('friendship')
      .where(
        '((friendship.requesterId = :userId AND friendship.addresseeId = :otherUserId) OR ' +
          '(friendship.requesterId = :otherUserId AND friendship.addresseeId = :userId))',
        { userId, otherUserId },
      )
      .andWhere('friendship.deletedAt IS NULL')
      .getOne();
  }

  /**
   * Decides what a repeat request against an existing row should do.
   *
   * @param userId - The requesting member's user ID.
   * @param target - The recipient's profile.
   * @param existing - The friendship row already covering the pair.
   * @returns The pending request, or the friendship when the pair became
   *   mutual.
   * @throws {ConflictException} When a request or friendship already stands.
   */
  private async resolveExistingOnRequest(
    userId: string,
    target: UserProfileEntity,
    existing: FriendshipEntity,
  ): Promise<FriendRequestDto | FriendDto> {
    if (existing.status === FriendshipStatus.ACCEPTED) {
      throw new ConflictException('You are already friends with this member');
    }

    if (existing.status === FriendshipStatus.PENDING) {
      if (existing.requesterId === userId) {
        throw new ConflictException('A request is already pending');
      }

      // They asked first. Treating this as an acceptance is both what the
      // member meant and the only way to avoid a second row for the pair.
      const accepted = await this.accept(existing);
      await this.notifyRequestAccepted(userId, existing.requesterId);

      return this.toFriend(accepted, userId);
    }

    // Declined: revive the row in the caller's direction rather than insert a
    // second one, which the partial unique index would reject anyway.
    existing.requesterId = userId;
    existing.addresseeId = target.userId;
    existing.status = FriendshipStatus.PENDING;
    existing.respondedAt = null;

    const revived = await this._friendshipRepository.save(existing);
    await this.notifyRequestReceived(userId, target.userId);

    return this.toOutgoingRequest(revived, userId);
  }

  /**
   * Loads a pending request addressed to the caller, refusing it if a block
   * has appeared since it was sent.
   *
   * @param userId - The responding member's user ID.
   * @param friendshipId - The request ID.
   * @returns The pending request.
   * @throws {NotFoundException} When there is no such request, or a block now
   *   stands between the two.
   */
  private async requireIncomingRequest(
    userId: string,
    friendshipId: string,
  ): Promise<FriendshipEntity> {
    const friendship = await this._friendshipRepository.findOne({
      where: {
        id: friendshipId,
        addresseeId: userId,
        status: FriendshipStatus.PENDING,
        deletedAt: IsNull(),
      },
    });

    if (!friendship) {
      throw new NotFoundException('Friend request not found');
    }

    const blocked = await this._blockService.isBlockedBetween(
      userId,
      friendship.requesterId,
    );

    if (blocked) {
      throw new NotFoundException('Friend request not found');
    }

    return friendship;
  }

  /**
   * Marks a friendship accepted.
   *
   * @param friendship - The pending friendship.
   * @returns The saved friendship.
   */
  private accept(friendship: FriendshipEntity): Promise<FriendshipEntity> {
    friendship.status = FriendshipStatus.ACCEPTED;
    friendship.respondedAt = new Date();

    return this._friendshipRepository.save(friendship);
  }

  /**
   * Refuses an action when either member has blocked the other.
   *
   * @param userId - The acting member's user ID.
   * @param otherUserId - The other member's user ID.
   * @throws {ForbiddenException} When a block stands between the two.
   */
  private async assertNotBlocked(
    userId: string,
    otherUserId: string,
  ): Promise<void> {
    const blocked = await this._blockService.isBlockedBetween(
      userId,
      otherUserId,
    );

    if (blocked) {
      // Deliberately vague: the caller must not be able to tell a block they
      // hold from one held against them.
      throw new ForbiddenException(
        'You cannot send a friend request to this member',
      );
    }
  }

  /**
   * Builds the base query for the caller's accepted friendships, joined to
   * both profiles so the list can be ordered and searched by the other
   * member's username.
   *
   * @param userId - The caller's user ID.
   * @returns A query builder filtered to live friendships.
   */
  private friendsQuery(userId: string): SelectQueryBuilder<FriendshipEntity> {
    return (
      this._friendshipRepository
        .createQueryBuilder('friendship')
        .innerJoin(
          UserProfileEntity,
          'requesterProfile',
          'requesterProfile.userId = friendship.requesterId',
        )
        .innerJoin(
          UserProfileEntity,
          'addresseeProfile',
          'addresseeProfile.userId = friendship.addresseeId',
        )
        // Selected as an alias because TypeORM's `orderBy` tries to resolve a
        // bare expression as an entity alias and fails.
        .addSelect(this.otherUsernameExpression(), FRIEND_USERNAME_SORT_ALIAS)
        .where(
          '(friendship.requesterId = :userId OR friendship.addresseeId = :userId)',
        )
        .andWhere('friendship.status = :status')
        .andWhere('friendship.deletedAt IS NULL')
        .setParameters({ userId, status: FriendshipStatus.ACCEPTED })
    );
  }

  /**
   * The SQL expression for the other member's lower-cased username.
   *
   * @returns The CASE expression, parameterised on `:userId`.
   */
  private otherUsernameExpression(): string {
    return (
      'LOWER(CASE WHEN friendship.requesterId = :userId ' +
      'THEN addresseeProfile.username ELSE requesterProfile.username END)'
    );
  }

  /**
   * Applies a case-insensitive search against the other member's username.
   *
   * LIKE wildcards in the user-supplied term are escaped so a search for `%`
   * matches a literal percent sign rather than every friend.
   *
   * @param queryBuilder - The query to narrow.
   * @param search - The raw search term.
   */
  private applySearch(
    queryBuilder: SelectQueryBuilder<FriendshipEntity>,
    search?: string,
  ): void {
    const term = search?.trim();
    if (!term) {
      return;
    }

    const escaped = escapeSqlLikeTerm(term);

    queryBuilder.andWhere(`${this.otherUsernameExpression()} LIKE :search`, {
      search: `%${escaped}%`,
    });
  }

  /**
   * Clamps a requested page size into the supported range.
   *
   * @param pageSize - The requested page size.
   * @returns A page size between 1 and 50.
   */
  private clampPageSize(pageSize?: number): number {
    if (!pageSize || pageSize < MIN_PAGE_SIZE) {
      return DEFAULT_PAGE_SIZE;
    }

    return Math.min(pageSize, MAX_PAGE_SIZE);
  }

  /**
   * Maps friendships onto their DTOs, dropping any whose other member is no
   * longer active.
   *
   * @param friendships - The accepted friendships.
   * @param userId - The caller's user ID.
   * @returns The friend DTOs.
   */
  private async toFriends(
    friendships: FriendshipEntity[],
    userId: string,
  ): Promise<FriendDto[]> {
    const members = await this._publicMemberService.findMembersByUserIds(
      friendships.map(friendship => friendship.otherUserId(userId)),
    );

    return friendships
      .filter(friendship => members.has(friendship.otherUserId(userId)))
      .map(friendship => ({
        id: friendship.id,
        member: members.get(friendship.otherUserId(userId))!,
        friendsSince: friendship.respondedAt,
      }));
  }

  /**
   * Maps a single friendship onto its DTO.
   *
   * @param friendship - The accepted friendship.
   * @param userId - The caller's user ID.
   * @returns The friend DTO.
   * @throws {NotFoundException} When the other member is no longer active.
   */
  private async toFriend(
    friendship: FriendshipEntity,
    userId: string,
  ): Promise<FriendDto> {
    const [friend] = await this.toFriends([friendship], userId);

    if (!friend) {
      throw new NotFoundException('Member not found');
    }

    return friend;
  }

  /**
   * Maps a request the caller just sent onto its DTO.
   *
   * Only ever reached from {@link sendRequest}, where the caller is by
   * definition the requester, so the direction is always outgoing.
   *
   * @param friendship - The pending friendship.
   * @param userId - The caller's user ID.
   * @returns The request DTO.
   * @throws {NotFoundException} When the recipient is no longer active.
   */
  private async toOutgoingRequest(
    friendship: FriendshipEntity,
    userId: string,
  ): Promise<FriendRequestDto> {
    const otherUserId = friendship.otherUserId(userId);
    const members = await this._publicMemberService.findMembersByUserIds([
      otherUserId,
    ]);
    const member = members.get(otherUserId);

    if (!member) {
      throw new NotFoundException('Member not found');
    }

    return {
      id: friendship.id,
      direction: FriendRequestDirection.OUTGOING,
      member,
      requestedAt: friendship.createdAt,
    };
  }

  /**
   * Maps a live friendship row onto the caller's relationship.
   *
   * A declined row reads as no relationship: the requester may ask again, so
   * the client should offer to add rather than report a dead end.
   *
   * @param friendship - The friendship row.
   * @param userId - The caller's user ID.
   * @returns The relationship.
   */
  private toRelationship(
    friendship: FriendshipEntity,
    userId: string,
  ): RelationshipDto {
    if (friendship.status === FriendshipStatus.DECLINED) {
      return this.noRelationship();
    }

    return {
      status: this.toRelationshipStatus(friendship, userId),
      friendshipId: friendship.id,
      blockId: null,
    };
  }

  /**
   * The relationship reported when the pair has no live friendship.
   *
   * @returns An empty relationship.
   */
  private noRelationship(): RelationshipDto {
    return {
      status: RelationshipStatus.NONE,
      friendshipId: null,
      blockId: null,
    };
  }

  /**
   * Maps a live friendship onto the caller's relationship status.
   *
   * @param friendship - The friendship row.
   * @param userId - The caller's user ID.
   * @returns The relationship status.
   */
  private toRelationshipStatus(
    friendship: FriendshipEntity,
    userId: string,
  ): RelationshipStatus {
    if (friendship.status === FriendshipStatus.ACCEPTED) {
      return RelationshipStatus.FRIENDS;
    }

    return friendship.requesterId === userId
      ? RelationshipStatus.REQUEST_SENT
      : RelationshipStatus.REQUEST_RECEIVED;
  }

  /**
   * Tells a member they have a new friend request.
   *
   * @param requesterId - The requesting member's user ID.
   * @param addresseeId - The recipient's user ID.
   */
  private async notifyRequestReceived(
    requesterId: string,
    addresseeId: string,
  ): Promise<void> {
    const username = await this.usernameOf(requesterId);

    await this.notify(
      addresseeId,
      'New friend request',
      `${username} would like to add you as a friend.`,
    );
  }

  /**
   * Tells a member their friend request was accepted.
   *
   * @param accepterId - The member who accepted.
   * @param requesterId - The member who originally asked.
   */
  private async notifyRequestAccepted(
    accepterId: string,
    requesterId: string,
  ): Promise<void> {
    const username = await this.usernameOf(accepterId);

    await this.notify(
      requesterId,
      'Friend request accepted',
      `${username} accepted your friend request.`,
    );
  }

  /**
   * Delivers an inbox notification, swallowing any failure.
   *
   * A friendship must not fail to save because the notification could not be
   * written — the relationship is the durable part, the inbox entry is not.
   *
   * @param userId - The recipient's user ID.
   * @param title - The notification title.
   * @param body - The notification body.
   */
  private async notify(
    userId: string,
    title: string,
    body: string,
  ): Promise<void> {
    const linkUrl = friendsPageUrl();

    try {
      await this._notificationService.createNotification({
        target: NotificationTarget.USER,
        userId,
        severity: NotificationSeverity.INFO,
        title,
        body,
        ...(linkUrl ? { linkUrl } : {}),
      });
    } catch {
      // Intentionally ignored — see the method comment.
    }
  }

  /**
   * Looks up a member's username for notification copy.
   *
   * @param userId - The member's user ID.
   * @returns The username, or a neutral fallback when it cannot be resolved.
   */
  private async usernameOf(userId: string): Promise<string> {
    const members = await this._publicMemberService.findMembersByUserIds([
      userId,
    ]);

    return members.get(userId)?.username ?? 'A member';
  }
}
