import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, QueryFailedError, Repository } from 'typeorm';

import { CommunitySubscriptionEntity } from '../entities/community-subscription.entity';
import { FleetCommunityEntity } from '../entities/fleet-community.entity';

/** A Community somebody follows, with when they started. */
export interface FollowedCommunity {
  /** The Community itself. */
  readonly community: FleetCommunityEntity;
  /** When they started following it. */
  readonly followedAt: Date;
}

/**
 * Following a Community, and nothing more than that.
 *
 * Following is the weakest relationship in the feature: it opens `COMMUNITY`
 * content and grants no access anywhere, which is ADR-0002 and R07. That is a
 * rule about what reads a subscription, not about what writes one, so this
 * service is deliberately small — it keeps the record straight and leaves
 * every visibility question to {@link FleetAudienceService}.
 *
 * Nothing here checks whether the caller may see the Community. The route does
 * that before calling, with the same `assertCanView` its read uses, so that
 * following something is never a way to reach something reading it could not:
 * a Community hiding itself is not collecting followers.
 *
 * ## Why leaving is a stamp
 *
 * Unfollowing sets `leftAt` rather than deleting the row, so "followed once"
 * stays answerable — which matters for moderation long after somebody has
 * gone quiet. The unique index covers only live rows, so following again
 * after leaving is a second row rather than a resurrection, and the pair
 * reads as the history it is.
 */
@Injectable()
export class CommunitySubscriptionService {
  private readonly _logger = new Logger(CommunitySubscriptionService.name);

  /**
   * Creates an instance of CommunitySubscriptionService.
   *
   * @param _subscriptionRepository - Repository of Community subscriptions.
   */
  constructor(
    @InjectRepository(CommunitySubscriptionEntity)
    private readonly _subscriptionRepository: Repository<CommunitySubscriptionEntity>,
  ) {}

  /**
   * Starts following a Community, or confirms that it already is.
   *
   * Idempotent by intent rather than by accident. A follow button that has
   * been pressed twice, or pressed on a stale page, is somebody saying they
   * want to follow — answering the second press with a conflict would tell
   * them off for agreeing with themselves.
   *
   * The unique index is the real arbiter. Two presses arriving together both
   * find nothing and both insert; one is refused by the database, and that
   * refusal is the answer "somebody already did this", so it re-reads rather
   * than raising. The check-then-insert above it is not the guard — it is
   * what keeps the ordinary case down to one query.
   *
   * @param communityId - The Community to follow.
   * @param userId - The follower.
   * @returns The live subscription.
   */
  async follow(
    communityId: string,
    userId: string,
  ): Promise<CommunitySubscriptionEntity> {
    const existing = await this.findLive(communityId, userId);

    if (existing !== null) {
      return existing;
    }

    try {
      const created = await this._subscriptionRepository.save(
        this._subscriptionRepository.create({
          communityId,
          userId,
          joinedAt: new Date(),
          leftAt: null,
        }),
      );

      this._logger.log(`User ${userId} followed Community ${communityId}`);

      return created;
    } catch (error) {
      const raced =
        error instanceof QueryFailedError &&
        error.message.includes('duplicate key value')
          ? await this.findLive(communityId, userId)
          : null;

      if (raced === null) {
        throw error;
      }

      return raced;
    }
  }

  /**
   * Stops following a Community.
   *
   * Silent when they were not following. The caller asked for a state, not
   * for a transition, and they are in it.
   *
   * @param communityId - The Community to stop following.
   * @param userId - The follower.
   */
  async unfollow(communityId: string, userId: string): Promise<void> {
    const existing = await this.findLive(communityId, userId);

    if (existing === null) {
      return;
    }

    existing.leftAt = new Date();

    await this._subscriptionRepository.save(existing);

    this._logger.log(`User ${userId} unfollowed Community ${communityId}`);
  }

  /**
   * Reports whether somebody currently follows a Community.
   *
   * @param communityId - The Community.
   * @param userId - The possible follower, or null when signed out.
   * @returns True when a live subscription exists.
   */
  async isFollowing(
    communityId: string,
    userId: string | null,
  ): Promise<boolean> {
    if (userId === null) {
      return false;
    }

    return (await this.findLive(communityId, userId)) !== null;
  }

  /**
   * Counts the live followers of a Community.
   *
   * The only thing anybody learns about a Community's followers. There is no
   * route that lists them: following is meant to be a quiet act, and a name
   * once published cannot be taken back.
   *
   * @param communityId - The Community.
   * @returns How many follow it now.
   */
  countFollowers(communityId: string): Promise<number> {
    return this._subscriptionRepository.count({
      where: { communityId, leftAt: IsNull(), deletedAt: IsNull() },
    });
  }

  /**
   * Lists the Communities somebody follows, most recent first.
   *
   * Newest first because the list is read on a personal page, where the thing
   * somebody just followed is the thing they are looking for.
   *
   * The Communities are joined rather than fetched one at a time, which also
   * settles what happens to a subscription whose Community has since been
   * erased: the join drops the soft-deleted row and the subscription goes
   * with it. The record is kept — it is still evidence of who followed what
   * — but a list of Communities does not report one that is gone.
   *
   * Whether the caller may still *see* each one is a separate question, asked
   * by the route: a Community followed while it was public may not be public
   * now.
   *
   * @param userId - The follower.
   * @returns What they follow, newest first.
   */
  async listFollowed(userId: string): Promise<FollowedCommunity[]> {
    const subscriptions = await this._subscriptionRepository.find({
      where: { userId, leftAt: IsNull(), deletedAt: IsNull() },
      relations: { community: true },
      order: { joinedAt: 'DESC' },
    });

    return subscriptions
      .filter(subscription => subscription.community !== null)
      .map(subscription => ({
        community: subscription.community,
        followedAt: subscription.joinedAt,
      }));
  }

  /**
   * Finds the live subscription of one user to one Community.
   *
   * @param communityId - The Community.
   * @param userId - The follower.
   * @returns The subscription, or null when they do not follow it.
   */
  private findLive(
    communityId: string,
    userId: string,
  ): Promise<CommunitySubscriptionEntity | null> {
    return this._subscriptionRepository.findOne({
      where: {
        communityId,
        userId,
        leftAt: IsNull(),
        deletedAt: IsNull(),
      },
    });
  }
}
