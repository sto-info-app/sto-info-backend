/**
 * How often notification emails go out (sc-1067).
 *
 * One choice for every notification email. A login alert ignores it and is
 * always sent at once, because a sign-in somebody did not make is worth
 * knowing about now, not at breakfast.
 */
export enum EmailFrequency {
  /** Within a minute, with reactions and followers held to one an hour. */
  INSTANT = 'INSTANT',
  /** One email at 08:00 in the user's zone. */
  DAILY = 'DAILY',
  /** One email on Monday at 08:00 in the user's zone. */
  WEEKLY = 'WEEKLY',
}
