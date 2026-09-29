/**
 * How an event repeats (FC-028).
 *
 * Steve's decision of 28 September 2026: once, every N weeks on chosen
 * weekdays, or every N months on a day of the month or on the first to
 * fourth or last of a weekday. Nothing daily.
 */
export enum EventRecurrence {
  /** Once. */
  NONE = 'NONE',
  /** Every N weeks, on one or more weekdays. */
  WEEKLY = 'WEEKLY',
  /** Every N months, on a day of the month. A month without it is skipped. */
  MONTHLY_DAY = 'MONTHLY_DAY',
  /** Every N months, on the first to fourth or the last of a weekday. */
  MONTHLY_WEEKDAY = 'MONTHLY_WEEKDAY',
}

/**
 * How an occurrence's local time was placed on the timeline.
 *
 * Kept so the organiser is shown which occurrences the daylight-saving policy
 * chose for, and so a reader is never surprised by a time that is not the one
 * the rule names.
 */
export enum OccurrenceAdjustment {
  /** The local time happens exactly once that day. */
  NONE = 'NONE',
  /** The clock went back over it, and the earlier of the two was taken. */
  REPEATED_TIME = 'REPEATED_TIME',
  /** The clock jumped over it, and it moved forward by the jump. */
  MISSING_TIME = 'MISSING_TIME',
}
