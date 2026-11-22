/**
 * What a change of rank label was, once the Fleet's rank order says
 * (FC-020).
 *
 * Only ever a move between two tiers. A change within a tier, or to or from
 * a label nobody placed, has no move: it is "rank changed" and nothing more
 * (plan section 3.7).
 */
export enum RosterRankMove {
  /** To a higher tier. */
  PROMOTED = 'PROMOTED',
  /** To a lower tier. */
  DEMOTED = 'DEMOTED',
}
