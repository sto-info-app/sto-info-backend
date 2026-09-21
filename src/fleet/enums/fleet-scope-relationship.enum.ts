/**
 * How the caller stands to a Community, Fleet or Armada, as a page should say
 * it.
 *
 * Three different records answer this and they are deliberately not the same
 * thing (ADR-0002): a `community_subscription` row is following, a `PENDING`
 * `scope_membership` is an unanswered request, and an `APPROVED` one is access.
 * Reporting them as one value is for the reader's benefit, not the checker's —
 * nothing is ever authorised from this. Every route still resolves the records
 * themselves.
 *
 * Stored nowhere. It is read from the three records each time, so it cannot go
 * stale against them, and adding a value here can never widen an access check
 * because no access check reads it.
 *
 * The values a membership can hold and this cannot — `REJECTED`, `LEFT`,
 * `REVOKED` — are history. The record stays for the audit trail, but the page
 * says what is true now rather than greeting somebody with a refusal they
 * already had.
 */
export enum FleetScopeRelationship {
  /** Nothing at all. A reader, and possibly a stranger. */
  NONE = 'NONE',
  /** Follows the owning Community. Grants no access to anything (R07). */
  FOLLOWER = 'FOLLOWER',
  /** Has asked to join this scope and has not been answered. */
  REQUESTED = 'REQUESTED',
  /** An approved member of this exact scope. */
  MEMBER = 'MEMBER',
  /** A member whose access an administrator is currently holding. */
  SUSPENDED = 'SUSPENDED',
}
