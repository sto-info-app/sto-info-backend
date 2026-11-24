import { EmailFrequency } from 'src/user/enums/email-frequency.enum';

import {
  NotificationEmailType,
  THROTTLED_EMAIL_TYPES,
} from './notification-email-type.enum';

/** The local hour digests go out at. */
export const DIGEST_HOUR = 8;

/** How long a throttled type waits after one of its emails. */
export const THROTTLE_MS = 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Monday, as `Date.getUTCDay()` counts. */
const MONDAY = 1;

/**
 * The wall-clock date and time an instant shows in a zone.
 *
 * @param instant - The instant.
 * @param timeZone - The IANA zone.
 * @returns Its local parts, with the weekday counted from Sunday as 0.
 */
function localParts(
  instant: Date,
  timeZone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find(part => part.type === type)?.value);

  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

/**
 * How far a zone is ahead of UTC at an instant, in milliseconds.
 *
 * @param instant - The instant.
 * @param timeZone - The IANA zone.
 * @returns The offset.
 */
function offsetAt(instant: Date, timeZone: string): number {
  const local = localParts(instant, timeZone);
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );

  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant a local date's digest hour falls at in a zone.
 *
 * Asked twice, so a date whose offset changes during the night still lands on
 * 08:00 by the clock on the wall.
 *
 * @param year - The local year.
 * @param month - The local month, from 1.
 * @param day - The local day.
 * @param timeZone - The IANA zone.
 * @returns The instant.
 */
function digestInstant(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const wall = Date.UTC(year, month - 1, day, DIGEST_HOUR);
  const first = wall - offsetAt(new Date(wall), timeZone);

  return new Date(wall - offsetAt(new Date(first), timeZone));
}

/**
 * The next digest after an instant: 08:00 in the zone, on a Monday for a
 * weekly one.
 *
 * @param now - The instant.
 * @param timeZone - The IANA zone, or null for UTC.
 * @param weekly - Whether only Mondays count.
 * @returns The next digest's instant, always after `now`.
 */
export function nextDigestAt(
  now: Date,
  timeZone: string | null,
  weekly: boolean,
): Date {
  const zone = timeZone ?? 'UTC';
  const today = localParts(now, zone);
  // Noon UTC on the local date, so stepping a day never crosses a date line.
  const noon = Date.UTC(today.year, today.month - 1, today.day, 12);

  for (let step = 0; step <= 7; step += 1) {
    const date = new Date(noon + step * DAY_MS);

    if (weekly && date.getUTCDay() !== MONDAY) {
      continue;
    }

    const candidate = digestInstant(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      zone,
    );

    if (candidate.getTime() > now.getTime()) {
      return candidate;
    }
  }

  // Unreachable: within eight days there is always a later Monday at 08:00.
  /* istanbul ignore next */
  return new Date(now.getTime() + 7 * DAY_MS);
}

/**
 * When a notification email may go out.
 *
 * @param type - The kind of email.
 * @param frequency - How often the person wants them.
 * @param timeZone - Their display zone, or null for UTC.
 * @param now - The moment it is queued, or rescheduled.
 * @param lastSentAt - When the last email of this type went to them, or null.
 * @returns The instant it is due.
 */
export function emailDueAt(
  type: NotificationEmailType,
  frequency: EmailFrequency,
  timeZone: string | null,
  now: Date,
  lastSentAt: Date | null,
): Date {
  if (frequency === EmailFrequency.DAILY) {
    return nextDigestAt(now, timeZone, false);
  }

  if (frequency === EmailFrequency.WEEKLY) {
    return nextDigestAt(now, timeZone, true);
  }

  if (THROTTLED_EMAIL_TYPES.has(type) && lastSentAt !== null) {
    return new Date(
      Math.max(now.getTime(), lastSentAt.getTime() + THROTTLE_MS),
    );
  }

  return now;
}
