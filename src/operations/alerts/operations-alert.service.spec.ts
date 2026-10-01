import { Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { DataSource } from 'typeorm';

import { PublicationPauseService } from 'src/file-assets/publication/publication-pause.service';
import { ScanWorkerHeartbeatDto } from 'src/file-scanning/dto/scan-diagnostics.dto';
import { ScanDiagnosticsService } from 'src/file-scanning/services/scan-diagnostics.service';
import { NotificationSeverity } from 'src/notification/enums/notification-severity.enum';
import { NotificationTarget } from 'src/notification/enums/notification-target.enum';
import { NotificationService } from 'src/notification/notification.service';
import { UserEntity } from 'src/user/entities/user.entity';
import { UserRole } from 'src/user/enums/user-role.enum';

import { FailedJobsService } from '../failed-jobs/failed-jobs.service';
import {
  OPERATIONS_ALERT_LOCK,
  PRIORITISED_SAMPLE,
  QUEUE_PROBE_TIMEOUT_MS,
  SCAN_DIAGNOSTICS_LINK,
} from './operations-alert.constants';
import { OperationsAlertEntity } from './operations-alert.entity';
import { OperationsAlertKind } from './operations-alert.enum';
import {
  OPERATIONS_ALERT_NOTICES,
  OperationsAlertService,
  OperationsFinding,
} from './operations-alert.service';

const NOW = new Date('2026-09-30T12:00:00.000Z').getTime();
const MINUTE = 60_000;
const ADMINS = [{ id: 'admin-1' }, { id: 'admin-2' }];

/**
 * A worker's heartbeat, as the diagnostics service reads it.
 *
 * @param overrides - What differs from a live, running worker.
 * @returns The heartbeat.
 */
function worker(
  overrides: Partial<ScanWorkerHeartbeatDto> = {},
): ScanWorkerHeartbeatDto {
  return {
    workerId: 'worker-a',
    state: 'RUNNING',
    pauseReason: null,
    definitionsVersion: '27500',
    definitionsBuiltAt: new Date(NOW - 3 * 3_600_000),
    signatureAgeHours: 3,
    jobsInHand: 0,
    startedAt: new Date(NOW - 3_600_000),
    beatAt: new Date(NOW - 10_000),
    secondsSinceBeat: 10,
    live: true,
    pausedSince: null,
    pausedMinutes: null,
    ...overrides,
  };
}

/** One statement the alert run built. */
interface Statement {
  op: 'insert' | 'update';
  values?: unknown;
  set?: Record<string, unknown>;
  where?: Record<string, unknown>;
}

describe('OperationsAlertService', () => {
  let statements: Statement[];
  let inserted: unknown[];
  let affected: number;
  let runnerQuery: jest.Mock<
    (sql: string, params?: unknown[]) => Promise<unknown>
  >;
  let release: jest.Mock<() => Promise<void>>;
  let find: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let readHeartbeats: jest.Mock<() => Promise<ScanWorkerHeartbeatDto[] | null>>;
  let apply: jest.Mock<(trigger: string) => Promise<boolean | null>>;
  let state: jest.Mock<
    () => Promise<{
      paused: boolean;
      pausedAt: Date | null;
      pausedByUserId: string | null;
    }>
  >;
  let counts: jest.Mock<() => Promise<Record<string, number | null>>>;
  let createNotification: jest.Mock<(dto: unknown) => Promise<unknown>>;
  let queues: Record<
    string,
    {
      getWaiting: jest.Mock<(start: number, end: number) => Promise<unknown[]>>;
      getPrioritized: jest.Mock<
        (start: number, end: number) => Promise<unknown[]>
      >;
      isPaused: jest.Mock<() => Promise<boolean>>;
    }
  >;
  let warn: jest.SpiedFunction<Logger['warn']>;
  let error: jest.SpiedFunction<Logger['error']>;
  let service: OperationsAlertService;

  /**
   * Runs one tick and reports the findings by kind.
   *
   * @param paused - Whether publication is paused.
   * @returns What each check found.
   */
  const findings = async (
    paused: boolean | null = false,
  ): Promise<Map<OperationsAlertKind, OperationsFinding>> =>
    new Map(await service.evaluate(paused));

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

    statements = [];
    inserted = [];
    affected = 0;

    const builder = (): Record<string, unknown> => {
      const statement: Statement = { op: 'update' };
      const chain: Record<string, unknown> = {};

      chain.update = () => chain;
      chain.insert = () => {
        statement.op = 'insert';

        return chain;
      };
      chain.into = () => chain;
      chain.orIgnore = () => chain;
      chain.returning = () => chain;
      chain.values = (values: unknown) => {
        statement.values = values;

        return chain;
      };
      chain.set = (set: Record<string, unknown>) => {
        // What TypeORM sends for a raw value is what the function returns.
        statement.set = Object.fromEntries(
          Object.entries(set).map(([key, value]) => [
            key,
            typeof value === 'function' ? (value as () => unknown)() : value,
          ]),
        );

        return chain;
      };
      chain.where = (where: Record<string, unknown>) => {
        statement.where = where;

        return chain;
      };
      chain.execute = () => {
        statements.push(statement);

        return Promise.resolve(
          statement.op === 'insert' ? { raw: inserted } : { affected },
        );
      };

      return chain;
    };

    runnerQuery = jest.fn((sql: string) =>
      Promise.resolve(
        sql.includes('pg_try_advisory_lock') ? [{ locked: true }] : [],
      ),
    );
    release = jest.fn(() => Promise.resolve());
    find = jest.fn(() => Promise.resolve(ADMINS));
    readHeartbeats = jest.fn(() => Promise.resolve([worker()]));
    apply = jest.fn(() => Promise.resolve(false));
    state = jest.fn(() =>
      Promise.resolve({ paused: false, pausedAt: null, pausedByUserId: null }),
    );
    counts = jest.fn(() => Promise.resolve({ 'file-scan': 0 }));
    createNotification = jest.fn(() => Promise.resolve({}));
    queues = {};
    for (const name of ['file-scan', 'file-asset-publication']) {
      queues[name] = {
        getWaiting: jest.fn(() => Promise.resolve([])),
        getPrioritized: jest.fn(() => Promise.resolve([])),
        isPaused: jest.fn(() => Promise.resolve(false)),
      };
    }

    service = new OperationsAlertService(
      {
        createQueryRunner: () => ({
          connect: () => Promise.resolve(),
          query: runnerQuery,
          release,
        }),
        getRepository: (entity: unknown) => {
          expect(entity).toBe(OperationsAlertEntity);

          return { createQueryBuilder: builder };
        },
        manager: { find },
      } as unknown as DataSource,
      { readHeartbeats } as unknown as ScanDiagnosticsService,
      { apply, state } as unknown as PublicationPauseService,
      { counts } as unknown as FailedJobsService,
      { createNotification } as unknown as NotificationService,
      {
        get: (token: string) => queues[token.replace(/^BullQueue_/, '')],
      } as unknown as ModuleRef,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    warn.mockRestore();
    error.mockRestore();
    jest.restoreAllMocks();
  });

  describe('tick', () => {
    it('re-applies the pause, clears what is not there and tells nobody', async () => {
      await expect(service.tick()).resolves.toBe(true);

      expect(apply).toHaveBeenCalledWith('alerts');
      expect(runnerQuery).toHaveBeenCalledWith(
        'SELECT pg_try_advisory_lock($1::bigint) AS "locked"',
        [OPERATIONS_ALERT_LOCK],
      );
      expect(runnerQuery).toHaveBeenCalledWith(
        'SELECT pg_advisory_unlock($1::bigint)',
        [OPERATIONS_ALERT_LOCK],
      );
      expect(release).toHaveBeenCalled();
      expect(statements).toHaveLength(Object.keys(OperationsAlertKind).length);
      expect(statements.every(statement => statement.op === 'update')).toBe(
        true,
      );
      expect(statements[0].where).toEqual({
        kind: OperationsAlertKind.SCAN_QUEUE_LAG,
        clearedAt: expect.anything(),
      });
      expect(createNotification).not.toHaveBeenCalled();
    });

    it('leaves the run to another instance holding the lock', async () => {
      runnerQuery.mockResolvedValueOnce([{ locked: false }]);

      await expect(service.tick()).resolves.toBe(false);
      expect(apply).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalled();
    });

    it('skips a tick while the last one is still going', async () => {
      let finish: (value: boolean) => void = () => {};

      apply.mockImplementationOnce(
        () =>
          new Promise<boolean>(resolve => {
            finish = resolve;
          }),
      );

      const first = service.tick();

      await expect(service.tick()).resolves.toBe(false);
      expect(warn).toHaveBeenCalledWith(
        '[tick] Previous run still going; skipped',
      );

      // The pause is applied once Redis has answered the probe.
      while (apply.mock.calls.length === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }

      finish(false);
      await expect(first).resolves.toBe(true);
    });

    it('survives a run that fails, and unlocks', async () => {
      apply.mockRejectedValueOnce(new TypeError('boom'));

      await expect(service.tick()).resolves.toBe(false);
      expect(error).toHaveBeenCalledWith(
        '[tick] Operations alert run failed - Error: TypeError',
      );
      expect(runnerQuery).toHaveBeenCalledWith(
        'SELECT pg_advisory_unlock($1::bigint)',
        [OPERATIONS_ALERT_LOCK],
      );

      runnerQuery.mockRejectedValueOnce('no connection');
      await expect(service.tick()).resolves.toBe(false);
      expect(error).toHaveBeenCalledWith(
        '[tick] Operations alert run failed - Error: string',
      );
    });

    it('opens an alert once, telling every site admin, then only touches it', async () => {
      readHeartbeats.mockResolvedValue([]);
      inserted = [{ id: 'alert-1' }];

      await service.tick();

      const opened = statements.find(statement => statement.op === 'insert')!;

      expect(opened.values).toEqual({
        kind: OperationsAlertKind.WORKER_SILENT,
        detail: { liveWorkers: 0 },
      });
      expect(createNotification).toHaveBeenCalledTimes(ADMINS.length);
      expect(createNotification).toHaveBeenCalledWith({
        target: NotificationTarget.USER,
        userId: 'admin-1',
        severity: NotificationSeverity.WARNING,
        ...OPERATIONS_ALERT_NOTICES[OperationsAlertKind.WORKER_SILENT].opened,
        linkUrl: SCAN_DIAGNOSTICS_LINK,
      });
      expect(find).toHaveBeenCalledWith(UserEntity, {
        where: { role: UserRole.ADMIN, disabledAt: expect.anything() },
        select: { id: true },
      });

      // The next minute finds it already open: it is touched, not re-told.
      statements = [];
      inserted = [];
      createNotification.mockClear();

      await service.tick();

      expect(statements).toContainEqual({
        op: 'update',
        set: { lastSeenAt: 'now()', detail: { liveWorkers: 0 } },
        where: {
          kind: OperationsAlertKind.WORKER_SILENT,
          clearedAt: expect.anything(),
        },
      });
      expect(createNotification).not.toHaveBeenCalled();
    });

    it('clears an alert once, telling every site admin', async () => {
      affected = 1;

      await service.tick();

      expect(statements[0]).toEqual({
        op: 'update',
        set: { clearedAt: 'now()' },
        where: {
          kind: OperationsAlertKind.SCAN_QUEUE_LAG,
          clearedAt: expect.anything(),
        },
      });
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: NotificationSeverity.INFO,
          ...OPERATIONS_ALERT_NOTICES[OperationsAlertKind.SCAN_QUEUE_LAG]
            .cleared,
        }),
      );
    });

    it('carries on when one notice cannot be written', async () => {
      readHeartbeats.mockResolvedValue(null);
      inserted = [{ id: 'alert-1' }];
      createNotification.mockRejectedValueOnce(new Error('insert failed'));

      await expect(service.tick()).resolves.toBe(true);
      expect(createNotification).toHaveBeenCalledTimes(ADMINS.length);
      expect(warn).toHaveBeenCalledWith(
        '[tell] Notice not sent - UserId: admin-1',
      );
    });

    it('leaves an alert it could not judge as it was', async () => {
      apply.mockResolvedValue(null);
      readHeartbeats.mockResolvedValue(null);
      counts.mockResolvedValue({ 'file-scan': null });

      await service.tick();

      // The queue lag and the pause are judged; a heartbeat that cannot be
      // read is silence. Nothing else is touched.
      expect(
        statements.map(
          statement =>
            statement.where?.kind ??
            (statement.values as { kind: string }).kind,
        ),
      ).toEqual([
        OperationsAlertKind.SCAN_QUEUE_LAG,
        OperationsAlertKind.WORKER_SILENT,
        OperationsAlertKind.WORKER_SILENT,
        OperationsAlertKind.PUBLICATION_PAUSED_LONG,
        OperationsAlertKind.QUEUES_UNREACHABLE,
      ]);
    });
  });

  // FC-042: Redis carries every queue; notifications are database rows.
  describe('queues unreachable', () => {
    /**
     * What the last tick settled for one kind.
     *
     * @param kind - The kind.
     * @returns Its statement, if any.
     */
    const settled = (kind: OperationsAlertKind): Statement | undefined =>
      statements.find(
        statement =>
          statement.where?.kind === kind ||
          (statement.values as { kind?: string } | undefined)?.kind === kind,
      );

    it('opens after two minutes of runs that cannot reach Redis, and clears when it answers', async () => {
      queues['file-scan'].isPaused.mockRejectedValue(new Error('ECONNREFUSED'));

      await service.tick();

      // The first failure starts the clock, and changes nothing yet.
      expect(settled(OperationsAlertKind.QUEUES_UNREACHABLE)).toBeUndefined();
      expect(apply).not.toHaveBeenCalled();
      expect(counts).not.toHaveBeenCalled();
      expect(queues['file-scan'].getWaiting).not.toHaveBeenCalled();
      expect(settled(OperationsAlertKind.SCAN_QUEUE_LAG)).toBeUndefined();
      expect(settled(OperationsAlertKind.FAILED_JOBS)).toBeUndefined();
      expect(
        settled(OperationsAlertKind.PUBLICATION_QUEUE_LAG),
      ).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        '[probeQueues] Redis did not answer - Error: Error',
      );

      jest.setSystemTime(NOW + MINUTE);
      await service.tick();
      expect(settled(OperationsAlertKind.QUEUES_UNREACHABLE)).toBeUndefined();

      inserted = [{ id: 'alert-1' }];
      jest.setSystemTime(NOW + 2 * MINUTE);
      await service.tick();

      expect(settled(OperationsAlertKind.QUEUES_UNREACHABLE)).toEqual({
        op: 'insert',
        values: {
          kind: OperationsAlertKind.QUEUES_UNREACHABLE,
          detail: { minutesUnreachable: 2 },
        },
      });
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: NotificationSeverity.WARNING,
          ...OPERATIONS_ALERT_NOTICES[OperationsAlertKind.QUEUES_UNREACHABLE]
            .opened,
        }),
      );

      // Redis answers: the alert clears, and the clock starts again.
      statements = [];
      inserted = [];
      queues['file-scan'].isPaused.mockResolvedValue(false);
      await service.tick();

      expect(settled(OperationsAlertKind.QUEUES_UNREACHABLE)).toEqual({
        op: 'update',
        set: { clearedAt: 'now()' },
        where: {
          kind: OperationsAlertKind.QUEUES_UNREACHABLE,
          clearedAt: expect.anything(),
        },
      });

      statements = [];
      queues['file-scan'].isPaused.mockRejectedValue('down again');
      jest.setSystemTime(NOW + 3 * MINUTE);
      await service.tick();

      expect(settled(OperationsAlertKind.QUEUES_UNREACHABLE)).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        '[probeQueues] Redis did not answer - Error: string',
      );
    });

    it('gives up on a Redis that does not answer in time', async () => {
      queues['file-scan'].isPaused.mockImplementation(
        () => new Promise<boolean>(() => {}),
      );

      const run = service.tick();

      await jest.advanceTimersByTimeAsync(QUEUE_PROBE_TIMEOUT_MS);
      await expect(run).resolves.toBe(true);
      expect(warn).toHaveBeenCalledWith(
        '[probeQueues] Redis did not answer in time',
      );
      expect(apply).not.toHaveBeenCalled();
    });
  });

  describe('queue lag', () => {
    it('opens when the oldest waiting job has waited more than 15 minutes', async () => {
      queues['file-scan'].getWaiting.mockResolvedValue([
        { timestamp: NOW - 20 * MINUTE },
      ]);
      queues['file-scan'].getPrioritized.mockResolvedValue([
        { timestamp: NOW - 16 * MINUTE },
        { timestamp: NOW - 25 * MINUTE },
      ]);

      const found = await findings();

      expect(queues['file-scan'].getWaiting).toHaveBeenCalledWith(-1, -1);
      expect(queues['file-scan'].getPrioritized).toHaveBeenCalledWith(
        0,
        PRIORITISED_SAMPLE - 1,
      );
      expect(found.get(OperationsAlertKind.SCAN_QUEUE_LAG)).toEqual({
        open: true,
        detail: { oldestMinutes: 25 },
      });
    });

    it('stays clear at 15 minutes, and with nothing waiting', async () => {
      queues['file-asset-publication'].getWaiting.mockResolvedValue([
        { timestamp: NOW - 15 * MINUTE },
      ]);

      const found = await findings();

      expect(found.get(OperationsAlertKind.SCAN_QUEUE_LAG)).toEqual({
        open: false,
      });
      expect(found.get(OperationsAlertKind.PUBLICATION_QUEUE_LAG)).toEqual({
        open: false,
      });
    });

    it('does not judge publication while it is paused, or when that is unknown', async () => {
      queues['file-asset-publication'].getWaiting.mockResolvedValue([
        { timestamp: NOW - 60 * MINUTE },
      ]);

      expect(
        (await findings(true)).get(OperationsAlertKind.PUBLICATION_QUEUE_LAG),
      ).toEqual({ open: false });
      expect(
        (await findings(null)).get(OperationsAlertKind.PUBLICATION_QUEUE_LAG),
      ).toBeNull();
      expect(
        (await findings(false)).get(OperationsAlertKind.PUBLICATION_QUEUE_LAG),
      ).toEqual({ open: true, detail: { oldestMinutes: 60 } });
      expect(queues['file-asset-publication'].getWaiting).toHaveBeenCalledTimes(
        1,
      );
    });

    it('cannot tell when Redis cannot be reached', async () => {
      queues['file-scan'].getWaiting.mockRejectedValue(new Error('down'));

      const found = await findings();

      expect(found.get(OperationsAlertKind.SCAN_QUEUE_LAG)).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        '[evaluate] Check could not tell - Check: scanQueue, Error: Error',
      );
    });
  });

  describe('workers', () => {
    it('counts a heartbeat that cannot be read as silence, and says nothing else', async () => {
      readHeartbeats.mockResolvedValue(null);

      const found = await findings();

      expect(found.get(OperationsAlertKind.WORKER_SILENT)).toEqual({
        open: true,
        detail: {},
      });
      expect(found.get(OperationsAlertKind.WORKER_PAUSED)).toBeNull();
      expect(found.get(OperationsAlertKind.SIGNATURES_STALE)).toBeNull();
    });

    it('is silent when no worker has beaten in two minutes', async () => {
      readHeartbeats.mockResolvedValue([
        worker({ live: false, secondsSinceBeat: 400 }),
        worker({ live: false, secondsSinceBeat: 190 }),
      ]);

      const found = await findings();

      expect(found.get(OperationsAlertKind.WORKER_SILENT)).toEqual({
        open: true,
        detail: { liveWorkers: 0, minutesSinceBeat: 3 },
      });
      expect(found.get(OperationsAlertKind.WORKER_PAUSED)).toBeNull();
    });

    it('opens when every live worker has been paused ten minutes or more', async () => {
      readHeartbeats.mockResolvedValue([
        worker({ state: 'PAUSED', pausedMinutes: 12 }),
        worker({ state: 'PAUSED', pausedMinutes: 10 }),
        worker({ live: false, state: 'RUNNING' }),
      ]);

      const found = await findings();

      expect(found.get(OperationsAlertKind.WORKER_SILENT)).toEqual({
        open: false,
      });
      expect(found.get(OperationsAlertKind.WORKER_PAUSED)).toEqual({
        open: true,
        detail: { pausedWorkers: 2, pausedMinutes: 10 },
      });
    });

    it.each([
      [
        'one live worker is running',
        [worker({ state: 'PAUSED', pausedMinutes: 30 }), worker()],
      ],
      ['the pause is younger', [worker({ state: 'PAUSED', pausedMinutes: 9 })]],
      [
        'the pause has no start',
        [worker({ state: 'PAUSED', pausedMinutes: null })],
      ],
      ['one is stopping', [worker({ state: 'STOPPING' })]],
    ])('stays clear when %s', async (_name, workers) => {
      readHeartbeats.mockResolvedValue(workers);

      expect((await findings()).get(OperationsAlertKind.WORKER_PAUSED)).toEqual(
        { open: false },
      );
    });

    it('judges the newest signatures any live worker holds', async () => {
      readHeartbeats.mockResolvedValue([
        worker({ signatureAgeHours: 40 }),
        worker({ signatureAgeHours: 37.5 }),
        worker({ live: false, signatureAgeHours: 2 }),
      ]);

      expect(
        (await findings()).get(OperationsAlertKind.SIGNATURES_STALE),
      ).toEqual({ open: true, detail: { signatureAgeHours: 37.5 } });

      readHeartbeats.mockResolvedValue([
        worker({ signatureAgeHours: 40 }),
        worker({ signatureAgeHours: 36 }),
      ]);

      expect(
        (await findings()).get(OperationsAlertKind.SIGNATURES_STALE),
      ).toEqual({ open: false });
    });

    it('leaves undated signatures to the paused alert', async () => {
      readHeartbeats.mockResolvedValue([worker({ signatureAgeHours: null })]);

      expect(
        (await findings()).get(OperationsAlertKind.SIGNATURES_STALE),
      ).toEqual({ open: false });
    });

    it('cannot tell when the heartbeat read throws', async () => {
      readHeartbeats.mockRejectedValue('odd');

      const found = await findings();

      expect(found.get(OperationsAlertKind.WORKER_SILENT)).toBeNull();
      expect(found.get(OperationsAlertKind.WORKER_PAUSED)).toBeNull();
      expect(found.get(OperationsAlertKind.SIGNATURES_STALE)).toBeNull();
    });
  });

  describe('failed jobs', () => {
    it.each([
      [
        { a: 0, b: 2, c: null },
        { open: true, detail: { failed: 2 } },
      ],
      [{ a: 0, b: 0 }, { open: false }],
      [{ a: 0, b: null }, null],
    ])('judges counts of %o', async (queueCounts, finding) => {
      counts.mockResolvedValue(queueCounts);

      expect((await findings()).get(OperationsAlertKind.FAILED_JOBS)).toEqual(
        finding,
      );
    });
  });

  describe('publication paused long', () => {
    it.each([
      [false, null, { open: false }],
      [true, null, { open: true, detail: {} }],
      [true, 61, { open: true, detail: { pausedMinutes: 61 } }],
      [true, 60, { open: false }],
    ])(
      'judges a pause (%s) begun %s minutes ago',
      async (paused, minutesAgo, finding) => {
        state.mockResolvedValue({
          paused,
          pausedAt:
            minutesAgo === null ? null : new Date(NOW - minutesAgo * MINUTE),
          pausedByUserId: null,
        });

        expect(
          (await findings()).get(OperationsAlertKind.PUBLICATION_PAUSED_LONG),
        ).toEqual(finding);
      },
    );
  });

  it('words every notice plainly, pointing at Scan Diagnostics or the Admin page', () => {
    for (const notices of Object.values(OPERATIONS_ALERT_NOTICES)) {
      for (const notice of [notices.opened, notices.cleared]) {
        expect(notice.title.length).toBeLessThanOrEqual(160);
        expect(notice.body).toMatch(/\.$/);
      }
    }
  });
});
