import { Injectable } from '@nestjs/common';

import { STORYTIME_POLICY_VERSION } from '../constants/storytime-policy.constants';
import { StorytimeAuthorDto } from '../dto/storytime-author.dto';
import { TagDto } from '../tags/dto/create-tag.dto';
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
   * The author and the tags are passed in rather than read here: both are
   * looked up once for a whole listing, and a mapper that fetched its own
   * would turn a page of twenty Stories into forty extra queries.
   *
   * @param story - The Story entity.
   * @param author - Who published it, when the caller is being told.
   * @param tags - What it is tagged with, when the caller is being told.
   * @returns The reader-facing Story.
   */
  toPublic(
    story: StorytimeStoryEntity,
    author: StorytimeAuthorDto | null = null,
    tags: TagDto[] = [],
  ): StoryDto {
    return {
      id: story.id,
      slug: story.slug,
      title: story.title,
      ownerUserId: story.ownerUserId,
      author,
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
      tags,
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
   * @param tagsByStory - What each is tagged with, keyed by Story.
   * @returns The reader-facing Stories.
   */
  toPublicList(
    stories: StorytimeStoryEntity[],
    tagsByStory: Map<string, TagDto[]> = new Map(),
  ): StoryDto[] {
    return stories.map(story =>
      this.toPublic(story, null, tagsByStory.get(story.id) ?? []),
    );
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
