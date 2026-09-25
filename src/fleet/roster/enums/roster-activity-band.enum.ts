/**
 * How recently a member was active, measured back from an export (FC-020).
 *
 * Bands at 7, 30 and 90 days before the export's own instant (Steve's
 * decision of 25 September 2026), from the latest Last Active of the
 * member's rows on it.
 */
export enum RosterActivityBand {
  /** Active within 7 days of the export. */
  WITHIN_7_DAYS = 'WITHIN_7_DAYS',
  /** Within 30 days, but not 7. */
  WITHIN_30_DAYS = 'WITHIN_30_DAYS',
  /** Within 90 days, but not 30. */
  WITHIN_90_DAYS = 'WITHIN_90_DAYS',
  /** More than 90 days before. */
  OVER_90_DAYS = 'OVER_90_DAYS',
  /** The export gave no Last Active. */
  UNKNOWN = 'UNKNOWN',
}
