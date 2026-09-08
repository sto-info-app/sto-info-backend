/**
 * What an administrator did to a piece of Storytime content.
 *
 * The audit trail records the act, not the resulting state: "removed" and
 * "restored" are two entries, never one row whose meaning changes. That is
 * what makes the history answer "what happened, and when" rather than only
 * "what is true now".
 */
export enum StorytimeModerationAction {
  /** The content was taken out of public view. */
  REMOVED = 'REMOVED',
  /** The content was put back. */
  RESTORED = 'RESTORED',
  /** A report about the content was resolved. */
  REPORT_RESOLVED = 'REPORT_RESOLVED',
  /** An appeal against a removal was accepted. */
  APPEAL_UPHELD = 'APPEAL_UPHELD',
  /** An appeal against a removal was turned down. */
  APPEAL_REJECTED = 'APPEAL_REJECTED',
}
