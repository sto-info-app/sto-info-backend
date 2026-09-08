/**
 * How a time of day is written out.
 *
 * `LOCALE` defers to whatever the reader's browser reports, which suits a site
 * with an international audience; the other two are for a creator who wants
 * every reader to see the same thing regardless of where they are.
 */
export enum CustomTrackingTimeFormat {
  /** Whatever the viewer's own locale uses. */
  LOCALE = 'LOCALE',
  /** A 24-hour clock, as in `14:30`. */
  TWENTY_FOUR_HOUR = 'TWENTY_FOUR_HOUR',
  /** A 12-hour clock, as in `2:30 PM`. */
  TWELVE_HOUR = 'TWELVE_HOUR',
}
