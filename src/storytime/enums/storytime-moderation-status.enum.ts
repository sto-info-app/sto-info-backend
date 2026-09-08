/**
 * Whether Storytime content has been administratively removed.
 *
 * Deliberately separate from publication status and from soft deletion. A
 * removal must not be undone by the creator republishing, must survive being
 * archived, and must be distinguishable from the creator deleting their own
 * work — none of which is true if removal is expressed through those fields.
 *
 * Prefixed because "moderation status" is a generic term that already has
 * neighbours in this codebase; this one concerns Storytime content, not the
 * member reports handled by the moderation module.
 */
export enum StorytimeModerationStatus {
  /** Normal content, subject only to its publication and visibility rules. */
  ACTIVE = 'ACTIVE',
  /** Removed by an administrator; hidden publicly, retained in the database. */
  REMOVED = 'REMOVED',
}
