/**
 * Where a report sits in the moderation queue.
 *
 * {@link ReportStatus.OPEN} and {@link ReportStatus.UNDER_REVIEW} are the two
 * live states; the remaining two are terminal and record what an administrator
 * decided.
 */
export enum ReportStatus {
  /** Newly submitted and not yet picked up. */
  OPEN = 'OPEN',
  /** An administrator has claimed it and is investigating. */
  UNDER_REVIEW = 'UNDER_REVIEW',
  /** Upheld — the reported member was actioned. */
  ACTIONED = 'ACTIONED',
  /** Closed without action against the reported member. */
  DISMISSED = 'DISMISSED',
}
