/**
 * What a reviewer did to a rename candidate.
 *
 * Recorded once per act and never changed, which is what makes a confirmed
 * mapping reversible without losing the fact that it was once confirmed.
 */
export enum RosterIdentityDecisionAction {
  /** Said the two are the same Character. */
  CONFIRM = 'CONFIRM',
  /** Said they are not. */
  REJECT = 'REJECT',
  /** Withdrew the last decision, returning the candidate to open. */
  UNDO = 'UNDO',
}
