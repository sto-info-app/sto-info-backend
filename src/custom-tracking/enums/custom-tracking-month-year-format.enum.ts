/**
 * How a month and year are written out.
 *
 * The numeric form is deliberately `09/2026` rather than `09/26`: a two-digit
 * year in a game whose seasons are themselves numbered invites exactly the
 * misreading the format was chosen to avoid.
 */
export enum CustomTrackingMonthYearFormat {
  /** The month spelled out, as in `September 2026`. */
  LONG = 'LONG',
  /** The month abbreviated, as in `Sep 2026`. */
  SHORT = 'SHORT',
  /** Numeric, as in `09/2026`. */
  NUMERIC = 'NUMERIC',
}
