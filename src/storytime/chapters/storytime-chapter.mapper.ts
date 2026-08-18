import { Injectable } from '@nestjs/common';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import {
  ChapterDto,
  ChapterLinkDto,
  ChapterSummaryDto,
  ManagedChapterDto,
} from './dto/chapter.dto';
import { StorytimeChapterEntity } from './entities/storytime-chapter.entity';

/**
 * Turns Chapter entities into the shapes the API returns.
 *
 * Three shapes, built up from each other: a summary for lists, a reader shape
 * that adds the body, and a creator shape that adds the editable source and
 * working state. Each is built explicitly rather than by stripping fields from
 * a fuller object, so a column added later stays private until somebody
 * decides otherwise.
 */
@Injectable()
export class StorytimeChapterMapper {
  /**
   * Maps a Chapter to its list shape.
   *
   * @param chapter - The Chapter entity.
   * @returns The summary.
   */
  toSummary(chapter: StorytimeChapterEntity): ChapterSummaryDto {
    return {
      id: chapter.id,
      slug: chapter.slug,
      title: chapter.title,
      synopsis: chapter.synopsis,
      orderIndex: chapter.orderIndex,
      wordCount: chapter.wordCount,
      estimatedReadingMinutes: chapter.estimatedReadingMinutes,
      coverImageThumbnailUrl: chapter.coverImageThumbnailUrl,
      coverImageAlt: chapter.coverImageAlt,
      publishedAt: chapter.publishedAt,
    };
  }

  /**
   * Maps a Chapter to its reader shape.
   *
   * The language is resolved here rather than left to the client, because only
   * the server knows the Story's language, and the reader page needs a single
   * value to put in its `lang` attribute.
   *
   * The rating comes along for the same reason. A reader who follows a link
   * straight to a Chapter never passes the Story page, so the warning has to
   * travel with the Chapter — and fetching the Story to find it would put a
   * second request on the most-read path in the feature.
   *
   * @param chapter - The Chapter entity.
   * @param story - The Story it belongs to, for the inherited language.
   * @returns The reader-facing Chapter.
   */
  toPublic(
    chapter: StorytimeChapterEntity,
    story: StorytimeStoryEntity,
  ): ChapterDto {
    return {
      ...this.toSummary(chapter),
      storyId: chapter.storyId,
      contentHtml: chapter.contentHtml,
      languageCode: chapter.languageCode ?? story.languageCode,
      contentRating: story.contentRating,
      coverImageUrl: chapter.coverImageUrl,
      rating: chapter.upVoteCount - chapter.downVoteCount,
    };
  }

  /**
   * Maps a Chapter to the shape its creator manages it through.
   *
   * @param chapter - The Chapter entity.
   * @param story - The Story it belongs to, for the inherited language.
   * @returns The creator-facing Chapter.
   */
  toManaged(
    chapter: StorytimeChapterEntity,
    story: StorytimeStoryEntity,
  ): ManagedChapterDto {
    return {
      ...this.toPublic(chapter, story),
      status: chapter.status,
      contentSource: chapter.contentSource,
      // The raw setting, not the resolved one. An editor bound to the
      // resolved value would turn an inherited language into a pinned one the
      // first time the creator saved.
      ownLanguageCode: chapter.languageCode,
      scheduledPublishAt: chapter.scheduledPublishAt,
      version: chapter.version,
      moderationStatus: chapter.moderationStatus,
      moderationMessage: chapter.moderationMessage,
    };
  }

  /**
   * Maps several Chapters to their list shape.
   *
   * @param chapters - The Chapter entities.
   * @returns The summaries.
   */
  toSummaryList(chapters: StorytimeChapterEntity[]): ChapterSummaryDto[] {
    return chapters.map(chapter => this.toSummary(chapter));
  }

  /**
   * Maps several Chapters to their creator shape.
   *
   * @param chapters - The Chapter entities.
   * @param story - The Story they belong to.
   * @returns The creator-facing Chapters.
   */
  toManagedList(
    chapters: StorytimeChapterEntity[],
    story: StorytimeStoryEntity,
  ): ManagedChapterDto[] {
    return chapters.map(chapter => this.toManaged(chapter, story));
  }

  /**
   * Maps a Chapter to the minimal link used for previous/next navigation.
   *
   * @param chapter - The Chapter, or null when there is no neighbour.
   * @returns The link, or null.
   */
  toLink(chapter: StorytimeChapterEntity | null): ChapterLinkDto | null {
    if (!chapter) {
      return null;
    }

    return { slug: chapter.slug, title: chapter.title };
  }
}
