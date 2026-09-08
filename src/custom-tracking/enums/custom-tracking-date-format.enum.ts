/**
 * How a date is written out.
 *
 * The format belongs to the Field's definition and cannot be overridden for an
 * individual Account or Character. A column of dates is only readable when
 * every row is written the same way, and letting each value choose would make
 * that impossible to guarantee.
 */
export enum CustomTrackingDateFormat {
  /** The month spelled out, as in `4 September 2026`. */
  LONG = 'LONG',
  /** The month abbreviated, as in `4 Sept 2026`. */
  SHORT = 'SHORT',
}
