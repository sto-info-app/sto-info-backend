/**
 * What happened to a membership, as its audit log records it (FC-021).
 *
 * A `scope_membership` row is updated in place, so without this log it
 * would remember only its latest state.
 */
export enum ScopeMembershipActionKind {
  /** Access was granted, through one of the three ways in. */
  APPROVED = 'APPROVED',
  /** The member chose to leave. */
  LEFT = 'LEFT',
  /** Somebody holding `members.manage` removed them, with a reason. */
  REMOVED = 'REMOVED',
  /** Somebody holding `members.manage` suspended them, with a reason (FC-036). */
  SUSPENDED = 'SUSPENDED',
  /** Somebody holding `members.manage` lifted the suspension, with a reason. */
  REINSTATED = 'REINSTATED',
}
