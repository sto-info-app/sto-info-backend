/** A site-level admin action the site admin log records (FC-039). */
export enum SiteAdminActionKind {
  USER_ROLE_CHANGED = 'USER_ROLE_CHANGED',
  PERMISSION_OVERRIDE_SET = 'PERMISSION_OVERRIDE_SET',
  PERMISSION_OVERRIDE_REMOVED = 'PERMISSION_OVERRIDE_REMOVED',
  LIMIT_OVERRIDE_SET = 'LIMIT_OVERRIDE_SET',
  LIMIT_OVERRIDE_REMOVED = 'LIMIT_OVERRIDE_REMOVED',
  USER_DISABLED = 'USER_DISABLED',
  USER_ENABLED = 'USER_ENABLED',
  /** A member report decided, singly or closed with a disabled account. */
  USER_REPORT_DECIDED = 'USER_REPORT_DECIDED',
  /** A chat report decided, singly or closed with a disabled account. */
  CHAT_REPORT_DECIDED = 'CHAT_REPORT_DECIDED',
  CUSTOM_TRACKING_SUPPRESSED = 'CUSTOM_TRACKING_SUPPRESSED',
  CUSTOM_TRACKING_RESTORED = 'CUSTOM_TRACKING_RESTORED',
  STORYTIME_CONTENT_REMOVED = 'STORYTIME_CONTENT_REMOVED',
  STORYTIME_CONTENT_RESTORED = 'STORYTIME_CONTENT_RESTORED',
  STORYTIME_REPORT_DECIDED = 'STORYTIME_REPORT_DECIDED',
  STORYTIME_APPEAL_DECIDED = 'STORYTIME_APPEAL_DECIDED',
  /** An image estate copy started (FC-040). */
  IMAGE_COPY_STARTED = 'IMAGE_COPY_STARTED',
  /** Every copy not yet retired put back (FC-040). */
  IMAGE_UNDO_STARTED = 'IMAGE_UNDO_STARTED',
  /** The old public copies deleted (FC-040). */
  IMAGE_RETIRE_STARTED = 'IMAGE_RETIRE_STARTED',
  IMAGE_RUN_PAUSED = 'IMAGE_RUN_PAUSED',
  IMAGE_RUN_RESUMED = 'IMAGE_RUN_RESUMED',
  /** A rescan campaign started (FC-041). */
  RESCAN_STARTED = 'RESCAN_STARTED',
  RESCAN_PAUSED = 'RESCAN_PAUSED',
  RESCAN_RESUMED = 'RESCAN_RESUMED',
  RESCAN_CANCELLED = 'RESCAN_CANCELLED',
  /** A reported chat message removed by a site admin (FC-050). */
  CHAT_MESSAGE_REMOVED = 'CHAT_MESSAGE_REMOVED',
  /** A picture refused for policy on rescan, taken down (FC-050). */
  IMAGE_TAKEN_DOWN = 'IMAGE_TAKEN_DOWN',
  /** A picture refused for policy on rescan, kept (FC-050). */
  IMAGE_KEPT = 'IMAGE_KEPT',
  /**
   * The restore check at boot brought back records an older backup lacked,
   * from the ledgers kept outside the database; no actor (FC-042).
   */
  LEDGERS_RECONCILED = 'LEDGERS_RECONCILED',
  /** Scan Diagnostics, its refusals, an asset or the failed jobs read (FC-042). */
  SCAN_DIAGNOSTICS_VIEWED = 'SCAN_DIAGNOSTICS_VIEWED',
  /** A failed background job, or all of them, sent round again (FC-042). */
  SCAN_JOB_RETRIED = 'SCAN_JOB_RETRIED',
  /** Publication of scanned uploads paused (FC-042). */
  PUBLICATION_PAUSED = 'PUBLICATION_PAUSED',
  /** Publication of scanned uploads resumed (FC-042). */
  PUBLICATION_RESUMED = 'PUBLICATION_RESUMED',
  /** A failed background job, or those a retry cannot help, removed (FC-042). */
  SCAN_JOB_DISCARDED = 'SCAN_JOB_DISCARDED',
}
