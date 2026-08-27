import { Injectable } from '@nestjs/common';
import { FeedEntry } from './storytime-activity-feed.service';
import { FeedEntryDto } from './dto/follow.dto';

/**
 * Turns feed entries into the shape the API returns.
 *
 * Titles and addresses come from the content resolved at read time, never from
 * the feed row: an item records what happened and to what, and everything a
 * reader sees about it is as true as the moment they looked.
 */
@Injectable()
export class StorytimeSocialMapper {
  /**
   * Maps one feed entry.
   *
   * @param entry - The item and the content it names.
   * @returns The entry as a reader sees it.
   */
  toFeedEntry(entry: FeedEntry): FeedEntryDto {
    return {
      id: entry.item.id,
      activityType: entry.item.activityType,
      actorUserId: entry.item.actorUserId,
      storyTitle: entry.story?.title ?? null,
      storySlug: entry.story?.slug ?? null,
      chapterTitle: entry.chapter?.title ?? null,
      chapterSlug: entry.chapter?.slug ?? null,
      arcTitle: entry.arc?.title ?? null,
      arcSlug: entry.arc?.slug ?? null,
      occurredAt: entry.item.occurredAt,
    };
  }

  /**
   * Maps a feed.
   *
   * @param entries - The items and the content they name.
   * @returns The feed.
   */
  toFeed(entries: FeedEntry[]): FeedEntryDto[] {
    return entries.map(entry => this.toFeedEntry(entry));
  }
}
