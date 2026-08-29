import { Injectable } from '@nestjs/common';
import { STORYTIME_POLICY_VERSION } from '../constants/storytime-policy.constants';
import { ManagedStoryDto, StoryDto } from './dto/story.dto';
import { StorytimeStoryEntity } from './entities/storytime-story.entity';

/**
 * Turns Story entities into the shapes the API returns.
 *
 * Two shapes, built separately rather than one shape with fields stripped
 * afterwards. Removing fields from a full object is easy to forget when a
 * column is added later; building the public shape explicitly means a new
 * column stays private until somebody decides otherwise.
 */
@Injectable()
export class StorytimeStoryMapper {
  /**
   * Maps a Story to its reader-facing shape.
   *
   * @param story - The Story entity.
   * @returns The reader-facing Story.
   */
  toPublic(
    story: StorytimeStoryEntity,
    authorUsername: string | null = null,
  ): StoryDto {
    return {
      id: story.id,
      slug: story.slug,
      title: story.title,
      ownerUserId: story.ownerUserId,
      authorUsername,
      shortDescription: story.shortDescription,
      descriptionHtml: story.descriptionHtml,
      completionState: story.completionState,
      contentRating: story.contentRating,
      languageCode: story.languageCode,
      bannerImageUrl: story.bannerImageUrl,
      bannerImageMobileUrl: story.bannerImageMobileUrl,
      bannerImageAlt: story.bannerImageAlt,
      profileImageUrl: story.profileImageUrl,
      profileImageThumbnailUrl: story.profileImageThumbnailUrl,
      profileImageAlt: story.profileImageAlt,
      publishedChapterCount: story.publishedChapterCount,
      rating: story.upVoteCount - story.downVoteCount,
      publishedAt: story.publishedAt,
      lastContentUpdateAt: story.lastContentUpdateAt,
    };
  }

  /**
   * Maps a Story to the shape its owner manages it through.
   *
   * @param story - The Story entity.
   * @returns The owner-facing Story.
   */
  toManaged(story: StorytimeStoryEntity): ManagedStoryDto {
    return {
      ...this.toPublic(story),
      status: story.status,
      visibility: story.visibility,
      ownerOrderIndex: story.ownerOrderIndex,
      description: story.description,
      version: story.version,
      moderationStatus: story.moderationStatus,
      moderationMessage: story.moderationMessage,
      contentPolicyAcceptedAt: story.contentPolicyAcceptedAt,
      contentPolicyVersion: story.contentPolicyVersion,
      contentPolicyCurrent:
        story.contentPolicyVersion === STORYTIME_POLICY_VERSION,
    };
  }

  /**
   * Maps several Stories to their reader-facing shape.
   *
   * @param stories - The Story entities.
   * @returns The reader-facing Stories.
   */
  toPublicList(stories: StorytimeStoryEntity[]): StoryDto[] {
    return stories.map(story => this.toPublic(story));
  }

  /**
   * Maps several Stories to their owner-facing shape.
   *
   * @param stories - The Story entities.
   * @returns The owner-facing Stories.
   */
  toManagedList(stories: StorytimeStoryEntity[]): ManagedStoryDto[] {
    return stories.map(story => this.toManaged(story));
  }
}
