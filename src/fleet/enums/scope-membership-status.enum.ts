/**
 * Lifecycle of an approved-access record at Community, Fleet or Armada scope.
 *
 * This is the access grant itself, not evidence of one. A roster row naming a
 * Character proves nothing here and a Community subscription grants nothing
 * here — ADR-0002. Only `APPROVED` confers access, and a `SUSPENDED` row denies
 * it outright rather than falling back to a weaker grant.
 */
export enum ScopeMembershipStatus {
  /** Requested, awaiting a decision. Confers nothing. */
  PENDING = 'PENDING',
  /** Access granted. */
  APPROVED = 'APPROVED',
  /** Held by an administrator. Denies access while it stands. */
  SUSPENDED = 'SUSPENDED',
  /** The request was turned down. */
  REJECTED = 'REJECTED',
  /** The member chose to leave. */
  LEFT = 'LEFT',
  /** Access was withdrawn by the scope. */
  REVOKED = 'REVOKED',
}
