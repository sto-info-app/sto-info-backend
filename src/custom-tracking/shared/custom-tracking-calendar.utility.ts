import {
  CUSTOM_TRACKING_MAX_YEAR,
  CUSTOM_TRACKING_MIN_YEAR,
} from '../constants/custom-tracking-limits.constants';

/** A calendar date, as `YYYY-MM-DD`. */
const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A time of day, as `HH:mm` or `HH:mm:ss`. */
const WALL_CLOCK_TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Determines whether a string is a real calendar date.
 *
 * The pattern alone is not enough: `2026-02-30` matches it and is not a date.
 * Checking the day against the month is what stops a value being stored that
 * would move to the second of March the moment anything parsed it.
 *
 * A calendar date carries no timezone and is never converted to one. The
 * fourth of September is the fourth of September wherever it is read.
 *
 * @param value - The candidate.
 * @returns True when the string names a date that exists.
 */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const match = CALENDAR_DATE_PATTERN.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  return (
    isYearInRange(year) &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

/**
 * Determines whether a number is a year this feature will store.
 *
 * @param year - The candidate year.
 * @returns True when the year is a whole number in range.
 */
export function isYearInRange(year: number): boolean {
  return (
    Number.isInteger(year) &&
    year >= CUSTOM_TRACKING_MIN_YEAR &&
    year <= CUSTOM_TRACKING_MAX_YEAR
  );
}

/**
 * Determines whether a string is a wall-clock time.
 *
 * Seconds are optional, because most people entering a time do not mean to
 * name one.
 *
 * @param value - The candidate.
 * @returns True when the string names a time that exists.
 */
export function isWallClockTime(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const match = WALL_CLOCK_TIME_PATTERN.exec(value);

  if (!match) {
    return false;
  }

  return (
    Number(match[1]) <= 23 &&
    Number(match[2]) <= 59 &&
    Number(match[3] ?? '0') <= 59
  );
}

/**
 * Compares two calendar dates.
 *
 * Compared as text, which works because the format is fixed-width and
 * big-endian: the year is always four digits, the month always two, and so on.
 * Turning them into `Date` objects to compare them would introduce a timezone
 * where the values deliberately have none.
 *
 * @param left - The first date, as `YYYY-MM-DD`.
 * @param right - The second date, as `YYYY-MM-DD`.
 * @returns Negative when left is earlier, positive when later, zero when the
 *   same day.
 */
export function compareCalendarDates(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

/**
 * Returns how many days a month has, accounting for leap years.
 *
 * @param year - The year.
 * @param month - The month, counting from one.
 * @returns The number of days in that month.
 */
function daysInMonth(year: number, month: number): number {
  // Day zero of the following month is the last day of this one. The year is
  // set separately because `Date.UTC` reads a year below one hundred as a
  // nineteen-hundreds shorthand.
  const probe = new Date(0);

  probe.setUTCFullYear(year, month, 0);

  return probe.getUTCDate();
}
