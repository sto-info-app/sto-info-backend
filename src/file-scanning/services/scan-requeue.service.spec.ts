import { Logger } from '@nestjs/common';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Job, Queue } from 'bullmq';
import { DataSource } from 'typeorm';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { REDIS_TIMEOUT_MS } from 'src/shared/queue/redis-within.utility';

import {
  RequestedScan,
  ScanRequestProducerService,
} from './scan-request-producer.service';
import {
  FAILED_VERDICT_SAMPLE,
  SCAN_REQUEUE_BATCH,
  SCAN_REQUEUE_LOCK,
  ScanRequeueService,
} from './scan-requeue.service';

/**
 * Builds an upload awaiting a scan.
 *
 * @param id - Its identifier.
 * @param state - Its state.
 * @returns The asset.
 */
const upload = (
  id: string,
  state: FileAssetState = FileAssetState.RETRY_PENDING,
): FileAssetEntity => ({ id, state, policyVersion: 1 }) as FileAssetEntity;

describe('ScanRequeueService (FC-042)', () => {
  let waiting: FileAssetEntity[];
  let find: jest.Mock<(...args: unknown[]) => Promise<FileAssetEntity[]>>;
  let runnerQuery: jest.Mock<
    (sql: string, params?: unknown[]) => Promise<unknown>
  >;
  let release: jest.Mock<() => Promise<void>>;
  let jobs: Map<string, unknown>;
  let getJob: jest.Mock<(jobId: string) => Promise<unknown>>;
  let getFailed: jest.Mock<(start: number, end: number) => Promise<Job[]>>;
  let requestScan: jest.Mock<
    (asset: FileAssetEntity) => Promise<RequestedScan>
  >;
  let resend: jest.Mock<(asset: FileAssetEntity) => Promise<void>>;
  let warn: jest.SpiedFunction<Logger['warn']>;
  let error: jest.SpiedFunction<Logger['error']>;
  let service: ScanRequeueService;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    waiting = [];
    find = jest.fn(() => Promise.resolve(waiting));
    runnerQuery = jest.fn((sql: string) =>
      Promise.resolve(
        sql.includes('pg_try_advisory_lock') ? [{ locked: true }] : [],
      ),
    );
    release = jest.fn(() => Promise.resolve());
    jobs = new Map();
    getJob = jest.fn(jobId => Promise.resolve(jobs.get(jobId)));
    getFailed = jest.fn(() => Promise.resolve([]));
    requestScan = jest.fn(asset =>
      Promise.resolve({ asset, traceId: 'trace', queued: true }),
    );
    resend = jest.fn(() => Promise.resolve());

    service = new ScanRequeueService(
      {
        createQueryRunner: () => ({
          connect: () => Promise.resolve(),
          query: runnerQuery,
          release,
        }),
        manager: { find },
      } as unknown as DataSource,
      { getJob } as unknown as Queue,
      { getFailed } as unknown as Queue,
      { requestScan, resend } as unknown as ScanRequestProducerService,
    );
  });

  afterEach(() => {
    warn.mockRestore();
    error.mockRestore();
    jest.restoreAllMocks();
  });

  it('looks for stored uploads awaiting a scan for more than two minutes, oldest first', async () => {
    await expect(service.requeue()).resolves.toBe(0);

    const [, options] = find.mock.calls[0] as [
      unknown,
      {
        where: Record<string, { getSql?: (column: string) => string }>;
        order: unknown;
        take: number;
      },
    ];

    expect(options.where.state).toEqual(
      expect.objectContaining({
        value: [
          FileAssetState.QUARANTINED,
          FileAssetState.SCANNING,
          FileAssetState.RETRY_PENDING,
        ],
      }),
    );
    expect(options.where.updatedAt.getSql?.('"updatedAt"')).toBe(
      `"updatedAt" < now() - interval '2 minutes'`,
    );
    expect(options.order).toEqual({ updatedAt: 'ASC', id: 'ASC' });
    expect(options.take).toBe(SCAN_REQUEUE_BATCH);
    // Nothing waiting asks Redis nothing.
    expect(getFailed).not.toHaveBeenCalled();
  });

  it('requests an upload that never reached the queue, as a new upload is', async () => {
    waiting = [
      upload('a', FileAssetState.QUARANTINED),
      upload('b', FileAssetState.RETRY_PENDING),
    ];

    await expect(service.requeue()).resolves.toBe(2);

    expect(getJob).toHaveBeenCalledWith('a_1');
    expect(requestScan).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      '[requeue] Scan requests queued again - Count: 2, Checked: 2',
    );
  });

  it('sends again the request of an upload still scanning, leaving its state', async () => {
    waiting = [upload('a', FileAssetState.SCANNING)];

    await expect(service.requeue()).resolves.toBe(1);

    expect(resend).toHaveBeenCalledWith(waiting[0]);
    expect(requestScan).not.toHaveBeenCalled();
  });

  // Waiting, prioritised, delayed, active or failed: the job is there.
  it('leaves an upload whose request is on the queue in any state', async () => {
    waiting = [upload('a', FileAssetState.SCANNING)];
    jobs.set('a_1', { id: 'a_1' });

    await expect(service.requeue()).resolves.toBe(0);

    expect(resend).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('leaves an upload whose verdict is waiting in the failed set for a site admin', async () => {
    waiting = [upload('a', FileAssetState.SCANNING), upload('b')];
    getFailed.mockResolvedValue([
      { data: { assetId: 'a' } },
      { data: null },
      { data: { assetId: 7 } },
    ] as unknown as Job[]);

    await expect(service.requeue()).resolves.toBe(1);

    expect(getFailed).toHaveBeenCalledWith(0, FAILED_VERDICT_SAMPLE - 1);
    expect(resend).not.toHaveBeenCalled();
    expect(requestScan).toHaveBeenCalledWith(waiting[1]);
  });

  it('queues nothing while Redis does not answer', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });

    try {
      waiting = [upload('a')];
      getFailed.mockImplementation(() => new Promise<Job[]>(() => {}));

      const run = service.requeue();

      await jest.advanceTimersByTimeAsync(REDIS_TIMEOUT_MS);
      await expect(run).resolves.toBeNull();
      expect(requestScan).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        '[requeue] Scan requests not queued again; the next run tries - ' +
          'Error: RedisTimeoutError',
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops when Redis stops taking requests part way', async () => {
    waiting = [upload('a'), upload('b'), upload('c')];
    requestScan
      .mockResolvedValueOnce({
        asset: waiting[0],
        traceId: 't',
        queued: true,
      })
      .mockResolvedValueOnce({
        asset: waiting[1],
        traceId: 't',
        queued: false,
      });

    await expect(service.requeue()).resolves.toBe(1);

    expect(requestScan).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      '[requeue] Scan requests not queued again; the next run tries - ' +
        'Error: Error',
    );
  });

  it('stops on anything else, logging it by type', async () => {
    waiting = [upload('a', FileAssetState.SCANNING), upload('b')];
    resend.mockRejectedValue('refused');

    await expect(service.requeue()).resolves.toBe(0);
    expect(requestScan).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      '[requeue] Scan requests not queued again; the next run tries - ' +
        'Error: string',
    );
  });

  describe('tick', () => {
    it('runs every minute while holding the advisory lock', async () => {
      waiting = [upload('a')];

      await expect(service.tick()).resolves.toBe(1);
      expect(runnerQuery).toHaveBeenCalledWith(
        'SELECT pg_try_advisory_lock($1::bigint) AS "locked"',
        [SCAN_REQUEUE_LOCK],
      );
      expect(runnerQuery).toHaveBeenCalledWith(
        'SELECT pg_advisory_unlock($1::bigint)',
        [SCAN_REQUEUE_LOCK],
      );
      expect(release).toHaveBeenCalled();
    });

    it('leaves the run to another instance holding the lock', async () => {
      runnerQuery.mockResolvedValueOnce([{ locked: false }]);

      await expect(service.tick()).resolves.toBeNull();
      expect(find).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalled();
    });

    it('skips a tick while the last one is still going', async () => {
      let finish: (found: FileAssetEntity[]) => void = () => {};

      find.mockImplementationOnce(
        () =>
          new Promise<FileAssetEntity[]>(resolve => {
            finish = resolve;
          }),
      );

      const first = service.tick();

      while (find.mock.calls.length === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }

      await expect(service.tick()).resolves.toBeNull();
      expect(warn).toHaveBeenCalledWith(
        '[tick] Previous run still going; skipped',
      );

      finish([]);
      await expect(first).resolves.toBe(0);
    });

    it('survives a run that fails', async () => {
      find.mockRejectedValueOnce(new TypeError('database said no'));

      await expect(service.tick()).resolves.toBeNull();
      expect(error).toHaveBeenCalledWith(
        '[tick] Scan re-queue run failed - Error: TypeError',
      );

      runnerQuery.mockRejectedValueOnce('no connection');
      await expect(service.tick()).resolves.toBeNull();
      expect(error).toHaveBeenCalledWith(
        '[tick] Scan re-queue run failed - Error: string',
      );
    });
  });
});
