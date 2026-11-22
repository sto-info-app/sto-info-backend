/**
 * How a roster membership episode is known to have begun.
 *
 * Said in terms of what the exports show, never as a date somebody joined:
 * the export that first lists a member is evidence that they were there, not
 * of when they arrived.
 */
export enum RosterEpisodeStart {
  /**
   * First listed here, and no earlier complete export shows them absent —
   * usually because this is the Fleet's first export. When they arrived is
   * not known from the exports.
   */
  FIRST_SEEN = 'FIRST_SEEN',

  /**
   * An earlier complete export did not list them and this one does, so they
   * arrived between the two.
   */
  JOINED = 'JOINED',

  /** As JOINED, for a member who had an earlier episode that ended. */
  REJOINED = 'REJOINED',
}
