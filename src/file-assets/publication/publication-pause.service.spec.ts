import { ConflictException, Logger } from '@nestjs/common';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Queue } from 'bullmq';
import { DataSource, EntityManager } from 'typeorm';

import { SiteAdminActionEntity } from 'src/audit/site-admin/site-admin-action.entity';
import { SiteAdminActionKind } from 'src/audit/site-admin/site-admin-action.enum';
import { SettingsService } from 'src/settings/settings.service';
import { REDIS_TIMEOUT_MS } from 'src/shared/queue/redis-within.utility';

import { FILE_PUBLICATION_PAUSED_SETTING_KEY } from '../constants/file-asset-publication.constants';
import { PublicationPauseService } from './publication-pause.service';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const PAUSED = JSON.stringify({
  paused: true,
  pausedAt: '2026-09-30T10:30:00.000Z',
  pausedByUserId: ADMIN_ID,
});
const RUNNING = '{"paused":false}';

describe('PublicationPauseService', () => {
  let stored: string | null;
  let getString: jest.Mock<
    (key: string, fresh?: boolean) => Promise<string | null>
  >;
  let setValue: jest.Mock<
    (
      key: string,
      value: string,
      userId: string,
      manager?: EntityManager,
    ) => Promise<void>
  >;
  let insert: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let find: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let manager: EntityManager;
  let isPaused: jest.Mock<() => Promise<boolean>>;
  let pause: jest.Mock<() => Promise<void>>;
  let resume: jest.Mock<() => Promise<void>>;
  let getJobCounts: jest.Mock<
    (...types: string[]) => Promise<Record<string, number>>
  >;
  let warn: jest.SpiedFunction<Logger['warn']>;
  let service: PublicationPauseService;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

    stored = RUNNING;
    getString = jest.fn(() => Promise.resolve(stored));
    setValue = jest.fn((_key: string, value: string) => {
      stored = value;

      return Promise.resolve();
    });
    insert = jest.fn(() => Promise.resolve(undefined));
    find = jest.fn(() =>
      Promise.resolve([{ userId: ADMIN_ID, username: 'Steve' }]),
    );
    manager = { insert, find } as unknown as EntityManager;
    isPaused = jest.fn(() => Promise.resolve(false));
    pause = jest.fn(() => Promise.resolve());
    resume = jest.fn(() => Promise.resolve());
    getJobCounts = jest.fn(() =>
      Promise.resolve({ waiting: 2, prioritized: 1, delayed: 3 }),
    );

    service = new PublicationPauseService(
      {
        manager: { find: (...args: unknown[]) => find(...args) },
        transaction: (work: (manager: EntityManager) => Promise<unknown>) =>
          work(manager),
      } as unknown as DataSource,
      { getString, setValue } as unknown as SettingsService,
      { isPaused, pause, resume, getJobCounts } as unknown as Queue,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    warn.mockRestore();
    jest.restoreAllMocks();
  });

  describe('state', () => {
    it('reads a running switch', async () => {
      await expect(service.state()).resolves.toEqual({
        paused: false,
        pausedAt: null,
        pausedByUserId: null,
        resumedAt: null,
      });
      expect(getString).toHaveBeenCalledWith(
        FILE_PUBLICATION_PAUSED_SETTING_KEY,
        false,
      );
    });

    it('reads a paused switch, with when and by whom', async () => {
      stored = PAUSED;

      await expect(service.state(true)).resolves.toEqual({
        paused: true,
        pausedAt: new Date('2026-09-30T10:30:00.000Z'),
        pausedByUserId: ADMIN_ID,
        resumedAt: null,
      });
      expect(getString).toHaveBeenCalledWith(
        FILE_PUBLICATION_PAUSED_SETTING_KEY,
        true,
      );
    });

    it('counts a missing switch as running', async () => {
      stored = null;

      await expect(service.isPaused()).resolves.toBe(false);
    });

    // Only this service writes it, so an unreadable value is a fault, and
    // publishing through a fault is the wrong way to fail.
    it.each([
      ['text that is not JSON', 'yes please'],
      ['a value that is not an object', '"paused"'],
      ['an object without the flag', '{}'],
    ])('counts %s as paused', async (_name, value) => {
      stored = value;

      await expect(service.state()).resolves.toEqual({
        paused: true,
        pausedAt: null,
        pausedByUserId: null,
        resumedAt: null,
      });
      expect(warn).toHaveBeenCalledWith(
        '[state] Unreadable publication switch; treated as paused',
      );
    });

    it('ignores a pause time or site admin it cannot read', async () => {
      stored = JSON.stringify({
        paused: true,
        pausedAt: 'not a date',
        pausedByUserId: 42,
      });

      await expect(service.state()).resolves.toEqual({
        paused: true,
        pausedAt: null,
        pausedByUserId: null,
        resumedAt: null,
      });
      expect(warn).not.toHaveBeenCalled();
    });

    // The stale-upload sweep counts its day from the last resume.
    it('reads when a running switch was last resumed', async () => {
      stored = '{"paused":false,"resumedAt":"2026-09-30T11:00:00.000Z"}';

      await expect(service.state()).resolves.toEqual({
        paused: false,
        pausedAt: null,
        pausedByUserId: null,
        resumedAt: new Date('2026-09-30T11:00:00.000Z'),
      });
    });
  });

  describe('read', () => {
    it('shows the switch, the queue and what it holds', async () => {
      stored = PAUSED;
      isPaused.mockResolvedValue(true);

      await expect(service.read()).resolves.toEqual({
        paused: true,
        pausedAt: new Date('2026-09-30T10:30:00.000Z'),
        pausedByUserId: ADMIN_ID,
        pausedByUsername: 'Steve',
        queuePaused: true,
        held: 6,
      });
      expect(getJobCounts).toHaveBeenCalledWith(
        'waiting',
        'prioritized',
        'delayed',
      );
    });

    it('names nobody for an account since gone', async () => {
      stored = PAUSED;
      find.mockResolvedValue([]);

      await expect(service.read()).resolves.toEqual(
        expect.objectContaining({
          pausedByUserId: ADMIN_ID,
          pausedByUsername: null,
        }),
      );
    });

    it('treats a state the queue did not report as none', async () => {
      getJobCounts.mockResolvedValue({});

      await expect(service.read()).resolves.toEqual(
        expect.objectContaining({ held: 0 }),
      );
    });

    it('shows the switch alone when Redis cannot be reached', async () => {
      isPaused.mockRejectedValue(new Error('redis.internal:6379 refused'));

      await expect(service.read()).resolves.toEqual({
        paused: false,
        pausedAt: null,
        pausedByUserId: null,
        pausedByUsername: null,
        queuePaused: null,
        held: null,
      });
      expect(warn).toHaveBeenCalledWith(
        '[read] Source unavailable - Error: Error',
      );
    });
  });

  // FC-042: the page a site admin is sent to in a Redis outage must not
  // wait for Redis, and the switch in the database does not need it.
  describe('while Redis does not answer', () => {
    /**
     * Runs something against a silent Redis, moving the clock past the limit.
     *
     * @param run - What to run.
     * @returns What it resolved to.
     */
    const pastTheLimit = async <T>(run: () => Promise<T>): Promise<T> => {
      const running = run();

      await jest.advanceTimersByTimeAsync(REDIS_TIMEOUT_MS * 3);

      return running;
    };

    beforeEach(() => {
      isPaused.mockImplementation(() => new Promise<boolean>(() => {}));
    });

    it('shows the switch, and nothing of the queue', async () => {
      stored = PAUSED;

      await expect(pastTheLimit(() => service.read())).resolves.toEqual(
        expect.objectContaining({
          paused: true,
          queuePaused: null,
          held: null,
        }),
      );
      expect(warn).toHaveBeenCalledWith(
        '[read] Source unavailable - Error: RedisTimeoutError',
      );
    });

    it('still pauses: the switch is written, and the queue follows when Redis answers', async () => {
      const result = await pastTheLimit(() =>
        service.pause(ADMIN_ID, 'Redis is down and so is Cloudflare'),
      );

      expect(setValue).toHaveBeenCalled();
      expect(insert).toHaveBeenCalledWith(
        SiteAdminActionEntity,
        expect.objectContaining({
          action: SiteAdminActionKind.PUBLICATION_PAUSED,
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          paused: true,
          queuePaused: null,
          held: null,
        }),
      );
      // Redis is waited for once, not again for the page's answer.
      expect(isPaused).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        '[apply] Source unavailable - Error: RedisTimeoutError',
      );
    });

    it('does not act on a late answer once it has given up', async () => {
      let answer: (paused: boolean) => void = () => {};

      isPaused.mockImplementation(
        () =>
          new Promise<boolean>(resolve => {
            answer = resolve;
          }),
      );

      await pastTheLimit(() => service.pause(ADMIN_ID, 'Down'));

      answer(false);
      await jest.advanceTimersByTimeAsync(0);

      expect(pause).not.toHaveBeenCalled();
    });

    it('still resumes, and says what the switch says when brought into line', async () => {
      stored = PAUSED;

      await expect(
        pastTheLimit(() => service.resume(ADMIN_ID, 'Over')),
      ).resolves.toEqual(
        expect.objectContaining({ paused: false, queuePaused: null }),
      );
      await expect(pastTheLimit(() => service.apply('alerts'))).resolves.toBe(
        false,
      );
    });
  });

  describe('pause', () => {
    it('writes the switch and its log entry together, then pauses the queue', async () => {
      const result = await service.pause(ADMIN_ID, 'Cloudflare incident');

      expect(setValue).toHaveBeenCalledWith(
        FILE_PUBLICATION_PAUSED_SETTING_KEY,
        JSON.stringify({
          paused: true,
          pausedAt: NOW.toISOString(),
          pausedByUserId: ADMIN_ID,
        }),
        ADMIN_ID,
        manager,
      );
      expect(insert).toHaveBeenCalledWith(
        SiteAdminActionEntity,
        expect.objectContaining({
          action: SiteAdminActionKind.PUBLICATION_PAUSED,
          actorUserId: ADMIN_ID,
          reason: 'Cloudflare incident',
          detail: null,
        }),
      );
      expect(pause).toHaveBeenCalledTimes(1);
      expect(result).toEqual(
        expect.objectContaining({ paused: true, pausedAt: NOW }),
      );
    });

    it('refuses when it is already paused', async () => {
      stored = PAUSED;

      await expect(service.pause(ADMIN_ID, 'Again')).rejects.toThrow(
        new ConflictException('Publication is already paused.'),
      );
      expect(setValue).not.toHaveBeenCalled();
    });
  });

  describe('resume', () => {
    it('writes the switch and its log entry together, then resumes the queue', async () => {
      stored = PAUSED;
      isPaused.mockResolvedValue(true);

      const result = await service.resume(ADMIN_ID, 'Incident over');

      expect(setValue).toHaveBeenCalledWith(
        FILE_PUBLICATION_PAUSED_SETTING_KEY,
        JSON.stringify({ paused: false, resumedAt: NOW.toISOString() }),
        ADMIN_ID,
        manager,
      );
      expect(insert).toHaveBeenCalledWith(
        SiteAdminActionEntity,
        expect.objectContaining({
          action: SiteAdminActionKind.PUBLICATION_RESUMED,
          reason: 'Incident over',
          detail: { pausedMinutes: 90 },
        }),
      );
      expect(resume).toHaveBeenCalledTimes(1);
      expect(result.paused).toBe(false);
    });

    it('logs no pause length when it cannot tell when it began', async () => {
      stored = '{"paused":true}';

      await service.resume(ADMIN_ID, 'Incident over');

      expect(insert).toHaveBeenCalledWith(
        SiteAdminActionEntity,
        expect.objectContaining({ detail: null }),
      );
    });

    it('refuses when it is not paused', async () => {
      await expect(service.resume(ADMIN_ID, 'Why')).rejects.toThrow(
        new ConflictException('Publication is not paused.'),
      );
      expect(setValue).not.toHaveBeenCalled();
    });
  });

  // Redis can be lost; the database is the authority.
  describe('apply', () => {
    it('pauses a running queue when the switch says paused', async () => {
      stored = PAUSED;

      await expect(service.apply('alerts')).resolves.toBe(true);
      expect(pause).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        '[apply] Publication queue paused to match the switch - Trigger: alerts',
      );
    });

    it('resumes a paused queue when the switch says running', async () => {
      isPaused.mockResolvedValue(true);

      await expect(service.apply('alerts')).resolves.toBe(false);
      expect(resume).toHaveBeenCalledTimes(1);
    });

    it('leaves a queue that already agrees alone', async () => {
      await expect(service.apply('alerts')).resolves.toBe(false);

      stored = PAUSED;
      isPaused.mockResolvedValue(true);

      await expect(service.apply('alerts')).resolves.toBe(true);
      expect(pause).not.toHaveBeenCalled();
      expect(resume).not.toHaveBeenCalled();
    });

    it('says what the switch says even when Redis cannot be reached', async () => {
      stored = PAUSED;
      isPaused.mockRejectedValue('down');

      await expect(service.apply('alerts')).resolves.toBe(true);
      expect(warn).toHaveBeenCalledWith(
        '[apply] Source unavailable - Error: string',
      );
    });

    it('says nothing when the switch cannot be read', async () => {
      getString.mockRejectedValue(new Error('database down'));

      await expect(service.apply('alerts')).resolves.toBeNull();
      expect(isPaused).not.toHaveBeenCalled();
    });

    it('is applied as the application starts', async () => {
      stored = PAUSED;

      await service.onApplicationBootstrap();

      expect(pause).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        '[apply] Publication queue paused to match the switch - Trigger: startup',
      );
    });
  });
});
