/**
 * Why a picture is waiting to be deleted from Cloudflare Images.
 *
 * Recorded because a queue that only says "delete this" cannot be reasoned
 * about when it stops draining. A backlog that is all `ABANDONED_UPLOAD` means
 * the database is rejecting writes after the upload succeeded; one that is all
 * `RETENTION` means last night's sweep could not reach Cloudflare at all.
 * Those are different faults with different fixes, and the reason is the only
 * thing that tells them apart after the fact.
 */
export enum CustomTrackingImageCleanupReason {
  /** A newer picture took its place on the same Field and record. */
  REPLACED = 'REPLACED',
  /** Its owner removed the picture. */
  REMOVED = 'REMOVED',
  /** The Field or answer holding it was cleared by the retention sweep. */
  RETENTION = 'RETENTION',
  /** Its owner closed their account and the record was purged. */
  ACCOUNT_CLOSED = 'ACCOUNT_CLOSED',
  /**
   * It reached Cloudflare but the row that would have pointed at it never got
   * written, so nothing on the site refers to it and nothing ever will.
   */
  ABANDONED_UPLOAD = 'ABANDONED_UPLOAD',
}
