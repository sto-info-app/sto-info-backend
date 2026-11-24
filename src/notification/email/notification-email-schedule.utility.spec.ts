import { EmailFrequency } from 'src/user/enums/email-frequency.enum';

import {
  emailDueAt,
  nextDigestAt,
  THROTTLE_MS,
} from './notification-email-schedule.utility';
import { NotificationEmailType } from './notification-email-type.enum';

describe('notification email schedule (sc-1067)', () => {
  describe('nextDigestAt', () => {
    it('is 08:00 UTC the same day when that is still to come', () => {
      expect(
        nextDigestAt(new Date('2026-11-23T06:00:00Z'), null, false),
      ).toEqual(new Date('2026-11-23T08:00:00Z'));
    });

    it('is 08:00 the next day once today’s has gone', () => {
      expect(
        nextDigestAt(new Date('2026-11-23T08:00:00Z'), 'UTC', false),
      ).toEqual(new Date('2026-11-24T08:00:00Z'));
    });

    it('is 08:00 by the clock in the person’s zone', () => {
      // New York is five hours behind in November.
      expect(
        nextDigestAt(
          new Date('2026-11-23T12:00:00Z'),
          'America/New_York',
          false,
        ),
      ).toEqual(new Date('2026-11-23T13:00:00Z'));
    });

    it('takes the local date, not the UTC one', () => {
      // 23:30 UTC on the 23rd is already the 24th in Tokyo, past 08:00.
      expect(
        nextDigestAt(new Date('2026-11-23T23:30:00Z'), 'Asia/Tokyo', false),
      ).toEqual(new Date('2026-11-24T23:00:00Z'));
    });

    it('stays at 08:00 on the wall across a clock change', () => {
      // London's clocks went forward at 01:00 UTC on 29 March 2026.
      expect(
        nextDigestAt(new Date('2026-03-28T09:00:00Z'), 'Europe/London', false),
      ).toEqual(new Date('2026-03-29T07:00:00Z'));
    });

    it('waits for a Monday when weekly', () => {
      // 25 November 2026 is a Wednesday.
      expect(
        nextDigestAt(new Date('2026-11-25T10:00:00Z'), null, true),
      ).toEqual(new Date('2026-11-30T08:00:00Z'));
    });

    it('waits a week after Monday’s has gone', () => {
      expect(
        nextDigestAt(new Date('2026-11-23T09:00:00Z'), null, true),
      ).toEqual(new Date('2026-11-30T08:00:00Z'));
    });

    it('is today when it is Monday before 08:00', () => {
      expect(
        nextDigestAt(new Date('2026-11-23T07:59:00Z'), null, true),
      ).toEqual(new Date('2026-11-23T08:00:00Z'));
    });
  });

  describe('emailDueAt', () => {
    const now = new Date('2026-11-23T10:00:00Z');

    it('is now for an instant email', () => {
      expect(
        emailDueAt(
          NotificationEmailType.STORYTIME_COMMENT,
          EmailFrequency.INSTANT,
          null,
          now,
          new Date('2026-11-23T09:59:00Z'),
        ),
      ).toEqual(now);
    });

    it('holds a throttled type an hour after the last of its kind', () => {
      const last = new Date('2026-11-23T09:30:00Z');

      expect(
        emailDueAt(
          NotificationEmailType.STORYTIME_REACTION,
          EmailFrequency.INSTANT,
          null,
          now,
          last,
        ),
      ).toEqual(new Date(last.getTime() + THROTTLE_MS));
    });

    it('sends a throttled type now when the hour has passed', () => {
      expect(
        emailDueAt(
          NotificationEmailType.STORYTIME_FOLLOWER,
          EmailFrequency.INSTANT,
          null,
          now,
          new Date('2026-11-23T08:00:00Z'),
        ),
      ).toEqual(now);
    });

    it('sends a throttled type now when none was sent before', () => {
      expect(
        emailDueAt(
          NotificationEmailType.STORYTIME_REACTION,
          EmailFrequency.INSTANT,
          null,
          now,
          null,
        ),
      ).toEqual(now);
    });

    it.each([
      [EmailFrequency.DAILY, new Date('2026-11-24T08:00:00Z')],
      [EmailFrequency.WEEKLY, new Date('2026-11-30T08:00:00Z')],
    ])('waits for the %s digest', (frequency, expected) => {
      expect(
        emailDueAt(
          NotificationEmailType.FRIEND_REQUEST,
          frequency,
          'Europe/London',
          now,
          null,
        ),
      ).toEqual(expected);
    });
  });
});
