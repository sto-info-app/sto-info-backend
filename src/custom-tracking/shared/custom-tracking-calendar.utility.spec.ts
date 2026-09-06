import {
  compareCalendarDates,
  isCalendarDate,
  isWallClockTime,
  isYearInRange,
} from './custom-tracking-calendar.utility';

describe('isCalendarDate', () => {
  it.each([
    ['an ordinary date', '2026-09-04'],
    ['the first of January', '2026-01-01'],
    ['the last of December', '2026-12-31'],
    ['a leap day', '2028-02-29'],
    ['the earliest year kept', '0001-01-01'],
    ['the latest year kept', '9999-12-31'],
  ])('accepts %s', (_description, value) => {
    expect(isCalendarDate(value)).toBe(true);
  });

  // The pattern alone accepts this. Only checking the day against its month
  // stops a value being stored that would become the second of March the
  // moment anything parsed it.
  it.each([
    ['the thirtieth of February', '2026-02-30'],
    ['the twenty-ninth of a common February', '2026-02-29'],
    ['the thirty-first of April', '2026-04-31'],
    ['the thirty-first of June', '2026-06-31'],
    ['month zero', '2026-00-04'],
    ['month thirteen', '2026-13-04'],
    ['day zero', '2026-09-00'],
    ['year zero', '0000-01-01'],
  ])('refuses %s', (_description, value) => {
    expect(isCalendarDate(value)).toBe(false);
  });

  it.each([
    ['a full instant', '2026-09-04T00:00:00Z'],
    ['a two-digit year', '26-09-04'],
    ['slashes', '2026/09/04'],
    ['no padding', '2026-9-4'],
    ['an empty string', ''],
    ['a number', 20260904],
    ['null', null],
    ['undefined', undefined],
  ])('refuses %s', (_description, value) => {
    expect(isCalendarDate(value)).toBe(false);
  });

  it('accepts the thirty-first of a thirty-one-day month', () => {
    expect(isCalendarDate('2026-07-31')).toBe(true);
  });
});

describe('isYearInRange', () => {
  it.each([1, 2026, 9999])('accepts %s', year => {
    expect(isYearInRange(year)).toBe(true);
  });

  it.each([0, -1, 10000, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %s',
    year => {
      expect(isYearInRange(year)).toBe(false);
    },
  );
});

describe('isWallClockTime', () => {
  it.each([
    ['midnight', '00:00'],
    ['the last minute of the day', '23:59'],
    ['a time with seconds', '14:30:15'],
    ['the last second of the day', '23:59:59'],
  ])('accepts %s', (_description, value) => {
    expect(isWallClockTime(value)).toBe(true);
  });

  it.each([
    ['hour twenty-four', '24:00'],
    ['minute sixty', '12:60'],
    ['second sixty', '12:00:60'],
    ['no padding', '9:05'],
    ['an offset', '12:00+01:00'],
    ['an empty string', ''],
    ['a number', 1200],
    ['null', null],
  ])('refuses %s', (_description, value) => {
    expect(isWallClockTime(value)).toBe(false);
  });
});

describe('compareCalendarDates', () => {
  it('orders two dates', () => {
    expect(compareCalendarDates('2026-01-01', '2026-12-31')).toBeLessThan(0);
    expect(compareCalendarDates('2026-12-31', '2026-01-01')).toBeGreaterThan(0);
  });

  it('reports the same day as the same', () => {
    expect(compareCalendarDates('2026-09-04', '2026-09-04')).toBe(0);
  });

  // Comparing as text works only because the format is fixed-width and
  // big-endian; a year that sorted after a later one would show it up here.
  it('orders across a year boundary', () => {
    expect(compareCalendarDates('2026-12-31', '2027-01-01')).toBeLessThan(0);
  });

  it('orders across a month boundary', () => {
    expect(compareCalendarDates('2026-09-30', '2026-10-01')).toBeLessThan(0);
  });
});
