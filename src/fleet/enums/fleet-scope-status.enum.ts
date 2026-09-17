/**
 * Lifecycle state of a Community, Fleet or Armada record.
 *
 * Shared by all three because they close the same way: the record stays,
 * history stays readable, and nothing new may be attached to it. Closure is a
 * status change rather than a delete precisely so the Armada links and roster
 * history recorded against it survive — plan section 4.1.
 */
export enum FleetScopeStatus {
  /** Operating normally. */
  ACTIVE = 'ACTIVE',
  /** Administratively held; readable, but no new activity is accepted. */
  SUSPENDED = 'SUSPENDED',
  /** Closed by its owner. Retained for history and never reopened in place. */
  CLOSED = 'CLOSED',
}
