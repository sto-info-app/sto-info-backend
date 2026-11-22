import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { NotificationOutboxKind } from 'src/notification/outbox/notification-outbox-kind.enum';
import { NotificationOutboxEntity } from 'src/notification/outbox/notification-outbox.entity';

import { InMemoryManager } from '../../../../test/in-memory-manager';
import { noticeKeyOf, queueNotices } from './event-notices.utility';

const OCCURRENCE = {
  id: 'occurrence-1',
  startsAt: new Date('2030-01-04T20:00:00Z'),
};

describe('event notices', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2029-12-01T12:00:00Z') });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('noticeKeyOf', () => {
    it('keys a cancellation once per person', () => {
      expect(
        noticeKeyOf(
          NotificationOutboxKind.EVENT_CANCELLED,
          OCCURRENCE,
          'user-1',
        ),
      ).toBe('EVENT_CANCELLED:occurrence-1:user-1');
    });

    it('keys a move by where it moves to', () => {
      expect(
        noticeKeyOf(NotificationOutboxKind.EVENT_MOVED, OCCURRENCE, 'user-1'),
      ).toBe('EVENT_MOVED:occurrence-1:user-1:2030-01-04T20:00:00.000Z');
    });

    it('keys a promotion by when it was given', () => {
      expect(
        noticeKeyOf(
          NotificationOutboxKind.EVENT_PROMOTED,
          OCCURRENCE,
          'user-1',
        ),
      ).toBe(
        `EVENT_PROMOTED:occurrence-1:user-1:${Date.parse('2029-12-01T12:00:00Z')}`,
      );
    });

    it('keys a reminder by lead and start, as the delivery job does in SQL', () => {
      expect(
        noticeKeyOf(
          NotificationOutboxKind.EVENT_REMINDER,
          OCCURRENCE,
          'user-1',
          60,
        ),
      ).toBe(
        `EVENT_REMINDER:occurrence-1:user-1:60:${Date.parse('2030-01-04T20:00:00Z') / 1000}`,
      );
    });
  });

  describe('queueNotices', () => {
    it('queues one per person, and not again', async () => {
      const db = new InMemoryManager();

      await queueNotices(
        db.asManager(),
        NotificationOutboxKind.EVENT_CANCELLED,
        OCCURRENCE,
        ['user-1', 'user-1', 'user-2'],
      );
      await queueNotices(
        db.asManager(),
        NotificationOutboxKind.EVENT_CANCELLED,
        OCCURRENCE,
        ['user-2'],
      );

      expect(
        db
          .rows<Record<string, unknown>>(NotificationOutboxEntity)
          .map(row => [row.userId, row.kind, row.subjectId]),
      ).toEqual([
        ['user-1', NotificationOutboxKind.EVENT_CANCELLED, 'occurrence-1'],
        ['user-2', NotificationOutboxKind.EVENT_CANCELLED, 'occurrence-1'],
      ]);
    });

    it('queues nothing for nobody', async () => {
      const db = new InMemoryManager();
      const builder = jest.spyOn(db, 'createQueryBuilder');

      await queueNotices(
        db.asManager(),
        NotificationOutboxKind.EVENT_MOVED,
        OCCURRENCE,
        [],
      );

      expect(builder).not.toHaveBeenCalled();
    });
  });
});
