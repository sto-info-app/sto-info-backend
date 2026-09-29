import {
  LocalTimeResolution,
  scheduleLocalDateTime,
  toLocalDateTime,
} from 'src/shared/utilities/timezone.utility';

import {
  EventRecurrence,
  OccurrenceAdjustment,
} from '../enums/event-recurrence.enum';

/** One day, in milliseconds. */
const DAY = 86_400_000;

/** One minute, in milliseconds. */
const MINUTE = 60_000;

/** The week number meaning the last of a weekday in its month. */
export const LAST_WEEK_OF_MONTH = -1;

/** An event's timing: when it first happens, how it repeats and how long. */
export interface EventSchedule {
  /** How it repeats. */
  readonly recurrence: EventRecurrence;
  /** Its first day, as `YYYY-MM-DD` in its own timezone. */
  readonly startDate: string;
  /** When it starts on each day, as `HH:mm` in its own timezone. */
  readonly startTime: string;
  /** Every how many weeks or months, from 1. Ignored for a one-off. */
  readonly interval: number;
  /** For a weekly event, the ISO weekdays: 1 is Monday, 7 is Sunday. */
  readonly weekdays: readonly number[];
  /** For a monthly event on a day of the month, that day. */
  readonly monthDay: number | null;
  /** For a monthly event on a weekday, which: 1 to 4, or -1 for the last. */
  readonly monthWeek: number | null;
  /** For a monthly event on a weekday, the ISO weekday. */
  readonly monthWeekday: number | null;
  /** Its last possible day, inclusive, or null. */
  readonly endsOn: string | null;
  /** How many times it happens at most, counted from its first, or null. */
  readonly occurrenceLimit: number | null;
  /** The IANA timezone its clock follows. */
  readonly timezone: string;
  /** How long each occurrence lasts. */
  readonly durationMinutes: number;
}

/** One occurrence the rule names, placed on the timeline. */
export interface PlannedOccurrence {
  /**
   * The day the rule names it for, as `YYYY-MM-DD`. Stable across edits that
   * keep the day, which is what lets an occurrence keep its answers.
   */
  readonly key: string;
  /** When it starts on the event's own clock, as `YYYY-MM-DDTHH:mm`. */
  readonly localStart: string;
  /** When it starts. */
  readonly startsAt: Date;
  /** When it ends. */
  readonly endsAt: Date;
  /** How the daylight-saving policy placed it, if it had to. */
  readonly adjustment: OccurrenceAdjustment;
}

/** What a rule comes to over a stretch of the calendar. */
export interface OccurrencePlan {
  /** Each occurrence, earliest first. */
  readonly occurrences: PlannedOccurrence[];
  /**
   * The months, as `YYYY-MM`, a monthly event skips because they have no
   * such day. Steve's decision: skipped, and shown in the preview.
   */
  readonly skippedMonths: string[];
}

/** How the timezone utility's answer is told to the organiser. */
const ADJUSTMENTS: Readonly<Record<LocalTimeResolution, OccurrenceAdjustment>> =
  {
    [LocalTimeResolution.EXACT]: OccurrenceAdjustment.NONE,
    [LocalTimeResolution.AMBIGUOUS]: OccurrenceAdjustment.REPEATED_TIME,
    [LocalTimeResolution.NONEXISTENT]: OccurrenceAdjustment.MISSING_TIME,
  };

/**
 * Works out every occurrence a rule names up to a day (FC-028).
 *
 * Days are counted on the event's own calendar, so a weekly event is on its
 * weekday wherever the reader is. Each day's start is then placed by the
 * daylight-saving policy in {@link scheduleLocalDateTime}. A rule with a
 * limit on its count counts from its first day, whatever stretch is asked
 * for, so the tenth occurrence is the tenth however the plan is cut.
 *
 * @param schedule - The rule. Assumed valid; the request was checked first.
 * @param throughDate - The last day to plan, as `YYYY-MM-DD`, inclusive.
 * @returns The occurrences, and any months skipped.
 */
export function planOccurrences(
  schedule: EventSchedule,
  throughDate: string,
): OccurrencePlan {
  const start = dayOf(schedule.startDate);
  const through = Math.min(
    dayOf(throughDate),
    schedule.endsOn === null ? Infinity : dayOf(schedule.endsOn),
  );
  const limit = schedule.occurrenceLimit ?? Infinity;
  const skippedMonths: string[] = [];
  const days: number[] = [];

  for (const day of slotsOf(schedule, start, through, skippedMonths)) {
    if (days.length >= limit) {
      break;
    }

    days.push(day);
  }

  return {
    occurrences: days.map(day =>
      placeOccurrence(
        dateOf(day),
        schedule.startTime,
        schedule.timezone,
        schedule.durationMinutes,
      ),
    ),
    skippedMonths,
  };
}

/**
 * Places one occurrence on the timeline.
 *
 * Also how a single occurrence is moved: the organiser names a day and a time
 * on the event's clock and the same policy places it.
 *
 * @param date - Its day, as `YYYY-MM-DD`.
 * @param time - Its start, as `HH:mm`.
 * @param timezone - The IANA timezone its clock follows.
 * @param durationMinutes - How long it lasts.
 * @returns The occurrence, keyed by the day.
 */
export function placeOccurrence(
  date: string,
  time: string,
  timezone: string,
  durationMinutes: number,
): PlannedOccurrence {
  // The day and time were checked on the way in, and the zone is one the
  // event was saved with, so there is always an answer.
  const { instant, resolution } = scheduleLocalDateTime(
    `${date}T${time}`,
    timezone,
  ) as NonNullable<ReturnType<typeof scheduleLocalDateTime>>;

  return {
    key: date,
    localStart: (toLocalDateTime(instant, timezone) as string).slice(0, 16),
    startsAt: instant,
    endsAt: new Date(instant.getTime() + durationMinutes * MINUTE),
    adjustment: ADJUSTMENTS[resolution],
  };
}

