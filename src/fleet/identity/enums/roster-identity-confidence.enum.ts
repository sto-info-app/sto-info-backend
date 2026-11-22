/**
 * How strongly the corroborating evidence supports a rename candidate.
 *
 * Never a reason to merge on its own. Every candidate needs a reviewer
 * whatever its confidence; this only tells them how much of what they would
 * expect to hold did. The hard gates — same handle or name, same unambiguous
 * join instant, same Class text, unique both ways — are what make something a
 * candidate at all, and a candidate that fails one of them is never raised.
 */
export enum RosterIdentityConfidence {
  /** Every corroborating signal that could be checked held. */
  HIGH = 'HIGH',
  /**
   * One corroborating signal did not hold, or an account rename rests on a
   * single Character.
   */
  MEDIUM = 'MEDIUM',
  /** Two or more corroborating signals did not hold. */
  LOW = 'LOW',
}
