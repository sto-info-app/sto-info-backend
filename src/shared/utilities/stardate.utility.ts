/**
 * Star Trek Online's stardates (sc-1450).
 *
 * A stardate year runs from 25 May 00:00 UTC to the next 25 May, and year
 * 0 began in 1922, so a stardate is the years since then in thousands plus
 * how far through the current year the moment falls, in thousandths. Leap
 * years are allowed for by measuring each year's own length.
 *
 * Both directions are the ticket's own JavaScript, typed.
 */

/** The calendar year stardate year 0 began in. */
export const STARDATE_EPOCH_YEAR = 1922;

/** The month a stardate year begins in, zero-based: May. */
const STARDATE_YEAR_START_MONTH = 4;

/** The day of the month a stardate year begins on. */
const STARDATE_YEAR_START_DAY = 25;

/**
 * When a stardate year that starts in a calendar year begins.
 *
 * @param year - The calendar year.
 * @returns The start, in milliseconds since the epoch.
 */
function stardateYearStart(year: number): number {
  return Date.UTC(year, STARDATE_YEAR_START_MONTH, STARDATE_YEAR_START_DAY);
}

/**
 * Converts a moment into a Star Trek Online stardate.
 *
 * @param date - The moment; now when left out.
 * @returns The stardate, rounded to two decimal places.
 */
export function dateToStoStardate(date: Date = new Date()): number {
  let startYear = date.getUTCFullYear();
  let periodStart = stardateYearStart(startYear);

  if (date.getTime() < periodStart) {
    startYear -= 1;
    periodStart = stardateYearStart(startYear);
  }

  const periodDuration = stardateYearStart(startYear + 1) - periodStart;
  const elapsed = date.getTime() - periodStart;
  const stardate =
    (startYear - STARDATE_EPOCH_YEAR) * 1000 +
    (elapsed / periodDuration) * 1000;

  return Number(stardate.toFixed(2));
}

/**
 * Converts a Star Trek Online stardate back into a moment.
 *
 * @param stardate - The stardate, e.g. 104496.59.
 * @returns The moment it names, to the nearest millisecond.
 */
export function stoStardateToDate(stardate: number): Date {
  const startYear = STARDATE_EPOCH_YEAR + Math.floor(stardate / 1000);
  const fractionOfYear = (stardate % 1000) / 1000;
  const periodStart = stardateYearStart(startYear);
  const periodDuration = stardateYearStart(startYear + 1) - periodStart;

  return new Date(Math.round(periodStart + fractionOfYear * periodDuration));
}

/**
 * A stardate as the site writes one: to one decimal place.
 *
 * @param stardate - The stardate.
 * @returns It as text, e.g. "104496.6".
 */
export function formatStardate(stardate: number): string {
  return stardate.toFixed(1);
}
