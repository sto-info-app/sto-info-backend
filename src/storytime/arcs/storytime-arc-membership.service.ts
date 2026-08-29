import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ArcCapability } from '../collaboration/storytime-arc-capability.enum';
import { ArcMembershipStatus } from '../enums/arc-membership-status.enum';
import { StorytimeActivityType } from '../enums/storytime-activity-type.enum';
import { StorytimeActivityFeedService } from '../social/storytime-activity-feed.service';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeArcStoryEntity } from './entities/storytime-arc-story.entity';
import { StorytimeArcService } from './storytime-arc.service';

/**
 * Statuses in which a Story is considered part of an Arc for the purpose of
 * refusing a second, overlapping request.
 */
const LIVE_STATUSES = [
  ArcMembershipStatus.REQUESTED,
  ArcMembershipStatus.INVITED,
  ArcMembershipStatus.APPROVED,
];

/**
 * Getting a Story into an Arc, and out again.
 *
 * Inclusion is agreed by both sides, and which side still has to agree depends
 * on who started it. A curator inviting a Story needs its owner to accept; an
 * owner offering their Story needs the curator to accept. Either side may walk
 * away at any point, and only an approved membership counts for anything.
 *
 * That symmetry is the whole point: without it, an Arc would be a way to
 * attach yourself to somebody else's work, or to conscript somebody into
 * yours.
 */
@Injectable()
export class StorytimeArcMembershipService {
  private readonly _logger = new Logger(StorytimeArcMembershipService.name);

  /**
   * Creates an instance of StorytimeArcMembershipService.
   *
   * @param _membershipRepository - Repository of Arc memberships.
   * @param _arcService - Decides who curates an Arc.
   * @param _storyService - Decides who owns a Story.
   * @param _feedService - Announces what joins and leaves an Arc.
   */
  constructor(
    @InjectRepository(StorytimeArcStoryEntity)
    private readonly _membershipRepository: Repository<StorytimeArcStoryEntity>,
    private readonly _arcService: StorytimeArcService,
    private readonly _storyService: StorytimeStoryService,
    private readonly _feedService: StorytimeActivityFeedService,
  ) {}

  /**
   * Lists everything in an Arc, whatever state it is in.
   *
   * @param arcId - The Arc.
   * @param actingUserId - The caller, who must curate it.
   * @returns The memberships, in reading order.
   */
  async findByArcForCurator(
    arcId: string,
    actingUserId: string,
  ): Promise<StorytimeArcStoryEntity[]> {
    await this._arcService.findEditableOrFail(
      arcId,
      actingUserId,
      ArcCapability.MANAGE_STORIES,
    );

    return this._membershipRepository.find({
      where: { arcId },
      order: { orderIndex: 'ASC' },
    });
  }

  /**
   * Lists the agreed memberships of an Arc.
   *
   * @param arcId - The Arc.
   * @returns The approved memberships, in reading order.
   */
  findApprovedByArc(arcId: string): Promise<StorytimeArcStoryEntity[]> {
    return this._membershipRepository.find({
      where: { arcId, membershipStatus: ArcMembershipStatus.APPROVED },
      order: { orderIndex: 'ASC' },
    });
  }

  /**
   * Lists the Arcs a Story has agreed to be part of.
   *
   * @param storyId - The Story.
   * @returns The approved memberships.
   */
  findApprovedByStory(storyId: string): Promise<StorytimeArcStoryEntity[]> {
    return this._membershipRepository.find({
      where: { storyId, membershipStatus: ArcMembershipStatus.APPROVED },
    });
  }

