/**
 * Publication lifecycle of a Chapter.
 *
 * A Chapter may reach {@link ChapterStatus.PUBLISHED} while its Story is still
 * a draft. It only becomes publicly reachable once the Story is itself
 * publicly readable, which is what allows a creator to stage a complete Story
 * and then release it with a single action.
 */
export enum ChapterStatus {
  /** Being written; not visible to readers. */
  DRAFT = 'DRAFT',
  /** Submitted for optional editorial review. */
  IN_REVIEW = 'IN_REVIEW',
  /** Awaiting an automatic publication at a future time. */
  SCHEDULED = 'SCHEDULED',
  /** Published, and readable once the Story is publicly readable. */
  PUBLISHED = 'PUBLISHED',
  /** Withdrawn from publication; may be published again. */
  UNPUBLISHED = 'UNPUBLISHED',
  /** Retired and excluded from reading order and progress. */
  ARCHIVED = 'ARCHIVED',
}
