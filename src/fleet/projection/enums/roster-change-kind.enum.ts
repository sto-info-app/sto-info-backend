/**
 * Something the exports show changed about one member, between two exports.
 *
 * Every change is bounded by the two exports it was seen between and never
 * dated more exactly than that.
 */
export enum RosterChangeKind {
  /** An episode began, and an earlier complete export shows when after. */
  JOINED = 'JOINED',

  /** As JOINED, for a member whose earlier episode had ended. */
  REJOINED = 'REJOINED',

  /** An episode ended. */
  LEFT = 'LEFT',

  /** The same identity was listed under a different name or handle. */
  RENAMED = 'RENAMED',

  /**
   * The Fleet's rank label changed. Never called a promotion: labels are the
   * Fleet's own text and nothing says which way they order.
   */
  RANK_CHANGED = 'RANK_CHANGED',

  /** The game's Join Date changed without the member having left. */
  JOIN_DATE_CHANGED = 'JOIN_DATE_CHANGED',

  /** The cumulative contribution rose, by the delta recorded. */
  CONTRIBUTION_CHANGED = 'CONTRIBUTION_CHANGED',

  /**
   * The cumulative contribution fell. A discontinuity with no delta, never a
   * negative donation: the later total is a new baseline.
   */
  CONTRIBUTION_RESET = 'CONTRIBUTION_RESET',
}
