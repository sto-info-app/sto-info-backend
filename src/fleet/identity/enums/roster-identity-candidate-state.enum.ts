/**
 * Where a reviewer has left a rename candidate.
 *
 * Every value but `OPEN` is something a person decided, and each decision is
 * recorded as its own row in `fleet_roster_identity_decision`, so the state
 * here is only the latest of them. Undoing a decision returns the candidate to
 * `OPEN` rather than deleting anything: the mapping is reversible because the
 * history of it is kept.
 */
export enum RosterIdentityCandidateState {
  /** Nobody has decided it, or the last decision was undone. */
  OPEN = 'OPEN',
  /** A reviewer said the two are the same Character. */
  CONFIRMED = 'CONFIRMED',
  /** A reviewer said they are not, and it will not be suggested again. */
  REJECTED = 'REJECTED',
}
