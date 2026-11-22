import {
  EventRecurrence,
  OccurrenceAdjustment,
} from '../enums/event-recurrence.enum';
import {
  addMonths,
  EventSchedule,
  LAST_WEEK_OF_MONTH,
  localDateOf,
  placeOccurrence,
  planOccurrences,
} from './event-recurrence.utility';

/**
 * Builds a rule: once, at eight in the evening in London, for two hours.
 *
 * @param overrides - What differs.
 * @returns The rule.
 */
function schedule(overrides: Partial<EventSchedule> = {}): EventSchedule {
  return {
    recurrence: EventRecurrence.NONE,
    startDate: '2026-10-02',
    startTime: '20:00',
    interval: 1,
    weekdays: [],
    monthDay: null,
    monthWeek: null,
    monthWeekday: null,
    endsOn: null,
    occurrenceLimit: null,
    timezone: 'Europe/London',
    durationMinutes: 120,
    ...overrides,
  };
}

/**
 * The days a rule names.
 *
 * @param rule - The rule.
 * @param through - The last day wanted.
 * @returns The days.
 */
function days(rule: EventSchedule, through = '2027-12-31'): string[] {
  return planOccurrences(rule, through).occurrences.map(({ key }) => key);
}

describe('planOccurrences', () => {
  it('places a one-off on its day, on its own clock', () => {
    expect(planOccurrences(schedule(), '2026-12-31')).toEqual({
      occurrences: [
        {
          key: '2026-10-02',
          localStart: '2026-10-02T20:00',
          startsAt: new Date('2026-10-02T19:00:00Z'),
          endsAt: new Date('2026-10-02T21:00:00Z'),
          adjustment: OccurrenceAdjustment.NONE,
        },
      ],
      skippedMonths: [],
    });
  });

  it('plans nothing for a one-off beyond the stretch asked for', () => {
    expect(days(schedule(), '2026-10-01')).toEqual([]);
  });

  describe('weekly', () => {
    const weekly = (overrides: Partial<EventSchedule> = {}) =>
      schedule({
        recurrence: EventRecurrence.WEEKLY,
        weekdays: [5, 2],
        ...overrides,
      });

    it('names each chosen weekday from the first day, in order', () => {
      // 2 October 2026 is a Friday, so that week's Tuesday has gone.
      expect(days(weekly(), '2026-10-16')).toEqual([
        '2026-10-02',
        '2026-10-06',
        '2026-10-09',
        '2026-10-13',
        '2026-10-16',
      ]);
    });

    it('skips the weeks between for every other week', () => {
      expect(
        days(weekly({ interval: 2, weekdays: [5, 5] }), '2026-10-31'),
      ).toEqual(['2026-10-02', '2026-10-16', '2026-10-30']);
    });

    it('stops on its last day, or after its count', () => {
      expect(days(weekly({ weekdays: [5], endsOn: '2026-10-16' }))).toEqual([
        '2026-10-02',
        '2026-10-09',
        '2026-10-16',
      ]);
      expect(days(weekly({ occurrenceLimit: 3 }))).toEqual([
        '2026-10-02',
        '2026-10-06',
        '2026-10-09',
      ]);
    });

    it('keeps its local time across the clocks going back', () => {
      const [before, after] = planOccurrences(
        weekly({ weekdays: [5], startDate: '2026-10-23' }),
        '2026-10-30',
      ).occurrences;

      expect(before.startsAt).toEqual(new Date('2026-10-23T19:00:00Z'));
      expect(after.startsAt).toEqual(new Date('2026-10-30T20:00:00Z'));
      expect(after.localStart).toBe('2026-10-30T20:00');
    });
  });

  describe('monthly on a day', () => {
    const monthly = (overrides: Partial<EventSchedule> = {}) =>
      schedule({
        recurrence: EventRecurrence.MONTHLY_DAY,
        startDate: '2026-10-31',
        monthDay: 31,
        ...overrides,
      });

    it('skips a month without the day, and says so', () => {
      expect(planOccurrences(monthly(), '2027-03-31')).toEqual(
        expect.objectContaining({
          skippedMonths: ['2026-11', '2027-02'],
        }),
      );
      expect(days(monthly(), '2027-03-31')).toEqual([
        '2026-10-31',
        '2026-12-31',
        '2027-01-31',
        '2027-03-31',
      ]);
    });

    it('does not name a day before the first', () => {
      expect(
        days(monthly({ startDate: '2026-10-15', monthDay: 10 }), '2026-12-31'),
      ).toEqual(['2026-11-10', '2026-12-10']);
    });

    it('counts every Nth month', () => {
      expect(
        days(
          monthly({ monthDay: 1, startDate: '2026-10-01', interval: 3 }),
          '2027-07-01',
        ),
      ).toEqual(['2026-10-01', '2027-01-01', '2027-04-01', '2027-07-01']);
    });
  });

  describe('monthly on a weekday', () => {
    const monthly = (week: number, weekday: number) =>
      schedule({
        recurrence: EventRecurrence.MONTHLY_WEEKDAY,
        startDate: '2026-10-01',
        monthWeek: week,
        monthWeekday: weekday,
      });

    it('names the second Saturday', () => {
      expect(days(monthly(2, 6), '2026-12-31')).toEqual([
        '2026-10-10',
        '2026-11-14',
        '2026-12-12',
      ]);
    });

    it('names the first of a weekday that opens the month', () => {
      // 1 October 2026 is a Thursday.
      expect(days(monthly(1, 4), '2026-10-31')).toEqual(['2026-10-01']);
    });

    it('names the last Friday, whatever the month’s length', () => {
      expect(days(monthly(LAST_WEEK_OF_MONTH, 5), '2027-02-28')).toEqual([
        '2026-10-30',
        '2026-11-27',
        '2026-12-25',
        '2027-01-29',
        '2027-02-26',
      ]);
    });

    it('names the last Saturday when the month ends on one', () => {
      expect(days(monthly(LAST_WEEK_OF_MONTH, 6), '2026-10-31')).toEqual([
        '2026-10-31',
      ]);
    });
  });
});

describe('placeOccurrence', () => {
  it('takes the earlier of a time the clock repeats, and says so', () => {
    expect(placeOccurrence('2026-10-25', '01:30', 'Europe/London', 60)).toEqual(
      {
        key: '2026-10-25',
        localStart: '2026-10-25T01:30',
        startsAt: new Date('2026-10-25T00:30:00Z'),
        endsAt: new Date('2026-10-25T01:30:00Z'),
        adjustment: OccurrenceAdjustment.REPEATED_TIME,
      },
    );
  });

  it('moves a time the clock jumps over forward, and says so', () => {
    expect(placeOccurrence('2027-03-28', '01:30', 'Europe/London', 30)).toEqual(
      {
        key: '2027-03-28',
        localStart: '2027-03-28T02:30',
        startsAt: new Date('2027-03-28T01:30:00Z'),
        endsAt: new Date('2027-03-28T02:00:00Z'),
        adjustment: OccurrenceAdjustment.MISSING_TIME,
      },
    );
  });
});

describe('calendar helpers', () => {
  it('reads the day an instant falls on in a zone', () => {
    expect(localDateOf(new Date('2026-10-02T23:30:00Z'), 'Europe/London')).toBe(
      '2026-10-03',
    );
  });

  it('adds months, keeping the day where the month has it', () => {
    expect(addMonths('2026-10-02', 12)).toBe('2027-10-02');
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
  });
});