  /**
   * Lists the membership decisions waiting on somebody.
   *
   * Covers both directions: invitations to their Stories, and requests to
   * their Arcs. Which they are is clear from the status.
   *
   * @param ownedStoryIds - The Stories they own.
   * @param ownedArcIds - The Arcs they curate.
   * @returns The memberships waiting on their answer.
   */
  findPendingForUser(
    ownedStoryIds: string[],
    ownedArcIds: string[],
  ): Promise<StorytimeArcStoryEntity[]> {
    const clauses = [];

    if (ownedStoryIds.length > 0) {
      clauses.push({
        storyId: In(ownedStoryIds),
        membershipStatus: ArcMembershipStatus.INVITED,
      });
    }

    if (ownedArcIds.length > 0) {
      clauses.push({
        arcId: In(ownedArcIds),
        membershipStatus: ArcMembershipStatus.REQUESTED,
      });
    }

    if (clauses.length === 0) {
      return Promise.resolve([]);
    }

    return this._membershipRepository.find({
      where: clauses,
      order: { requestedAt: 'DESC' },
    });
  }

  /**
   * Invites a Story into an Arc, as its curator.
   *
   * Joins the Story outright when the curator wrote it themselves. The
   * agreement exists so nobody's work is taken into somebody else's Arc
   * without them; when both sides are the same person there is nobody left to
   * ask, and an invitation they would have to go and accept from themselves is
   * a step that protects no one.
   *
   * @param arcId - The Arc.
   * @param storyId - The Story to invite.
   * @param actingUserId - The caller.
   * @returns The membership, joined or waiting on the Story's owner.
   */
  async invite(
    arcId: string,
    storyId: string,
    actingUserId: string,
  ): Promise<StorytimeArcStoryEntity> {
    await this._arcService.findEditableOrFail(
      arcId,
      actingUserId,
      ArcCapability.MANAGE_STORIES,
    );

    return this.start(
      arcId,
      storyId,
      actingUserId,
      ArcMembershipStatus.INVITED,
      await this.owns(storyId, actingUserId),
    );
  }

  /**
   * Offers a Story to an Arc, as its owner.
   *
   * Joins outright when the owner curates the Arc as well, for the same reason
   * an invitation to your own Story does.
   *
   * @param arcId - The Arc.
   * @param storyId - The Story to offer.
   * @param actingUserId - The caller.
   * @returns The membership, joined or waiting on the curator.
   */
  async request(
    arcId: string,
    storyId: string,
    actingUserId: string,
  ): Promise<StorytimeArcStoryEntity> {
    await this._storyService.findOwnedOrFail(storyId, actingUserId);

    return this.start(
      arcId,
      storyId,
      actingUserId,
      ArcMembershipStatus.REQUESTED,
      await this.curates(arcId, actingUserId),
    );
  }

  /**
   * Agrees to a pending membership.
   *
   * Which side may agree depends on who opened it: an invitation is the Story
   * owner's to accept, a request is the curator's. Accepting your own offer
   * would make the agreement meaningless.
   *
   * @param membershipId - The membership.
   * @param actingUserId - The caller.
   * @returns The approved membership.
   */
  async approve(
    membershipId: string,
    actingUserId: string,
  ): Promise<StorytimeArcStoryEntity> {
    const membership = await this.findOrFail(membershipId);

    await this.assertTheirDecision(membership, actingUserId);

    membership.membershipStatus = ArcMembershipStatus.APPROVED;
    membership.approvedByUserId = actingUserId;
    membership.approvedAt = new Date();

    const saved = await this._membershipRepository.save(membership);

    return this.announceJoin(saved, actingUserId);
  }

  /**
   * Turns down a pending membership.
   *
   * @param membershipId - The membership.
   * @param actingUserId - The caller.
   * @returns The declined membership.
   */
  async decline(
    membershipId: string,
    actingUserId: string,
  ): Promise<StorytimeArcStoryEntity> {
    const membership = await this.findOrFail(membershipId);

    await this.assertTheirDecision(membership, actingUserId);

    membership.membershipStatus = ArcMembershipStatus.DECLINED;
    membership.declinedAt = new Date();

    return this._membershipRepository.save(membership);
  }