/**
 * The day, as `YYYY-MM-DD`, that an instant falls on in a timezone.
 *
 * @param instant - The instant.
 * @param timezone - The IANA timezone.
 * @returns The day.
 */
export function localDateOf(instant: Date, timezone: string): string {
  return (toLocalDateTime(instant, timezone) as string).slice(0, 10);
}

/**
 * The same day a number of months later, clamped to the month's end.
 *
 * @param date - The day, as `YYYY-MM-DD`.
 * @param months - How many months on.
 * @returns The day, as `YYYY-MM-DD`.
 */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = daysInMonth(target.getUTCFullYear(), target.getUTCMonth());

  target.setUTCDate(Math.min(day, last));

  return dateOf(target.getTime());
}

/**
 * Walks the days a rule names, earliest first, from its first day.
 *
 * @param schedule - The rule.
 * @param start - Its first day.
 * @param through - The last day wanted.
 * @param skippedMonths - Collects the months a monthly rule skips.
 * @yields Each day, as milliseconds at midnight UTC.
 */
function* slotsOf(
  schedule: EventSchedule,
  start: number,
  through: number,
  skippedMonths: string[],
): Generator<number> {
  switch (schedule.recurrence) {
    case EventRecurrence.NONE:
      if (start <= through) {
        yield start;
      }
      return;
    case EventRecurrence.WEEKLY:
      yield* weeklySlots(schedule, start, through);
      return;
    case EventRecurrence.MONTHLY_DAY:
    case EventRecurrence.MONTHLY_WEEKDAY:
      yield* monthlySlots(schedule, start, through, skippedMonths);
  }
}

/**
 * The days of a weekly rule: its weekdays, in every Nth week counted from
 * the week of its first day, Monday to Sunday.
 *
 * @param schedule - The rule.
 * @param start - Its first day.
 * @param through - The last day wanted.
 * @yields Each day.
 */
function* weeklySlots(
  schedule: EventSchedule,
  start: number,
  through: number,
): Generator<number> {
  const weekdays = [...new Set(schedule.weekdays)].sort((a, b) => a - b);
  const firstMonday = start - (isoWeekday(start) - 1) * DAY;

  for (
    let monday = firstMonday;
    monday <= through;
    monday += 7 * DAY * schedule.interval
  ) {
    for (const weekday of weekdays) {
      const day = monday + (weekday - 1) * DAY;

      if (day >= start && day <= through) {
        yield day;
      }
    }
  }
}

/**
 * The days of a monthly rule, in every Nth month counted from the month of
 * its first day.
 *
 * @param schedule - The rule.
 * @param start - Its first day.
 * @param through - The last day wanted.
 * @param skippedMonths - Collects the months with no such day.
 * @yields Each day.
 */
function* monthlySlots(
  schedule: EventSchedule,
  start: number,
  through: number,
  skippedMonths: string[],
): Generator<number> {
  const first = new Date(start);

  for (let months = 0; ; months += schedule.interval) {
    const monthStart = Date.UTC(
      first.getUTCFullYear(),
      first.getUTCMonth() + months,
      1,
    );

    if (monthStart > through) {
      return;
    }

    const day = dayInMonth(schedule, monthStart);

    if (day === null) {
      skippedMonths.push(dateOf(monthStart).slice(0, 7));
    } else if (day >= start && day <= through) {
      yield day;
    }
  }
}

/**
 * The day a monthly rule names in one month.
 *
 * @param schedule - The rule.
 * @param monthStart - The month's first day.
 * @returns The day, or null when the month has none: a day of the month it
 *   is too short for.
 */
function dayInMonth(
  schedule: EventSchedule,
  monthStart: number,
): number | null {
  const month = new Date(monthStart);
  const length = daysInMonth(month.getUTCFullYear(), month.getUTCMonth());

  if (schedule.recurrence === EventRecurrence.MONTHLY_DAY) {
    const day = schedule.monthDay as number;

    return day > length ? null : monthStart + (day - 1) * DAY;
  }

  const weekday = schedule.monthWeekday as number;

  if (schedule.monthWeek === LAST_WEEK_OF_MONTH) {
    const lastDay = monthStart + (length - 1) * DAY;

    return lastDay - ((isoWeekday(lastDay) - weekday + 7) % 7) * DAY;
  }

  // The first to fourth of a weekday always falls within the month.
  const firstOfWeekday =
    monthStart + ((weekday - isoWeekday(monthStart) + 7) % 7) * DAY;

  return firstOfWeekday + ((schedule.monthWeek as number) - 1) * 7 * DAY;
}

/**
 * Reads a day as milliseconds at midnight UTC.
 *
 * @param date - The day, as `YYYY-MM-DD`.
 * @returns The milliseconds.
 */
function dayOf(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/**
 * Writes a day held as milliseconds at midnight UTC.
 *
 * @param day - The milliseconds.
 * @returns The day, as `YYYY-MM-DD`.
 */
function dateOf(day: number): string {
  return new Date(day).toISOString().slice(0, 10);
}

/**
 * The ISO weekday of a day: 1 is Monday, 7 is Sunday.
 *
 * @param day - The day, as milliseconds at midnight UTC.
 * @returns The weekday.
 */
function isoWeekday(day: number): number {
  return ((new Date(day).getUTCDay() + 6) % 7) + 1;
}

/**
 * How many days a month has.
 *
 * @param year - The year.
 * @param monthIndex - The month, from 0.
 * @returns The number of days.
 */
function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}
