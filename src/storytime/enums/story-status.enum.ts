/**
 * Publication lifecycle of a Story.
 *
 * Distinct from moderation state: a Story removed by an administrator keeps
 * whatever publication status it had, so restoring it returns it to where the
 * creator left it. See {@link StorytimeModerationStatus}.
 */
export enum StoryStatus {
  /** Being written; not visible to anyone but the owner and collaborators. */
  DRAFT = 'DRAFT',
  /** Submitted for optional editorial review. */
  IN_REVIEW = 'IN_REVIEW',
  /** Awaiting an automatic publication at a future time. */
  SCHEDULED = 'SCHEDULED',
  /** Publicly readable, subject to visibility. */
  PUBLISHED = 'PUBLISHED',
  /** Withdrawn from publication by the owner; may be published again. */
  UNPUBLISHED = 'UNPUBLISHED',
  /** Retired by the owner and hidden from discovery, but not deleted. */
  ARCHIVED = 'ARCHIVED',
}
