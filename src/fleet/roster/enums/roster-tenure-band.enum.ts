/**
 * How long a member had been listed at an export (FC-020).
 *
 * Measured from the first export of the member's current episode to the
 * export itself — observed, never the game's Join Date (Steve's decision of
 * 25 September 2026). A member first seen on the Fleet's first export had
 * been there at least that long, and is counted as such.
 */
export enum RosterTenureBand {
  /** Under 30 days. */
  UNDER_30_DAYS = 'UNDER_30_DAYS',
  /** 30 to 90 days. */
  DAYS_30_TO_90 = 'DAYS_30_TO_90',
  /** 90 days to a year. */
  MONTHS_3_TO_12 = 'MONTHS_3_TO_12',
  /** One to two years. */
  YEARS_1_TO_2 = 'YEARS_1_TO_2',
  /** Two years or more. */
  OVER_2_YEARS = 'OVER_2_YEARS',
}
