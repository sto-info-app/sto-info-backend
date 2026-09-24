/**
 * A corroborating check made on a rename candidate.
 *
 * Graded rather than required, by Steve's decision of 24 September 2026: the
 * corpus has a probable rename whose contribution changed, so a check that
 * fails lowers the confidence and is shown to the reviewer rather than
 * stopping the candidate being raised. Each is phrased as the thing that
 * would be expected of one Character seen twice.
 */
export enum RosterIdentitySignal {
  /** The later row's level is not below the earlier row's. */
  LEVEL_NOT_LOWER = 'LEVEL_NOT_LOWER',
  /** The later row's cumulative contribution is not below the earlier's. */
  CONTRIBUTION_NOT_LOWER = 'CONTRIBUTION_NOT_LOWER',
  /**
   * The later row's rank change is not dated before the earlier row's. Not
   * checked where either date is missing or was one of two instants.
   */
  RANK_CHANGE_NOT_EARLIER = 'RANK_CHANGE_NOT_EARLIER',
}
