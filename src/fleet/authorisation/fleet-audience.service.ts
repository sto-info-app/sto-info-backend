import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, Repository } from 'typeorm';

import { CommunitySubscriptionEntity } from '../entities/community-subscription.entity';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetAuthorisationService } from './fleet-authorisation.service';
import { FLEET_CAPABILITIES } from './fleet-capability.constants';
import { ScopeAuthorisation, ScopeRef } from './scope-authorisation.interface';

/**
 * Answers "may this person *see* this", as distinct from "may they do this".
 *
 * Visibility and access are different questions and are answered by different
 * records — ADR-0002. A public Fleet page is readable by a signed-out visitor
 * who may do nothing at all to it; a Community follower may read Community
 * content and still has no approved membership anywhere. Keeping the two
 * services apart is what stops "can see the Fleet" from drifting into "is in
 * the Fleet" as more features are added.
 *
 * This is the only place `community_subscription` is read for an authorisation
 * decision, and it is read for exactly one audience: `COMMUNITY`. It is not
 * consulted for `FLEET_MEMBERS`, which is FC-005's second acceptance criterion
 * — following a Community never opens a private roster (R07).
 *
 * The four audiences are matched by name rather than compared as an ordering.
 * {@link FleetAudience} is written widest-first and it would be tempting to
 * treat it as a number, but then inserting a value later would silently widen
 * every check that had been written as "at least this".
 */
@Injectable()
export class FleetAudienceService {
  /**
   * Creates an instance of FleetAudienceService.
   *
   * @param _authorisationService - Resolves roles, capabilities and membership.
   * @param _subscriptionRepository - Repository of Community subscriptions.
   */
  constructor(
    private readonly _authorisationService: FleetAuthorisationService,
    @InjectRepository(CommunitySubscriptionEntity)
    private readonly _subscriptionRepository: Repository<CommunitySubscriptionEntity>,
  ) {}

  /**
   * Reports whether somebody may see content published to an audience.
   *
   * @param audience - The audience the content is published to.
   * @param ref - The scope the content belongs to.
   * @param userId - The viewer, or null when signed out.
   * @returns True when the content may be shown. A scope that does not resolve
   *   is false rather than an error, so a listing can filter without catching.
   */
  async canView(
    audience: FleetAudience,
    ref: ScopeRef,
    userId: string | null,
  ): Promise<boolean> {
    if (audience === FleetAudience.PUBLIC) {
      return true;
    }

    if (userId === null) {
      return false;
    }

    const authorisation = await this._authorisationService.authorise(
      userId,
      ref,
    );

    if (authorisation === null || authorisation.isSuspended) {
      return false;
    }

    switch (audience) {
      case FleetAudience.COMMUNITY:
        return this.isInCommunity(authorisation, userId);
      case FleetAudience.FLEET_MEMBERS:
        return this.isScopeMember(authorisation);
      // Every audience is named, so one added to the enum without a branch here
      // is a compile error rather than content that quietly becomes visible.
      case FleetAudience.PRIVATE:
        return authorisation.scope.communityOwnerUserId === userId;
    }
  }

  /**
   * Requires that somebody may see content published to an audience.
   *
   * @param audience - The audience the content is published to.
   * @param ref - The scope the content belongs to.
   * @param userId - The viewer, or null when signed out.
   * @throws NotFoundException when they may not. Content they cannot see is
   *   reported as absent rather than forbidden, so the response does not
   *   confirm that a private Fleet exists — plan section 5.
   */
  async assertCanView(
    audience: FleetAudience,
    ref: ScopeRef,
    userId: string | null,
  ): Promise<void> {
    if (await this.canView(audience, ref, userId)) {
      return;
    }

    throw new NotFoundException('Not found');
  }

  /**
   * Reports whether somebody counts as part of the owning Community.
   *
   * Following counts here and nowhere else. So does holding any role or any
   * approved membership anywhere in the Community, because somebody who
   * administers a Fleet is plainly part of the Community that owns it.
   *
   * @param authorisation - The resolved authorisation.
   * @param userId - The viewer.
   * @returns True when they are part of the Community.
   */
  private async isInCommunity(
    authorisation: ScopeAuthorisation,
    userId: string,
  ): Promise<boolean> {
    if (
      authorisation.roles.size > 0 ||
      authorisation.isApprovedMember ||
      authorisation.capabilities.size > 0
    ) {
      return true;
    }

    const subscription = await this._subscriptionRepository.findOne({
      where: {
        communityId: authorisation.scope.communityId,
        userId,
        leftAt: IsNull(),
        deletedAt: IsNull(),
      },
      select: { id: true },
    });

    return subscription !== null;
  }

  /**
   * Reports whether somebody is a member of this exact scope.
   *
   * An approved membership at the scope, or a capability that already carries
   * the right to see who the members are — which a Community-scope Admin has
   * over the Fleets their Community owns, and which a follower never has.
   *
   * @param authorisation - The resolved authorisation.
   * @returns True when they are a member of the scope.
   */
  private isScopeMember(authorisation: ScopeAuthorisation): boolean {
    return (
      authorisation.isApprovedMember ||
      authorisation.capabilities.has(FLEET_CAPABILITIES.MEMBERS_VIEW)
    );
  }
}
