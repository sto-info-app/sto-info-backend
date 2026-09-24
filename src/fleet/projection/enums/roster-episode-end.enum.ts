/**
 * How a roster membership episode is known to have ended.
 *
 * An episode still open has no end. A member missing from a partial export,
 * or whose row was excluded, is unknown there, and that never ends one.
 */
export enum RosterEpisodeEnd {
  /**
   * A complete export did not list them, so they left between the last
   * export that did and that one. Never the later export's own date.
   */
  LEFT = 'LEFT',

  /**
   * Still listed, but with a Join Date after the last export that listed
   * them: they left and came back between the two. Steve's decision of
   * 25 September 2026.
   */
  LEFT_AND_REJOINED = 'LEFT_AND_REJOINED',
}