  /**
   * Takes a Story out of an Arc.
   *
   * Either side may do this, and the record says which: a curator dropping a
   * Story and an owner pulling theirs out are different things, and a Story
   * that left of its own accord should not read as having been rejected.
   *
   * @param membershipId - The membership.
   * @param actingUserId - The caller.
   * @returns The ended membership.
   */
  async leave(
    membershipId: string,
    actingUserId: string,
  ): Promise<StorytimeArcStoryEntity> {
    const membership = await this.findOrFail(membershipId);

    const isCurator = await this.curates(membership.arcId, actingUserId);
    const isStoryOwner = await this.owns(membership.storyId, actingUserId);

    if (!isCurator && !isStoryOwner) {
      throw new ForbiddenException('That membership is not yours to end');
    }

    membership.membershipStatus = isCurator
      ? ArcMembershipStatus.REMOVED
      : ArcMembershipStatus.WITHDRAWN;
    membership.removedAt = new Date();

    const saved = await this._membershipRepository.save(membership);

    await this._feedService.recordQuietly(
      StorytimeActivityType.ARC_STORY_REMOVED,
      actingUserId,
      { arcId: saved.arcId, storyId: saved.storyId },
    );

    return saved;
  }

  /**
   * Reorders an Arc's reading order.
   *
   * Only approved memberships are ordered: a Story nobody has agreed to
   * include has no place in the sequence yet.
   *
   * @param arcId - The Arc.
   * @param membershipIds - Every approved membership, in reading order.
   * @param actingUserId - The caller.
   * @returns The memberships in their new order.
   * @throws BadRequestException when the list does not match.
   */
  async reorder(
    arcId: string,
    membershipIds: string[],
    actingUserId: string,
  ): Promise<StorytimeArcStoryEntity[]> {
    await this._arcService.findEditableOrFail(
      arcId,
      actingUserId,
      ArcCapability.MANAGE_STORIES,
    );

    const approved = await this.findApprovedByArc(arcId);
    const byId = new Map(
      approved.map(membership => [membership.id, membership]),
    );
    const ordered = membershipIds
      .map(id => byId.get(id))
      .filter(
        (membership): membership is StorytimeArcStoryEntity =>
          membership !== undefined,
      );

    if (
      ordered.length !== membershipIds.length ||
      ordered.length !== approved.length ||
      new Set(membershipIds).size !== membershipIds.length
    ) {
      throw new BadRequestException(
        'The new order must list every Story in the Arc exactly once.',
      );
    }

    // Renumbered above everything already in the Arc, then normalised, so no
    // intermediate state ever collides with the positions still in use.
    ordered.forEach((membership, position) => {
      membership.orderIndex = (position + 1) * 1000;
    });

    return this._membershipRepository.save(ordered);
  }

  /**
   * Starts a membership, agreeing it outright when nobody else has to.
   *
   * @param arcId - The Arc.
   * @param storyId - The Story.
   * @param actingUserId - Who started it.
   * @param pendingStatus - Which side would otherwise be waiting to agree.
   * @param isBothSides - Whether the caller answers for the other side too.
   * @returns The membership, joined or pending.
   */
  private async start(
    arcId: string,
    storyId: string,
    actingUserId: string,
    pendingStatus: ArcMembershipStatus,
    isBothSides: boolean,
  ): Promise<StorytimeArcStoryEntity> {
    const membership = await this.open(
      arcId,
      storyId,
      actingUserId,
      isBothSides ? ArcMembershipStatus.APPROVED : pendingStatus,
    );

    return isBothSides
      ? this.announceJoin(membership, actingUserId)
      : membership;
  }

  /**
   * Records that a Story is now part of an Arc.
   *
   * Shared by the two ways a membership becomes agreed — somebody accepting
   * the other side's offer, and somebody who is both sides needing nobody's
   * agreement — so a Story joining is logged and announced the same way
   * however it got there.
   *
   * @param membership - The agreed membership.
   * @param actingUserId - Who agreed it.
   * @returns The membership, unchanged.
   */
  private async announceJoin(
    membership: StorytimeArcStoryEntity,
    actingUserId: string,
  ): Promise<StorytimeArcStoryEntity> {
    this._logger.log(
      `Story ${membership.storyId} joined Arc ${membership.arcId}`,
    );

    await this._feedService.recordQuietly(
      StorytimeActivityType.ARC_STORY_ADDED,
      actingUserId,
      { arcId: membership.arcId, storyId: membership.storyId },
    );

    return membership;
  }

