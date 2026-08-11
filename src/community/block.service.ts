import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { BlockedMemberDto } from './dto/blocked-member.dto';
import { CreateBlockDto } from './dto/create-block.dto';
import { FriendshipEntity } from './entities/friendship.entity';
import { UserBlockEntity } from './entities/user-block.entity';
import { PublicMemberService } from './public-member.service';

/**
 * Blocking between members.
 *
 * A block is stored one-sided — who blocked whom — but enforced symmetrically
 * everywhere it is read: {@link getBlockedUserIds} returns both directions, so
 * a single row hides each member's registry record from the other and stops
 * friend requests either way round.
 *
 * Blocking is deliberately silent. Nothing here is readable by the blocked
 * member, and the registry answers a blocked lookup with the same 404 it gives
 * for a member who never existed, so a block cannot be detected by probing.
 */
@Injectable()
export class BlockService {
  /**
   * Creates an instance of BlockService.
   *
   * @param _blockRepository - The user-block repository.
   * @param _friendshipRepository - The friendship repository, used to tear down
   *   any existing friendship when a block is created.
   * @param _publicMemberService - Resolves and maps members.
   */
  constructor(
    @InjectRepository(UserBlockEntity)
    private readonly _blockRepository: Repository<UserBlockEntity>,
    @InjectRepository(FriendshipEntity)
    private readonly _friendshipRepository: Repository<FriendshipEntity>,
    private readonly _publicMemberService: PublicMemberService,
  ) {}

  /**
   * Blocks a member, tearing down any friendship or pending request between
   * the two in the process.
   *
   * Idempotent: blocking someone who is already blocked returns the existing
   * block rather than failing.
   *
   * @param userId - The blocking member's user ID.
   * @param dto - The member to block and an optional private note.
   * @returns The block.
   * @throws {BadRequestException} When a member tries to block themselves.
   * @throws {NotFoundException} When no active member matches the username.
   */
  async blockMember(
    userId: string,
    dto: CreateBlockDto,
  ): Promise<BlockedMemberDto> {
    const target = await this._publicMemberService.requireActiveMember(
      dto.username,
    );

    if (target.userId === userId) {
      throw new BadRequestException('You cannot block yourself');
    }

    const block = await this.upsertBlock(userId, target.userId, dto.reason);
    await this.removeFriendshipBetween(userId, target.userId);

    return this.toBlockedMember(block, target.userId);
  }

  /**
   * Lifts a block.
   *
   * Unblocking only removes the barrier — it does not restore the friendship
   * the block tore down. Either member has to ask again.
   *
   * @param userId - The blocking member's user ID.
   * @param blockId - The block to lift.
   * @throws {NotFoundException} When the caller has no such live block.
   */
  async unblockMember(userId: string, blockId: string): Promise<void> {
    const block = await this._blockRepository.findOne({
      where: { id: blockId, blockerId: userId, deletedAt: IsNull() },
    });

    if (!block) {
      throw new NotFoundException('Block not found');
    }

    await this._blockRepository.softRemove(block);
  }

