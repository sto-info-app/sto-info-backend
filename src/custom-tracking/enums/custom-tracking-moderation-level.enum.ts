/**
 * Which level of somebody's hierarchy an administrator is acting on.
 *
 * Three levels and no fourth. An option's label is part of the Field that
 * offers it, and an answer is only visible through the Field it answers, so
 * suppressing the Field covers both — and covers them for every Account and
 * Character at once, which is what an administrator dealing with offending
 * content actually wants. Suppressing one answer out of forty would leave the
 * other thirty-nine.
 */
export enum CustomTrackingModerationLevel {
  /** A whole Section, and everything beneath it. */
  SECTION = 'SECTION',
  /** A Tab, and the Fields in it. */
  TAB = 'TAB',
  /** One Field, wherever it appears. */
  FIELD = 'FIELD',
}