  /**
   * Opens a membership from whichever side started it.
   *
   * @param arcId - The Arc.
   * @param storyId - The Story.
   * @param actingUserId - Who started it.
   * @param status - Which side is waiting to agree, or that none is.
   * @returns The membership.
   * @throws BadRequestException when one is already open or agreed.
   */
  private async open(
    arcId: string,
    storyId: string,
    actingUserId: string,
    status: ArcMembershipStatus,
  ): Promise<StorytimeArcStoryEntity> {
    const existing = await this._membershipRepository.findOne({
      where: { arcId, storyId },
    });

    if (existing && LIVE_STATUSES.includes(existing.membershipStatus)) {
      throw new BadRequestException(
        'That Story is already in this Arc, or waiting on an answer.',
      );
    }

    const last = await this._membershipRepository.findOne({
      where: { arcId },
      order: { orderIndex: 'DESC' },
    });

    const membership = existing ?? this._membershipRepository.create();
    const isAgreed = status === ArcMembershipStatus.APPROVED;
    const now = new Date();

    Object.assign(membership, {
      arcId,
      storyId,
      // Kept when reopening, so a Story invited back does not jump the queue.
      orderIndex:
        existing?.orderIndex ??
        this._arcService.nextOrderIndex(last?.orderIndex ?? null),
      membershipStatus: status,
      requestedByUserId: actingUserId,
      requestedAt: now,
      // A membership that needed nobody's agreement still records who settled
      // it, so the audit reads the same as one that was accepted.
      approvedByUserId: isAgreed ? actingUserId : null,
      approvedAt: isAgreed ? now : null,
      declinedAt: null,
      removedAt: null,
    });

    return this._membershipRepository.save(membership);
  }

  /**
   * Requires that the pending membership is the caller's to answer.
   *
   * @param membership - The membership.
   * @param actingUserId - The caller.
   * @throws BadRequestException when it has already been answered.
   * @throws ForbiddenException when it is the other side's decision.
   */
  private async assertTheirDecision(
    membership: StorytimeArcStoryEntity,
    actingUserId: string,
  ): Promise<void> {
    const permitted =
      membership.membershipStatus === ArcMembershipStatus.INVITED
        ? await this.owns(membership.storyId, actingUserId)
        : await this.curates(membership.arcId, actingUserId);

    if (
      membership.membershipStatus !== ArcMembershipStatus.INVITED &&
      membership.membershipStatus !== ArcMembershipStatus.REQUESTED
    ) {
      throw new BadRequestException('That has already been answered.');
    }

    if (!permitted) {
      throw new ForbiddenException('That is not yours to answer');
    }
  }

  /**
   * Reports whether somebody curates an Arc.
   *
   * @param arcId - The Arc.
   * @param userId - The person.
   * @returns True when they curate it.
   */
  private async curates(arcId: string, userId: string): Promise<boolean> {
    try {
      await this._arcService.findEditableOrFail(
        arcId,
        userId,
        ArcCapability.MANAGE_STORIES,
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reports whether somebody owns a Story.
   *
   * @param storyId - The Story.
   * @param userId - The person.
   * @returns True when they own it.
   */
  private async owns(storyId: string, userId: string): Promise<boolean> {
    try {
      await this._storyService.findOwnedOrFail(storyId, userId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Loads a membership, or fails.
   *
   * @param membershipId - The membership.
   * @returns The membership.
   * @throws NotFoundException when it does not exist.
   */
  private async findOrFail(
    membershipId: string,
  ): Promise<StorytimeArcStoryEntity> {
    const membership = await this._membershipRepository.findOne({
      where: { id: membershipId },
    });

    if (!membership) {
      throw new NotFoundException('Membership not found');
    }

    return membership;
  }
}
