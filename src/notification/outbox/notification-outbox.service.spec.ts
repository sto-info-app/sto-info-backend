import { InternalServerErrorException, Logger } from '@nestjs/common';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import { CreateNotificationOutbox1795650000000 } from 'src/database/migrations/1795650000000-CreateNotificationOutbox';
import { NotificationCategory } from 'src/user/enums/notification-category.enum';
import { UserPreferenceService } from 'src/user/user-preference.service';

import { InMemoryManager } from '../../../test/in-memory-manager';
import { NotificationSeverity } from '../enums/notification-severity.enum';
import { NotificationTarget } from '../enums/notification-target.enum';
import { NotificationService } from '../notification.service';
import {
  NOTIFICATION_OUTBOX_CATEGORIES,
  NotificationOutboxKind,
} from './notification-outbox-kind.enum';
import { NotificationOutboxEntity } from './notification-outbox.entity';
import {
  NotificationOutboxHandler,
  NotificationOutboxRegistry,
  OutboxMessage,
} from './notification-outbox.registry';
import {
  NotificationOutboxService,
  OUTBOX_ATTEMPTS,
} from './notification-outbox.service';
import { queueOutbox } from './notification-outbox.utility';

const NOW = new Date('2029-12-01T12:00:00Z');

const MESSAGE: OutboxMessage = {
  title: 'Refit night has moved',
  body: 'It now starts at nine.',
  severity: NotificationSeverity.INFO,
  linkUrl: 'https://stoinfo.test/events/1',
};

type Compose = jest.Mock<
  (
    ...args: Parameters<NotificationOutboxHandler['compose']>
  ) => Promise<OutboxMessage | null>
>;

