/**
 * The events that can appear in a reader's Storytime activity feed.
 *
 * Feed entries record the event type and the identifiers involved rather than
 * copying content, so that visibility can be rechecked when the feed is read.
 * An item that has since become private or been removed is then filtered out
 * instead of having been baked into somebody's feed.
 */
export enum StorytimeActivityType {
  /** A followed creator published a new Story. */
  STORY_PUBLISHED = 'STORY_PUBLISHED',
  /** A new Chapter was published in a followed Story. */
  CHAPTER_PUBLISHED = 'CHAPTER_PUBLISHED',
  /** A followed Story's details changed materially. */
  STORY_UPDATED = 'STORY_UPDATED',
  /** A followed Story's completion state changed. */
  STORY_STATUS_CHANGED = 'STORY_STATUS_CHANGED',
  /** A followed Arc's details changed materially. */
  ARC_UPDATED = 'ARC_UPDATED',
  /** A Story joined a followed Arc. */
  ARC_STORY_ADDED = 'ARC_STORY_ADDED',
  /** A Story left a followed Arc. */
  ARC_STORY_REMOVED = 'ARC_STORY_REMOVED',
  /** Followed content was selected for the Spotlight. */
  SPOTLIGHT_SELECTED = 'SPOTLIGHT_SELECTED',
}