  /**
   * Lists the members the caller has blocked, newest first.
   *
   * @param userId - The blocking member's user ID.
   * @returns The caller's blocks.
   */
  async findBlockedMembers(userId: string): Promise<BlockedMemberDto[]> {
    const blocks = await this._blockRepository.find({
      where: { blockerId: userId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });

    const members = await this._publicMemberService.findMembersByUserIds(
      blocks.map(block => block.blockedId),
    );

    return blocks
      .filter(block => members.has(block.blockedId))
      .map(block => ({
        id: block.id,
        member: members.get(block.blockedId)!,
        blockedAt: block.createdAt,
        reason: block.reason,
      }));
  }

  /**
   * Returns every user ID the caller is blocked from seeing, in either
   * direction — those they blocked and those who blocked them.
   *
   * This is the single list the registry excludes on every read.
   *
   * @param userId - The viewing member's user ID, or null when anonymous.
   * @returns The user IDs to hide, empty for anonymous callers.
   */
  async getBlockedUserIds(userId: string | null): Promise<string[]> {
    if (!userId) {
      return [];
    }

    const blocks = await this._blockRepository
      .createQueryBuilder('block')
      .select(['block.blockerId', 'block.blockedId'])
      .where('(block.blockerId = :userId OR block.blockedId = :userId)', {
        userId,
      })
      .andWhere('block.deletedAt IS NULL')
      .getMany();

    const blocked = new Set<string>();
    for (const block of blocks) {
      blocked.add(
        block.blockerId === userId ? block.blockedId : block.blockerId,
      );
    }

    return [...blocked];
  }

  /**
   * Tests whether a block exists between two members in either direction.
   *
   * @param userId - The first member's user ID.
   * @param otherUserId - The second member's user ID.
   * @returns True when either has blocked the other.
   */
  isBlockedBetween(userId: string, otherUserId: string): Promise<boolean> {
    return this._blockRepository
      .createQueryBuilder('block')
      .where(
        '((block.blockerId = :userId AND block.blockedId = :otherUserId) OR ' +
          '(block.blockerId = :otherUserId AND block.blockedId = :userId))',
        { userId, otherUserId },
      )
      .andWhere('block.deletedAt IS NULL')
      .getExists();
  }

  /**
   * Finds the caller's own block against a member, if they have one.
   *
   * Only the blocker's own row is returned, so this can safely drive the
   * "unblock" action on a profile without revealing a block held the other way.
   *
   * @param userId - The blocking member's user ID.
   * @param otherUserId - The member who may be blocked.
   * @returns The block, or null when the caller has not blocked them.
   */
  findOwnBlock(
    userId: string,
    otherUserId: string,
  ): Promise<UserBlockEntity | null> {
    return this._blockRepository.findOne({
      where: { blockerId: userId, blockedId: otherUserId, deletedAt: IsNull() },
    });
  }

  /**
   * Counts the members the caller has blocked.
   *
   * @param userId - The blocking member's user ID.
   * @returns The number of live blocks.
   */
  countBlocked(userId: string): Promise<number> {
    return this._blockRepository.count({
      where: { blockerId: userId, deletedAt: IsNull() },
    });
  }

  /**
   * Creates the block, or returns the existing one.
   *
   * A previously lifted block is revived in place rather than replaced, so the
   * partial unique index on the pair stays satisfied.
   *
   * @param blockerId - The blocking member's user ID.
   * @param blockedId - The blocked member's user ID.
   * @param reason - The blocker's optional private note.
   * @returns The live block.
   */
  private async upsertBlock(
    blockerId: string,
    blockedId: string,
    reason?: string,
  ): Promise<UserBlockEntity> {
    const existing = await this._blockRepository.findOne({
      where: { blockerId, blockedId },
      withDeleted: true,
    });

    if (existing) {
      existing.deletedAt = null;
      existing.reason = reason ?? existing.reason;
      return this._blockRepository.save(existing);
    }

    return this._blockRepository.save(
      this._blockRepository.create({
        blockerId,
        blockedId,
        reason: reason ?? null,
      }),
    );
  }

  /**
   * Soft-deletes any friendship or pending request between two members.
   *
   * The row is removed rather than left in place so that, once the block is
   * lifted, the pair starts from a clean slate instead of silently resuming a
   * friendship neither party re-confirmed.
   *
   * @param userId - The blocking member's user ID.
   * @param otherUserId - The blocked member's user ID.
   */
  private async removeFriendshipBetween(
    userId: string,
    otherUserId: string,
  ): Promise<void> {
    const friendships = await this._friendshipRepository
      .createQueryBuilder('friendship')
      .where(
        '((friendship.requesterId = :userId AND friendship.addresseeId = :otherUserId) OR ' +
          '(friendship.requesterId = :otherUserId AND friendship.addresseeId = :userId))',
        { userId, otherUserId },
      )
      .andWhere('friendship.deletedAt IS NULL')
      .getMany();

    if (friendships.length > 0) {
      await this._friendshipRepository.softRemove(friendships);
    }
  }

  /**
   * Maps a block onto its DTO.
   *
   * @param block - The block entity.
   * @param blockedUserId - The blocked member's user ID.
   * @returns The block DTO.
   * @throws {NotFoundException} When the blocked member is no longer active.
   */
  private async toBlockedMember(
    block: UserBlockEntity,
    blockedUserId: string,
  ): Promise<BlockedMemberDto> {
    const members = await this._publicMemberService.findMembersByUserIds([
      blockedUserId,
    ]);
    const member = members.get(blockedUserId);

    if (!member) {
      throw new NotFoundException('Member not found');
    }

    return {
      id: block.id,
      member,
      blockedAt: block.createdAt,
      reason: block.reason,
    };
  }
}
