import { Injectable } from '@nestjs/common';
import { StoryDto } from '../stories/dto/story.dto';
import { ArcDto, ArcMembershipDto, ManagedArcDto } from './dto/arc.dto';
import { StorytimeArcStoryEntity } from './entities/storytime-arc-story.entity';
import { StorytimeArcEntity } from './entities/storytime-arc.entity';

/**
 * Turns Arcs and their memberships into the shapes the API returns.
 *
 * Two Arc shapes, built separately rather than one with fields stripped
 * afterwards, so a column added later stays private until somebody decides
 * otherwise.
 */
@Injectable()
export class StorytimeArcMapper {
  /**
   * Maps an Arc to its reader-facing shape.
   *
   * @param arc - The Arc entity.
   * @returns The reader-facing Arc.
   */
  toPublic(arc: StorytimeArcEntity): ArcDto {
    return {
      id: arc.id,
      slug: arc.slug,
      title: arc.title,
      ownerUserId: arc.ownerUserId,
      shortDescription: arc.shortDescription,
      descriptionHtml: arc.descriptionHtml,
      languageCode: arc.languageCode,
      bannerImageUrl: arc.bannerImageUrl,
      bannerImageAlt: arc.bannerImageAlt,
      profileImageUrl: arc.profileImageUrl,
      profileImageAlt: arc.profileImageAlt,
      rating: arc.upVoteCount - arc.downVoteCount,
      publishedAt: arc.publishedAt,
    };
  }

  /**
   * Maps an Arc to the shape its curator manages it through.
   *
   * @param arc - The Arc entity.
   * @returns The curator-facing Arc.
   */
  toManaged(arc: StorytimeArcEntity): ManagedArcDto {
    return {
      ...this.toPublic(arc),
      status: arc.status,
      visibility: arc.visibility,
      description: arc.description,
      bannerImageId: arc.bannerImageId,
      profileImageId: arc.profileImageId,
      version: arc.version,
    };
  }

  /**
   * Maps several Arcs to their reader-facing shape.
   *
   * @param arcs - The Arc entities.
   * @returns The reader-facing Arcs.
   */
  toPublicList(arcs: StorytimeArcEntity[]): ArcDto[] {
    return arcs.map(arc => this.toPublic(arc));
  }

  /**
   * Maps several Arcs to their curator-facing shape.
   *
   * @param arcs - The Arc entities.
   * @returns The curator-facing Arcs.
   */
  toManagedList(arcs: StorytimeArcEntity[]): ManagedArcDto[] {
    return arcs.map(arc => this.toManaged(arc));
  }

  /**
   * Maps memberships, pairing each with its Story.
   *
   * A membership whose Story the caller may not see maps to a null Story
   * rather than being dropped, so a curator can still act on what they agreed
   * to even after a Story is made private.
   *
   * @param memberships - The membership rows.
   * @param stories - The Stories the caller may see, by identifier.
   * @returns The memberships.
   */
  toMembershipList(
    memberships: StorytimeArcStoryEntity[],
    stories: Map<string, StoryDto>,
  ): ArcMembershipDto[] {
    return memberships.map(membership => ({
      id: membership.id,
      arcId: membership.arcId,
      storyId: membership.storyId,
      orderIndex: membership.orderIndex,
      membershipStatus: membership.membershipStatus,
      introductoryNote: membership.introductoryNote,
      story: stories.get(membership.storyId) ?? null,
    }));
  }
}
