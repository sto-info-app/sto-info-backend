/**
 * What a projection revision made of one import of the Fleet.
 *
 * Every import in force or held is listed with one of these, so a reader can
 * see not only what a report was built from but what it left out, and why.
 */
export enum RosterProjectionInputOutcome {
  /** Read into the projection. */
  EFFECTIVE = 'EFFECTIVE',

  /** Excluded by an investigator. */
  EXCLUDED = 'EXCLUDED',

  /** Another export of its moment was selected in its conflict group. */
  NOT_SELECTED = 'NOT_SELECTED',

  /** Held in a conflict group nobody has decided yet. */
  AWAITING_SELECTION = 'AWAITING_SELECTION',

  /** Says the same as the export of its moment that was read. */
  SAME_AS_EFFECTIVE = 'SAME_AS_EFFECTIVE',
}
