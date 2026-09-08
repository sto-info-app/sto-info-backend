/**
 * Publication lifecycle of an Arc.
 *
 * Arcs have no scheduled publication: an Arc becomes interesting only once the
 * Stories in it are readable, so releasing it on a timer would promise readers
 * content that may not exist yet.
 */
export enum ArcStatus {
  /** Being assembled by its curator. */
  DRAFT = 'DRAFT',
  /** Submitted for optional editorial review. */
  IN_REVIEW = 'IN_REVIEW',
  /** Publicly visible, subject to visibility. */
  PUBLISHED = 'PUBLISHED',
  /** Withdrawn from publication by its curator. */
  UNPUBLISHED = 'UNPUBLISHED',
  /** Retired and hidden from discovery, but not deleted. */
  ARCHIVED = 'ARCHIVED',
}