describe('the notification outbox', () => {
  let db: InMemoryManager;
  let registry: NotificationOutboxRegistry;
  let handler: {
    kinds: NotificationOutboxKind[];
    compose: Compose;
    queueDue: jest.Mock<(now: Date) => Promise<void>>;
  };
  let preferences: {
    isCategoryEnabled: jest.Mock<(...args: unknown[]) => Promise<boolean>>;
  };
  let notifications: {
    createNotification: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  };
  let service: NotificationOutboxService;

  const rows = () =>
    db.rows<NotificationOutboxEntity & Record<string, unknown>>(
      NotificationOutboxEntity,
    );

  /**
   * Queues a notice.
   *
   * @param overrides - What differs.
   * @returns The row.
   */
  function waiting(
    overrides: Partial<NotificationOutboxEntity> = {},
  ): NotificationOutboxEntity {
    const row = {
      id: `notice-${rows().length + 1}`,
      userId: 'user-1',
      kind: NotificationOutboxKind.EVENT_MOVED,
      subjectId: 'occurrence-1',
      detail: null,
      dedupeKey: `key-${rows().length + 1}`,
      createdAt: NOW,
      deliveredAt: null,
      skippedAt: null,
      attempts: 0,
      lastError: null,
      ...overrides,
    } as NotificationOutboxEntity;

    db.seed(NotificationOutboxEntity, [
      row as unknown as Record<string, unknown>,
    ]);

    return row;
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    db = new InMemoryManager();
    registry = new NotificationOutboxRegistry();
    handler = {
      kinds: [
        NotificationOutboxKind.EVENT_MOVED,
        NotificationOutboxKind.EVENT_CANCELLED,
      ],
      compose: jest.fn(async () => MESSAGE) as Compose,
      queueDue: jest.fn(async () => undefined),
    };
    registry.register(handler);
    preferences = { isCategoryEnabled: jest.fn(async () => true) };
    notifications = { createNotification: jest.fn(async () => ({})) };
    service = new NotificationOutboxService(
      db.asDataSource(),
      registry,
      preferences as unknown as UserPreferenceService,
      notifications as unknown as NotificationService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('deliver', () => {
    it('lets each handler queue what has come due, then sends each notice once', async () => {
      const notice = waiting();

      await expect(service.deliver()).resolves.toBe(1);
      await expect(service.deliver()).resolves.toBe(0);

      expect(handler.queueDue).toHaveBeenCalledWith(NOW);
      expect(handler.compose).toHaveBeenCalledTimes(1);
      expect(notifications.createNotification).toHaveBeenCalledWith({
        target: NotificationTarget.USER,
        userId: 'user-1',
        title: MESSAGE.title,
        body: MESSAGE.body,
        severity: MESSAGE.severity,
        linkUrl: MESSAGE.linkUrl,
      });
      expect(notice.deliveredAt).toEqual(NOW);
      expect(db.locks).toContain(NotificationOutboxEntity);
    });

    it('sends a notice with no link without one', async () => {
      waiting();
      handler.compose.mockResolvedValue({ ...MESSAGE, linkUrl: null });

      await service.deliver();

      expect(notifications.createNotification).toHaveBeenCalledWith(
        expect.not.objectContaining({ linkUrl: expect.anything() }),
      );
    });

    it('asks the preference the kind answers to, and sets aside one switched off', async () => {
      const notice = waiting();

      preferences.isCategoryEnabled.mockResolvedValue(false);

      await expect(service.deliver()).resolves.toBe(0);

      expect(preferences.isCategoryEnabled).toHaveBeenCalledWith(
        'user-1',
        NotificationCategory.EVENT_REMINDER,
      );
      expect(handler.compose).not.toHaveBeenCalled();
      expect(notice.skippedAt).toEqual(NOW);
    });

    it('sets aside what its handler says is no longer wanted', async () => {
      const notice = waiting();

      handler.compose.mockResolvedValue(null);

      await service.deliver();

      expect(notice.skippedAt).toEqual(NOW);
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    it('tries again after a failure, up to its limit', async () => {
      const notice = waiting();

      notifications.createNotification.mockRejectedValue(
        new TypeError('offline'),
      );

      await service.deliver();

      expect(notice).toEqual(
        expect.objectContaining({
          attempts: 1,
          lastError: 'TypeError',
          deliveredAt: null,
        }),
      );

      notice.attempts = OUTBOX_ATTEMPTS;
      await service.deliver();

      expect(notifications.createNotification).toHaveBeenCalledTimes(1);
    });

    it('fails a notice no handler writes, and tries it again', async () => {
      const notice = waiting({
        kind: NotificationOutboxKind.ROSTER_ASSOCIATION_PROPOSED,
      });

      await service.deliver();

      expect(notice.attempts).toBe(1);
      expect(notice.lastError).toBe('InternalServerErrorException');
    });

    it('sends nothing another run took first', async () => {
      const notice = waiting();
      const find = db.find;

      db.find = (async (...args: Parameters<typeof find>) => {
        const found = await find(...args);

        notice.deliveredAt = NOW;

        return found;
      }) as typeof find;

      await expect(service.deliver()).resolves.toBe(0);
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    it('runs a handler with nothing to queue', async () => {
      registry.register({
        kinds: [NotificationOutboxKind.ROSTER_ASSOCIATION_PROPOSED],
        compose: jest.fn(async () => MESSAGE),
      });

      await expect(service.deliver()).resolves.toBe(0);
      expect(handler.queueDue).toHaveBeenCalledTimes(1);
    });
  });

  describe('the registry', () => {
    it('refuses two handlers for one kind, and a kind with none', () => {
      expect(() =>
        registry.register({
          kinds: [NotificationOutboxKind.EVENT_MOVED],
          compose: jest.fn(async () => null),
        }),
      ).toThrow(InternalServerErrorException);
      expect(() =>
        registry.require(NotificationOutboxKind.EVENT_REMINDER),
      ).toThrow('No outbox handler is registered for EVENT_REMINDER');
      expect(registry.handlers()).toEqual([handler]);
    });
  });

  describe('queueOutbox', () => {
    it('queues each notice once, and nothing for none', async () => {
      const entry = {
        userId: 'user-1',
        kind: NotificationOutboxKind.EVENT_CANCELLED,
        subjectId: 'occurrence-1',
        dedupeKey: 'k',
      };

      await queueOutbox(db.asManager(), [entry, entry]);
      await queueOutbox(db.asManager(), [
        { ...entry, dedupeKey: 'k2', detail: { leadMinutes: 60 } },
      ]);
      await queueOutbox(db.asManager(), []);

      expect(rows().map(row => [row.dedupeKey, row.detail])).toEqual([
        ['k', null],
        ['k2', { leadMinutes: 60 }],
      ]);
    });
  });

  it('files every kind under one of the five categories R16 allows', () => {
    expect(
      Object.values(NotificationOutboxKind).map(
        kind => NOTIFICATION_OUTBOX_CATEGORIES[kind],
      ),
    ).toEqual([
      NotificationCategory.EVENT_REMINDER,
      NotificationCategory.EVENT_REMINDER,
      NotificationCategory.EVENT_REMINDER,
      NotificationCategory.EVENT_REMINDER,
      NotificationCategory.ROSTER_ASSOCIATION,
      NotificationCategory.MENTION,
      NotificationCategory.REPLY,
      NotificationCategory.DIRECT_MESSAGE,
    ]);
  });

  describe('schema', () => {
    it('creates exactly the columns the entity declares, and takes them away', async () => {
      const statements: string[] = [];
      const queryRunner = {
        query: jest.fn(async (sql: string) => {
          statements.push(sql);
        }),
      } as unknown as QueryRunner;
      const migration = new CreateNotificationOutbox1795650000000();

      await migration.up(queryRunner);

      const table = statements.find(sql =>
        sql.includes('CREATE TABLE "sto_info_app"."notification_outbox"'),
      ) as string;
      const columns = table
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('"'))
        .map(line => line.slice(1, line.indexOf('"', 1)));

      expect(columns.sort()).toEqual(
        getMetadataArgsStorage()
          .columns.filter(column => column.target === NotificationOutboxEntity)
          .map(column => column.propertyName)
          .sort(),
      );
      expect(table).toContain(
        'CONSTRAINT "UQ_notification_outbox_dedupe" UNIQUE ("dedupeKey")',
      );

      await migration.down(queryRunner);

      expect(statements.slice(-2)).toEqual([
        'DROP TABLE "sto_info_app"."notification_outbox"',
        'DROP TYPE "sto_info_app"."notification_outbox_kind_enum"',
      ]);
    });
  });
});
