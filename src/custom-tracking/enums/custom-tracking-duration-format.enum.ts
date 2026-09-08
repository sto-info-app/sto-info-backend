/**
 * How a length of time is written out.
 *
 * Both forms are rendered from the same stored components, so changing the
 * format later re-reads existing values rather than rewriting them.
 */
export enum CustomTrackingDurationFormat {
  /** Abbreviated, as in `2d 4h 30m`. */
  COMPACT = 'COMPACT',
  /** Spelled out, as in `2 days, 4 hours, 30 minutes`. */
  LONG = 'LONG',
}
