import { UserPreferenceEntity } from 'src/user/entities/user-preference.entity';
import { EmailFrequency } from 'src/user/enums/email-frequency.enum';

import { InMemoryManager, Row } from '../../../test/in-memory-manager';
import { NotificationEmailOutboxEntity } from './notification-email-outbox.entity';
import {
  absoluteLink,
  queueEmails,
  rescheduleEmails,
  withoutTrailingSlashes,
} from './notification-email-outbox.utility';
import { NotificationEmailType } from './notification-email-type.enum';

const NOW = new Date('2026-11-23T10:00:00Z');

describe('notification email outbox (sc-1067)', () => {
  const original = process.env.APP_FRONTEND_URL;
  let db: InMemoryManager;

  const rows = () =>
    db.rows<NotificationEmailOutboxEntity & Row>(NotificationEmailOutboxEntity);

  const preference = (overrides: Partial<UserPreferenceEntity> = {}) =>
    ({
      userId: 'user-1',
      emailNotificationTypes: [
        NotificationEmailType.LOGIN,
        NotificationEmailType.STORYTIME_COMMENT,
        NotificationEmailType.STORYTIME_REACTION,
      ],
      emailFrequency: EmailFrequency.INSTANT,
      displayTimezone: null,
      ...overrides,
    }) as UserPreferenceEntity & Row;

  beforeEach(() => {
    process.env.APP_FRONTEND_URL = 'https://sto.test';
    db = new InMemoryManager();
  });

  afterEach(() => {
    process.env.APP_FRONTEND_URL = original;
  });

  describe('withoutTrailingSlashes', () => {
    it.each([
      ['https://sto.test///', 'https://sto.test'],
      ['https://sto.test', 'https://sto.test'],
      ['', ''],
      [undefined, ''],
    ])('makes %p %p', (address, expected) => {
      expect(withoutTrailingSlashes(address)).toBe(expected);
    });
  });

  describe('absoluteLink', () => {
    it('puts the frontend in front of a path', () => {
      expect(absoluteLink('/chat/transcripts')).toBe(
        'https://sto.test/chat/transcripts',
      );
    });

    it('keeps an address on the frontend', () => {
      expect(absoluteLink('https://sto.test/fleets/x')).toBe(
        'https://sto.test/fleets/x',
      );
      expect(absoluteLink('https://sto.test')).toBe('https://sto.test');
    });

    it.each([
      ['an address elsewhere', 'https://elsewhere.test/x'],
      ['a protocol-relative address', '//elsewhere.test/x'],
      ['a lookalike host', 'https://sto.test.evil/x'],
      ['nothing', null],
      ['an empty link', ''],
    ])('drops %s', (_name, link) => {
      expect(absoluteLink(link)).toBeNull();
    });

    it('drops everything without a frontend address', () => {
      process.env.APP_FRONTEND_URL = '';

      expect(absoluteLink('/x')).toBeNull();
    });
  });

  describe('queueEmails', () => {
    it('queues an email the person opted in to, due now', async () => {
      db.seed(UserPreferenceEntity, [preference()]);

      await expect(
        queueEmails(
          db.asManager(),
          [
            {
              userId: 'user-1',
              type: NotificationEmailType.STORYTIME_COMMENT,
              title: 'New comment on your work',
              body: 'Someone commented.',
              linkUrl: '/storytime/stories/x',
            },
          ],
          NOW,
        ),
      ).resolves.toBe(1);

      expect(rows()).toEqual([
        expect.objectContaining({
          userId: 'user-1',
          type: NotificationEmailType.STORYTIME_COMMENT,
          title: 'New comment on your work',
          body: 'Someone commented.',
          linkUrl: 'https://sto.test/storytime/stories/x',
          dueAt: NOW,
        }),
      ]);
    });

    it('queues nothing for a type left off', async () => {
      db.seed(UserPreferenceEntity, [preference()]);

      await expect(
        queueEmails(
          db.asManager(),
          [
            {
              userId: 'user-1',
              type: NotificationEmailType.FRIEND_REQUEST,
              title: 'New friend request',
              body: 'x',
            },
          ],
          NOW,
        ),
      ).resolves.toBe(0);
      expect(rows()).toHaveLength(0);
    });

    // Somebody with no row has only the login alert, which is never queued.
    it('queues nothing for somebody on the defaults', async () => {
      await expect(
        queueEmails(
          db.asManager(),
          [
            {
              userId: 'user-2',
              type: NotificationEmailType.STORYTIME_COMMENT,
              title: 't',
              body: 'b',
            },
            {
              userId: 'user-2',
              type: NotificationEmailType.LOGIN,
              title: 't',
              body: 'b',
            },
          ],
          NOW,
        ),
      ).resolves.toBe(0);
    });

    it('never queues a login alert, which is sent as it happens', async () => {
      db.seed(UserPreferenceEntity, [preference()]);

      await expect(
        queueEmails(
          db.asManager(),
          [
            {
              userId: 'user-1',
              type: NotificationEmailType.LOGIN,
              title: 't',
              body: 'b',
            },
          ],
          NOW,
        ),
      ).resolves.toBe(0);
    });

    it('cuts a long title to what the outbox holds', async () => {
      db.seed(UserPreferenceEntity, [preference()]);

      await queueEmails(
        db.asManager(),
        [
          {
            userId: 'user-1',
            type: NotificationEmailType.STORYTIME_COMMENT,
            title: 'x'.repeat(250),
            body: 'b',
          },
        ],
        NOW,
      );

      expect(rows()[0].title).toHaveLength(200);
      expect(rows()[0].linkUrl).toBeNull();
    });

    it('holds a throttled type behind the last one sent', async () => {
      db.seed(UserPreferenceEntity, [preference()]);
      db.seed(NotificationEmailOutboxEntity, [
        {
          id: 'sent-1',
          userId: 'user-1',
          type: NotificationEmailType.STORYTIME_REACTION,
          sentAt: new Date('2026-11-23T09:30:00Z'),
        },
      ]);

      await queueEmails(
        db.asManager(),
        [
          {
            userId: 'user-1',
            type: NotificationEmailType.STORYTIME_REACTION,
            title: 'New reaction to your work',
            body: 'b',
          },
        ],
        NOW,
      );

      expect(rows()[1].dueAt).toEqual(new Date('2026-11-23T10:30:00Z'));
    });

    it('waits for the digest when the person wants one', async () => {
      db.seed(UserPreferenceEntity, [
        preference({ emailFrequency: EmailFrequency.DAILY }),
      ]);

      await queueEmails(
        db.asManager(),
        [
          {
            userId: 'user-1',
            type: NotificationEmailType.STORYTIME_COMMENT,
            title: 't',
            body: 'b',
          },
        ],
        NOW,
      );

      expect(rows()[0].dueAt).toEqual(new Date('2026-11-24T08:00:00Z'));
    });

    it('defaults to now', async () => {
      db.seed(UserPreferenceEntity, [preference()]);

      await queueEmails(db.asManager(), [
        {
          userId: 'user-1',
          type: NotificationEmailType.STORYTIME_COMMENT,
          title: 't',
          body: 'b',
        },
      ]);

      expect(rows()[0].dueAt).toBeInstanceOf(Date);
    });
  });

  describe('rescheduleEmails', () => {
    it('moves waiting emails to the schedule now chosen, and only those', async () => {
      db.seed(NotificationEmailOutboxEntity, [
        {
          id: 'waiting-1',
          userId: 'user-1',
          type: NotificationEmailType.STORYTIME_COMMENT,
          dueAt: NOW,
          sentAt: null,
          skippedAt: null,
        },
        {
          id: 'waiting-2',
          userId: 'user-1',
          type: NotificationEmailType.STORYTIME_COMMENT,
          dueAt: NOW,
          sentAt: null,
          skippedAt: null,
        },
        {
          id: 'sent-1',
          userId: 'user-1',
          type: NotificationEmailType.STORYTIME_COMMENT,
          dueAt: NOW,
          sentAt: NOW,
          skippedAt: null,
        },
      ]);

      await rescheduleEmails(
        db.asManager(),
        preference({ emailFrequency: EmailFrequency.WEEKLY }),
        NOW,
      );

      const byId = new Map(rows().map(row => [row.id, row]));

      expect(byId.get('waiting-1')?.dueAt).toEqual(
        new Date('2026-11-30T08:00:00Z'),
      );
      expect(byId.get('waiting-2')?.dueAt).toEqual(
        new Date('2026-11-30T08:00:00Z'),
      );
      expect(byId.get('sent-1')?.dueAt).toEqual(NOW);
    });

    it('brings a digest’s emails forward when instant is chosen', async () => {
      db.seed(NotificationEmailOutboxEntity, [
        {
          id: 'waiting-1',
          userId: 'user-1',
          type: NotificationEmailType.STORYTIME_COMMENT,
          dueAt: new Date('2026-11-30T08:00:00Z'),
          sentAt: null,
          skippedAt: null,
        },
      ]);

      await rescheduleEmails(db.asManager(), preference(), NOW);

      expect(rows()[0].dueAt).toEqual(NOW);
    });
  });
});
