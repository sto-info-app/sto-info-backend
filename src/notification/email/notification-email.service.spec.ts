import { Logger } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { MailService } from 'src/mail/mail.service';
import { UserPreferenceEntity } from 'src/user/entities/user-preference.entity';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';
import { UserEntity } from 'src/user/entities/user.entity';
import { EmailFrequency } from 'src/user/enums/email-frequency.enum';

import { EmailUnsubscribeTokenService } from './email-unsubscribe-token.service';
import { NotificationEmailOutboxEntity } from './notification-email-outbox.entity';
import { NotificationEmailType } from './notification-email-type.enum';
import {
  EMAIL_ATTEMPTS,
  NotificationEmailService,
} from './notification-email.service';

type AnyMock = jest.Mock<any>;

const NOW = new Date('2026-11-23T10:00:00Z');

describe('NotificationEmailService (sc-1067)', () => {
  const env = { ...process.env };
  let outbox: Partial<NotificationEmailOutboxEntity>[];
  let user: Partial<UserEntity> | null;
  let profile: Partial<UserProfileEntity> | null;
  let preference: Partial<UserPreferenceEntity> | null;
  let manager: Record<string, AnyMock>;
  let attemptsUpdate: { set: AnyMock; whereInIds: AnyMock; execute: AnyMock };
  let due: AnyMock;
  let purge: { where: AnyMock; andWhere: AnyMock; execute: AnyMock };
  let mail: Record<string, AnyMock>;
  let tokens: { sign: AnyMock };
  let service: NotificationEmailService;

  const row = (
    overrides: Partial<NotificationEmailOutboxEntity> = {},
  ): Partial<NotificationEmailOutboxEntity> => ({
    id: `email-${outbox.length + 1}`,
    userId: 'user-1',
    type: NotificationEmailType.STORYTIME_COMMENT,
    title: 'New comment on your work',
    body: 'Someone commented on your Story "The Long Watch".',
    linkUrl: 'https://sto.test/storytime/stories/the-long-watch',
    ...overrides,
  });

  const queued = (...rows: Partial<NotificationEmailOutboxEntity>[]) => {
    outbox.push(...rows);
    due.mockResolvedValue([{ userId: 'user-1' }]);
  };

  const updates = () =>
    manager.update.mock.calls.map(([, where, values]) => ({
      ids: (where as { id: { value: string[] } }).id.value,
      values,
    }));

  beforeEach(() => {
    process.env.APP_TITLE = 'STO Info';
    process.env.APP_FRONTEND_URL = 'https://sto.test';
    process.env.APP_API_URL = 'https://api.sto.test/';
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    outbox = [];
    user = {
      id: 'user-1',
      email: 'kirk@sto.test',
      emailVerified: true,
      isAccountDisabled: false,
    };
    profile = { userId: 'user-1', firstName: 'James' };
    preference = {
      userId: 'user-1',
      emailNotificationTypes: [
        NotificationEmailType.LOGIN,
        NotificationEmailType.STORYTIME_COMMENT,
        NotificationEmailType.FRIEND_REQUEST,
      ],
      emailFrequency: EmailFrequency.INSTANT,
    };
    attemptsUpdate = {
      set: jest.fn(() => attemptsUpdate),
      whereInIds: jest.fn(() => attemptsUpdate),
      execute: jest.fn(async () => ({})),
    };
    manager = {
      find: jest.fn(async () => outbox),
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === UserEntity) return user;
        if (entity === UserProfileEntity) return profile;
        if (entity === UserPreferenceEntity) return preference;

        return null;
      }),
      update: jest.fn(async () => ({})),
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn(() => attemptsUpdate),
      })),
    };
    due = jest.fn(async () => []);
    purge = {
      where: jest.fn(() => purge),
      andWhere: jest.fn(() => purge),
      execute: jest.fn(async () => ({ affected: 3 })),
    };

    const dueQuery: Record<string, AnyMock> = {};

    for (const step of [
      'select',
      'where',
      'andWhere',
      'groupBy',
      'orderBy',
      'limit',
    ]) {
      dueQuery[step] = jest.fn(() => dueQuery);
    }

    dueQuery.getRawMany = due;

    const dataSource = {
      manager: {
        createQueryBuilder: jest.fn((entity?: unknown) =>
          entity === NotificationEmailOutboxEntity
            ? dueQuery
            : { delete: () => ({ from: () => purge }) },
        ),
      },
      transaction: jest.fn((work: (m: unknown) => Promise<unknown>) =>
        work(manager),
      ),
    };

    mail = {
      renderEmail: jest.fn(async () => ({ html: '<p>x</p>', text: 'x' })),
      generateEmailMessageObject: jest.fn(
        (to: string, subject: string, text: string, html: string) => ({
          to,
          subject,
          text,
          html,
        }),
      ),
      sendEmail: jest.fn(async () => undefined),
      isSuppressed: jest.fn(async () => false),
    };
    tokens = {
      sign: jest.fn(
        ({ types }: { types: string[] }) => `token-${types.join('+')}`,
      ),
    };
    service = new NotificationEmailService(
      dataSource as unknown as DataSource,
      mail as unknown as MailService,
      tokens as unknown as EmailUnsubscribeTokenService,
    );
  });

  afterEach(() => {
    process.env = { ...env };
    jest.restoreAllMocks();
  });

  describe('deliver', () => {
    it('does nothing when nothing is due', async () => {
      await expect(service.deliver(NOW)).resolves.toBe(0);
      expect(mail.sendEmail).not.toHaveBeenCalled();
      expect(Logger.prototype.log).not.toHaveBeenCalled();
    });

    it('sends one email with the notice’s own words, and marks it sent', async () => {
      queued(row());

      await expect(service.deliver(NOW)).resolves.toBe(1);

      expect(mail.renderEmail).toHaveBeenCalledWith(
        'notification-email.ejs',
        {
          firstName: 'James',
          digest: null,
          items: [
            {
              title: 'New comment on your work',
              body: 'Someone commented on your Story "The Long Watch".',
              linkUrl: 'https://sto.test/storytime/stories/the-long-watch',
            },
          ],
        },
        'New comment on your work',
        {
          template: 'notification-email-footer.ejs',
          data: {
            labels: ['Comments on my work'],
            unsubscribeLinks: [
              {
                label: 'comments on my work',
                url: 'https://sto.test/email/unsubscribe?token=token-STORYTIME_COMMENT',
              },
            ],
            settingsUrl:
              'https://sto.test/dashboard/settings?tab=notifications',
          },
        },
      );
      expect(mail.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'kirk@sto.test',
          subject: 'New comment on your work',
          headers: {
            'List-Unsubscribe':
              '<https://api.sto.test/email-preferences/unsubscribe?token=token-STORYTIME_COMMENT>',
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }),
        { rethrow: true },
      );
      expect(updates()).toEqual([
        { ids: ['email-1'], values: { sentAt: NOW } },
      ]);
      expect(Logger.prototype.log).toHaveBeenCalled();
    });

    it('rolls everything due into one email, with a link for each type', async () => {
      queued(
        row(),
        row({ id: 'email-2', type: NotificationEmailType.FRIEND_REQUEST }),
        row({ id: 'email-3' }),
      );

      await service.deliver(NOW);

      expect(mail.sendEmail).toHaveBeenCalledTimes(1);
      expect(mail.generateEmailMessageObject).toHaveBeenCalledWith(
        'kirk@sto.test',
        '3 new notifications from the STO Info',
        'x',
        '<p>x</p>',
      );
      expect(mail.sendEmail.mock.calls[0][0].headers['List-Unsubscribe']).toBe(
        '<https://api.sto.test/email-preferences/unsubscribe?token=token-STORYTIME_COMMENT+FRIEND_REQUEST>',
      );
    });

    it.each([
      [EmailFrequency.DAILY, 'daily'],
      [EmailFrequency.WEEKLY, 'weekly'],
    ])('names a %s digest', async (frequency, name) => {
      preference = { ...preference, emailFrequency: frequency };
      queued(row());

      await service.deliver(NOW);

      expect(mail.renderEmail.mock.calls[0][1]).toEqual(
        expect.objectContaining({ digest: name }),
      );
      expect(mail.renderEmail.mock.calls[0][2]).toBe(
        `Your ${name} digest from the STO Info`,
      );
    });

    it('sets aside what was switched off since it was queued', async () => {
      queued(
        row(),
        row({ id: 'email-2', type: NotificationEmailType.STORYTIME_REACTION }),
      );

      await service.deliver(NOW);

      expect(updates()).toEqual([
        {
          ids: ['email-2'],
          values: { skippedAt: NOW, lastError: 'OPTED_OUT' },
        },
        { ids: ['email-1'], values: { sentAt: NOW } },
      ]);
    });

    it('sends nothing when every type was switched off', async () => {
      preference = { ...preference, emailNotificationTypes: [] };
      queued(row());

      await expect(service.deliver(NOW)).resolves.toBe(0);
      expect(mail.sendEmail).not.toHaveBeenCalled();
    });

    // Somebody with no preference row has the defaults: the login alert only.
    it('treats somebody with no preferences as opted out', async () => {
      preference = null;
      queued(row());

      await service.deliver(NOW);

      expect(mail.sendEmail).not.toHaveBeenCalled();
      expect(updates()[0].values).toEqual({
        skippedAt: NOW,
        lastError: 'OPTED_OUT',
      });
    });

    it.each([
      ['NO_ACCOUNT', () => (user = null)],
      ['ACCOUNT_DISABLED', () => (user = { ...user, isAccountDisabled: true })],
      ['EMAIL_UNVERIFIED', () => (user = { ...user, emailVerified: false })],
      ['SUPPRESSED', () => mail.isSuppressed.mockResolvedValue(true)],
    ])('sets everything aside as %s', async (reason, arrange) => {
      arrange();
      queued(row(), row({ id: 'email-2' }));

      await expect(service.deliver(NOW)).resolves.toBe(0);
      expect(mail.sendEmail).not.toHaveBeenCalled();
      expect(updates()).toEqual([
        {
          ids: ['email-1', 'email-2'],
          values: { skippedAt: NOW, lastError: reason },
        },
      ]);
    });

    it('greets somebody without a first name as Captain', async () => {
      profile = null;
      queued(row());

      await service.deliver(NOW);

      expect(mail.renderEmail.mock.calls[0][1].firstName).toBe('Captain');
    });

    it('leaves the one-click headers out without an API address', async () => {
      delete process.env.APP_API_URL;
      queued(row());

      await service.deliver(NOW);

      expect(mail.sendEmail.mock.calls[0][0]).not.toHaveProperty('headers');
    });

    it('leaves the links out when they cannot be signed', async () => {
      tokens.sign.mockReturnValue(null);
      queued(row());

      await service.deliver(NOW);

      expect(mail.renderEmail.mock.calls[0][3].data.unsubscribeLinks).toEqual(
        [],
      );
      expect(mail.sendEmail.mock.calls[0][0]).not.toHaveProperty('headers');
    });

    it('counts a failed send against each email, to be tried again', async () => {
      mail.sendEmail.mockRejectedValue(new TypeError('SES is down'));
      queued(row(), row({ id: 'email-2' }));

      await expect(service.deliver(NOW)).resolves.toBe(0);

      expect(attemptsUpdate.set).toHaveBeenCalledWith({
        attempts: expect.any(Function),
        lastError: 'TypeError',
      });
      expect(attemptsUpdate.set.mock.calls[0][0].attempts()).toBe(
        '"attempts" + 1',
      );
      expect(attemptsUpdate.whereInIds).toHaveBeenCalledWith([
        'email-1',
        'email-2',
      ]);
      expect(manager.update).not.toHaveBeenCalled();
      expect(Logger.prototype.warn).toHaveBeenCalled();
    });

    // Another run holding them has them; this one moves on.
    it('skips somebody whose emails another run holds', async () => {
      due.mockResolvedValue([{ userId: 'user-1' }]);

      await expect(service.deliver(NOW)).resolves.toBe(0);
      expect(manager.find).toHaveBeenCalledWith(
        NotificationEmailOutboxEntity,
        expect.objectContaining({
          lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' },
        }),
      );
    });

    it('defaults to now', async () => {
      await expect(service.deliver()).resolves.toBe(0);
    });
  });

  describe('purge', () => {
    it('deletes what is finished and 30 days old', async () => {
      await expect(service.purge(NOW)).resolves.toBe(3);
      expect(purge.where).toHaveBeenCalledWith('"createdAt" < :before', {
        before: new Date('2026-10-24T10:00:00Z'),
      });
      expect(purge.andWhere).toHaveBeenCalledWith(expect.any(String), {
        attempts: EMAIL_ATTEMPTS,
      });
    });

    it('reports none when the database says nothing', async () => {
      purge.execute.mockResolvedValue({});

      await expect(service.purge()).resolves.toBe(0);
    });
  });
});
