import { describe, expect, it, jest } from '@jest/globals';

import {
  dateToStoStardate,
  formatStardate,
  stoStardateToDate,
} from './stardate.utility';

/**
 * Star Trek Online's stardates (sc-1450): the year turns on 25 May 00:00 UTC,
 * and year 0 began in 1922.
 */
describe('stardate utility', () => {
  describe('dateToStoStardate', () => {
    it('starts a stardate year at 25 May 00:00 UTC', () => {
      expect(dateToStoStardate(new Date('2026-05-25T00:00:00Z'))).toBe(104000);
    });

    it('counts a moment before 25 May in the year that began the May before', () => {
      expect(dateToStoStardate(new Date('2026-05-24T23:59:59Z'))).toBe(104000);
      expect(dateToStoStardate(new Date('2026-01-01T00:00:00Z'))).toBeCloseTo(
        103605.48,
        2,
      );
    });

    it('measures a leap year by its own length', () => {
      // 25 May 2023 to 25 May 2024 holds 29 February, so is 366 days long.
      expect(dateToStoStardate(new Date('2023-11-24T00:00:00Z'))).toBe(101500);
    });

    it('rounds to two decimal places', () => {
      const stardate = dateToStoStardate(new Date('2026-11-24T10:30:00Z'));

      expect(Number(stardate.toFixed(2))).toBe(stardate);
      expect(stardate).toBeGreaterThan(104502);
      expect(stardate).toBeLessThan(104503);
    });

    it('uses the current time when given no date', () => {
      jest.useFakeTimers({ now: new Date('2026-05-25T00:00:00Z') });

      try {
        expect(dateToStoStardate()).toBe(104000);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('stoStardateToDate', () => {
    it('turns the start of a stardate year back into 25 May', () => {
      expect(stoStardateToDate(104000).toISOString()).toBe(
        '2026-05-25T00:00:00.000Z',
      );
    });

    it('turns a fraction of a year back into the moment it names', () => {
      expect(stoStardateToDate(101500).toISOString()).toBe(
        '2023-11-24T00:00:00.000Z',
      );
    });

    it('round-trips with dateToStoStardate to within the rounding', () => {
      const moment = new Date('2026-11-24T10:30:00Z');
      const back = stoStardateToDate(dateToStoStardate(moment));

      // A hundredth of a stardate is about 53 minutes.
      expect(Math.abs(back.getTime() - moment.getTime())).toBeLessThan(
        60 * 60 * 1000,
      );
    });
  });

  describe('formatStardate', () => {
    it('writes one decimal place', () => {
      expect(formatStardate(104496.59)).toBe('104496.6');
      expect(formatStardate(104000)).toBe('104000.0');
    });
  });
});
