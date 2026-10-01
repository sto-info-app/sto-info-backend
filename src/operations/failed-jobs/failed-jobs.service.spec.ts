import {
  ConflictException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';

import { SiteAdminActionEntity } from 'src/audit/site-admin/site-admin-action.entity';
import { SiteAdminActionKind } from 'src/audit/site-admin/site-admin-action.enum';
import { FileAssetPlacementEntity } from 'src/file-assets/entities/file-asset-placement.entity';
import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetPlacementState } from 'src/file-assets/enums/file-asset-placement-state.enum';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { FileRescanEntity } from 'src/file-scanning/rescan/file-rescan.entity';
import { RescanState } from 'src/file-scanning/rescan/rescan.enums';
import { ChatTranscriptEntity } from 'src/fleet/chat/entities/chat-transcript.entity';
import { ChatTranscriptStatus } from 'src/fleet/chat/enums/chat.enums';
import { RosterProjectionEntity } from 'src/fleet/projection/entities/roster-projection.entity';
import { REDIS_TIMEOUT_MS } from 'src/shared/queue/redis-within.utility';

import {
  FAILED_JOB_PAGE_SIZE,
  FAILED_JOB_QUEUES,
  FAILED_JOB_RETRY_ALL_LIMIT,
  FailedJobQueue,
} from './failed-job.constants';
import { FailedJobsService, failureCodeOf } from './failed-jobs.service';

/** A Redis that holds every command, as BullMQ's client does while it is down. */
const never = <T>(): Promise<T> => new Promise<T>(() => {});

/**
 * Runs something against a silent Redis, moving the clock past the limit.
 *
 * @param run - What to run.
 * @returns Its outcome, settled.
 */
async function pastTheLimit<T>(
  run: () => Promise<T>,
): Promise<PromiseSettledResult<T>> {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });

  try {
    const settled = Promise.allSettled([run()]);

    await jest.advanceTimersByTimeAsync(REDIS_TIMEOUT_MS * 2);

    return (await settled)[0];
  } finally {
    jest.useRealTimers();
  }
}

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const RESCAN_ID = '33333333-3333-4333-8333-333333333333';
const FAILED_AT = new Date('2026-09-30T11:00:00.000Z');

/** The parts of a job these tests use. */
interface JobShape {
  id?: string;
  name?: string;
  data?: unknown;
  attemptsMade?: number;
  finishedOn?: number;
  failedReason?: string;
  stacktrace?: string[] | null;
  state?: string;
  retryFails?: boolean;
  removeFails?: boolean;
}

/** A failed job and the mocks it carries. */
type FakeJob = Job & {
  retry: jest.Mock<(state: string, opts: unknown) => Promise<void>>;
  remove: jest.Mock<() => Promise<void>>;
};

/**
 * Builds a failed job.
 *
 * @param shape - What differs from an upload's failed scan request.
 * @returns The job.
 */
function jobOf(shape: JobShape = {}): FakeJob {
  return {
    id: shape.id ?? `${ASSET_ID}_1`,
    name: shape.name ?? 'scan-request',
    data: 'data' in shape ? shape.data : { assetId: ASSET_ID, objectKey: 'k' },
    attemptsMade: shape.attemptsMade ?? 5,
    finishedOn: 'finishedOn' in shape ? shape.finishedOn : FAILED_AT.getTime(),
    failedReason: shape.failedReason ?? 'boom',
    stacktrace: shape.stacktrace ?? ['QueryFailedError: boom\n    at x'],
    getState: jest.fn(() => Promise.resolve(shape.state ?? 'failed')),
    retry: jest.fn(() =>
      shape.retryFails
        ? Promise.reject(new Error('Job is locked'))
        : Promise.resolve(),
    ),
    remove: jest.fn(() =>
      shape.removeFails
        ? Promise.reject(new Error('Job is locked'))
        : Promise.resolve(),
    ),
  } as unknown as FakeJob;
}

/** A queue's mocks. */
interface FakeQueue {
  getFailedCount: jest.Mock<() => Promise<number>>;
  getFailed: jest.Mock<(start: number, end: number) => Promise<Job[]>>;
  getJob: jest.Mock<(jobId: string) => Promise<Job | undefined>>;
}

describe('FailedJobsService', () => {
  let queues: Record<string, FakeQueue>;
  let records: Map<unknown, unknown>;
  let findOne: jest.Mock<
    (entity: unknown, options: { where: unknown }) => Promise<unknown>
  >;
  let insert: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let warn: jest.SpiedFunction<Logger['warn']>;
  let service: FailedJobsService;

  /**
   * Gives a queue failed jobs.
   *
   * @param name - The queue.
   * @param jobs - Its failed set, newest first.
   */
  const failed = (name: FailedJobQueue, jobs: Job[]): void => {
    queues[name].getFailedCount.mockResolvedValue(jobs.length);
    queues[name].getFailed.mockImplementation((start, end) =>
      Promise.resolve(jobs.slice(start, end + 1)),
    );
    queues[name].getJob.mockImplementation(jobId =>
      Promise.resolve(jobs.find(job => job.id === jobId)),
    );
  };

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

    queues = {};
    for (const name of FAILED_JOB_QUEUES) {
      queues[name] = {
        getFailedCount: jest.fn(() => Promise.resolve(0)),
        getFailed: jest.fn(() => Promise.resolve([])),
        getJob: jest.fn(() => Promise.resolve(undefined)),
      };
    }

    records = new Map();
    records.set(FileAssetEntity, {
      id: ASSET_ID,
      state: FileAssetState.SCANNING,
      objectKey: 'k',
    });
    findOne = jest.fn(entity => Promise.resolve(records.get(entity) ?? null));
    insert = jest.fn(() => Promise.resolve(undefined));

    service = new FailedJobsService(
      { manager: { findOne, insert } } as unknown as DataSource,
      {
        get: (token: string) =>
          queues[token.replace(/^BullQueue_/, '')] as unknown,
      } as unknown as ModuleRef,
    );
  });

  afterEach(() => {
    warn.mockRestore();
    jest.restoreAllMocks();
  });

  describe('counts', () => {
    it('counts each queue, with null for one Redis did not answer for', async () => {
      queues['file-scan'].getFailedCount.mockResolvedValue(2);
      queues['chat-transcript'].getFailedCount.mockRejectedValue(
        new Error('redis.internal refused'),
      );

      await expect(service.counts()).resolves.toEqual({
        'file-scan': 2,
        'file-scan-verdict': 0,
        'file-asset-publication': 0,
        'chat-transcript': null,
        'fleet-roster-replay': 0,
      });
      expect(warn).toHaveBeenCalledWith(
        '[counts] Queue unavailable - Error: Error',
      );
    });
  });

  describe('list', () => {
    it('pages across the queues in order, reading only what it shows', async () => {
      failed(
        'file-scan',
        [1, 2, 3].map(n => jobOf({ id: `scan-${n}` })),
      );
      failed(
        'file-asset-publication',
        Array.from({ length: 30 }, (_, n) =>
          jobOf({ id: `pub-${n}`, data: { assetId: ASSET_ID } }),
        ),
      );
      failed('fleet-roster-replay', [
        jobOf({ id: 'replay-1', data: { fleetId: 'fleet-1' } }),
      ]);
      queues['chat-transcript'].getFailedCount.mockRejectedValue('down');

      const first = await service.list(undefined, 1, ADMIN_ID);

      expect(first.items).toHaveLength(FAILED_JOB_PAGE_SIZE);
      expect(first.total).toBe(34);
      expect(first.counts['chat-transcript']).toBeNull();
      expect(queues['file-scan'].getFailed).toHaveBeenCalledWith(0, 2);
      expect(queues['file-asset-publication'].getFailed).toHaveBeenCalledWith(
        0,
        21,
      );
      expect(queues['fleet-roster-replay'].getFailed).not.toHaveBeenCalled();

      const second = await service.list(undefined, 2, ADMIN_ID);

      expect(second.items.map(item => item.jobId)).toEqual([
        ...Array.from({ length: 8 }, (_, n) => `pub-${n + 22}`),
        'replay-1',
      ]);
      expect(queues['file-asset-publication'].getFailed).toHaveBeenCalledWith(
        22,
        29,
      );
    });

    it('describes each job by IDs and codes, and whether a retry can help', async () => {
      failed('file-scan', [
        jobOf({ id: 'scan-1', failedReason: 'connect ECONNREFUSED 10.0.0.1' }),
        jobOf({ id: 'scan-2', data: 'nothing', finishedOn: undefined }),
      ]);

      const page = await service.list('file-scan', 1, ADMIN_ID);

      expect(page.items).toEqual([
        {
          queue: 'file-scan',
          jobId: 'scan-1',
          name: 'scan-request',
          attemptsMade: 5,
          failedAt: FAILED_AT,
          subjectKind: 'FILE_ASSET',
          subjectId: ASSET_ID,
          reason: 'ECONNREFUSED',
          retryable: true,
          notRetryableBecause: null,
        },
        {
          queue: 'file-scan',
          jobId: 'scan-2',
          name: 'scan-request',
          attemptsMade: 5,
          failedAt: null,
          subjectKind: null,
          subjectId: null,
          reason: 'QueryFailedError',
          retryable: false,
          notRetryableBecause: 'NO_SUBJECT',
        },
      ]);
      expect(page.counts).toEqual({ 'file-scan': 2 });
    });

    it('names each queue’s subject', async () => {
      failed('chat-transcript', [
        jobOf({ data: { transcriptId: 'transcript-1' } }),
      ]);
      failed('fleet-roster-replay', [jobOf({ data: { fleetId: 'fleet-1' } })]);
      failed('file-scan-verdict', [
        jobOf({ data: { assetId: ASSET_ID, objectKey: 'k' } }),
      ]);

      const page = await service.list(undefined, 1, ADMIN_ID);

      expect(
        page.items.map(item => [item.queue, item.subjectKind, item.subjectId]),
      ).toEqual([
        ['file-scan-verdict', 'FILE_ASSET', ASSET_ID],
        ['chat-transcript', 'CHAT_TRANSCRIPT', 'transcript-1'],
        ['fleet-roster-replay', 'FLEET', 'fleet-1'],
      ]);
    });

    // FC-042: every read of the diagnostics is logged.
    // The page reads the first page of every queue with the diagnostics,
    // whose entry covers it; only a deliberate read logs on its own.
    it('logs a later page or a chosen queue, and not the first page of all', async () => {
      await service.list(undefined, 1, ADMIN_ID);

      expect(insert).not.toHaveBeenCalled();

      await service.list(undefined, 2, ADMIN_ID);
      await service.list('file-scan', 1, ADMIN_ID);

      expect(insert).toHaveBeenNthCalledWith(
        1,
        SiteAdminActionEntity,
        expect.objectContaining({
          action: SiteAdminActionKind.SCAN_DIAGNOSTICS_VIEWED,
          actorUserId: ADMIN_ID,
          subjectKind: 'FAILED_JOBS',
          subjectId: 'ALL',
          detail: { page: 2 },
        }),
      );
      expect(insert).toHaveBeenNthCalledWith(
        2,
        SiteAdminActionEntity,
        expect.objectContaining({ detail: { page: 1, queue: 'file-scan' } }),
      );
    });

    it('says Redis cannot be reached when it stops answering part way', async () => {
      queues['file-scan'].getFailedCount.mockResolvedValue(1);
      queues['file-scan'].getFailed.mockRejectedValue(new Error('down'));

      await expect(service.list(undefined, 1, ADMIN_ID)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('retry', () => {
    it('sends the job round with its attempts back, and logs it', async () => {
      const job = jobOf({ id: 'scan-1', attemptsMade: 5 });

      failed('file-scan', [job]);

      await service.retry('file-scan', 'scan-1', ADMIN_ID, 'Redis was down');

      expect(job.retry).toHaveBeenCalledWith('failed', {
        resetAttemptsMade: true,
        resetAttemptsStarted: true,
      });
      expect(insert).toHaveBeenCalledWith(
        SiteAdminActionEntity,
        expect.objectContaining({
          action: SiteAdminActionKind.SCAN_JOB_RETRIED,
          actorUserId: ADMIN_ID,
          subjectKind: 'file-scan',
          subjectId: 'scan-1',
          reason: 'Redis was down',
          detail: { attemptsMade: 5 },
        }),
      );
    });

    it('says when there is no such job', async () => {
      await expect(
        service.retry('file-scan', 'nope', ADMIN_ID, 'Why'),
      ).rejects.toThrow(new NotFoundException('There is no such job.'));
    });

    it('refuses a job that has not failed', async () => {
      failed('file-scan', [jobOf({ id: 'scan-1', state: 'waiting' })]);

      await expect(
        service.retry('file-scan', 'scan-1', ADMIN_ID, 'Why'),
      ).rejects.toThrow(
        new ConflictException(
          'That job has not failed; it is waiting, so there is nothing to retry.',
        ),
      );
    });

    it('refuses a retry that would change nothing, saying why', async () => {
      records.set(FileAssetEntity, {
        id: ASSET_ID,
        state: FileAssetState.REJECTED,
        objectKey: 'k',
      });
      failed('file-scan', [jobOf({ id: 'scan-1' })]);

      await expect(
        service.retry('file-scan', 'scan-1', ADMIN_ID, 'Why'),
      ).rejects.toThrow(
        new ConflictException(
          'That upload is no longer waiting for a scan (it is REJECTED), so ' +
            'retrying would change nothing.',
        ),
      );
      expect(insert).not.toHaveBeenCalled();
    });

    it('refuses when somebody else retried it first', async () => {
      failed('file-scan', [jobOf({ id: 'scan-1', retryFails: true })]);

      await expect(
        service.retry('file-scan', 'scan-1', ADMIN_ID, 'Why'),
      ).rejects.toThrow(ConflictException);
      expect(insert).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        '[send] Queue unavailable - Error: Error',
      );
    });

    it('says Redis cannot be reached', async () => {
      queues['file-scan'].getJob.mockRejectedValue('down');

      await expect(
        service.retry('file-scan', 'scan-1', ADMIN_ID, 'Why'),
      ).rejects.toThrow(
        new ServiceUnavailableException('The job queues cannot be reached.'),
      );
      expect(warn).toHaveBeenCalledWith(
        '[reach] Queue unavailable - Error: string',
      );
    });
  });

  describe('retryAll', () => {
    it('retries what a retry can help, leaves the rest, and logs the counts', async () => {
      const helps = jobOf({ id: 'scan-1' });
      const cannot = jobOf({ id: 'scan-2', data: {} });
      const raced = jobOf({ id: 'scan-3', retryFails: true });

      failed('file-scan', [helps, cannot, raced]);
      failed('fleet-roster-replay', [jobOf({ data: { fleetId: 'fleet-1' } })]);

      const result = await service.retryAll(undefined, ADMIN_ID, 'Outage over');

      expect(helps.retry).toHaveBeenCalled();
      expect(cannot.retry).not.toHaveBeenCalled();
      expect(result).toEqual({
        retried: 1,
        skipped: 3,
        // The fakes' failed sets do not shrink when a job is retried.
        remaining: 4,
        byQueue: {
          'file-scan': { retried: 1, skipped: 2 },
          'file-scan-verdict': { retried: 0, skipped: 0 },
          'file-asset-publication': { retried: 0, skipped: 0 },
          'chat-transcript': { retried: 0, skipped: 0 },
          'fleet-roster-replay': { retried: 0, skipped: 1 },
        },
      });
      expect(insert).toHaveBeenCalledWith(
        SiteAdminActionEntity,
        expect.objectContaining({
          action: SiteAdminActionKind.SCAN_JOB_RETRIED,
          subjectKind: 'ALL',
          subjectId: 'ALL',
          reason: 'Outage over',
          detail: {
            retried: 1,
            skipped: 3,
            byQueue: result.byQueue,
          },
        }),
      );
    });

    it('keeps to one queue when asked, and to its limit', async () => {
      failed(
        'file-scan',
        Array.from({ length: FAILED_JOB_RETRY_ALL_LIMIT + 5 }, (_, n) =>
          jobOf({ id: `scan-${n}` }),
        ),
      );

      const result = await service.retryAll('file-scan', ADMIN_ID, 'Why');

      expect(queues['file-scan'].getFailed).toHaveBeenCalledWith(
        0,
        FAILED_JOB_RETRY_ALL_LIMIT - 1,
      );
      expect(result.retried).toBe(FAILED_JOB_RETRY_ALL_LIMIT);
      expect(Object.keys(result.byQueue)).toEqual(['file-scan']);
      expect(insert).toHaveBeenCalledWith(
        SiteAdminActionEntity,
        expect.objectContaining({ subjectKind: 'file-scan', subjectId: 'ALL' }),
      );
    });

    it('stops reading queues once it reaches its limit', async () => {
      failed(
        'file-scan',
        Array.from({ length: FAILED_JOB_RETRY_ALL_LIMIT }, (_, n) =>
          jobOf({ id: `scan-${n}` }),
        ),
      );

      const result = await service.retryAll(undefined, ADMIN_ID, 'Why');

      expect(queues['file-scan-verdict'].getFailed).not.toHaveBeenCalled();
      expect(result.byQueue['fleet-roster-replay']).toEqual({
        retried: 0,
        skipped: 0,
      });
    });

    it('cannot say what remains when a queue cannot be counted', async () => {
      queues['chat-transcript'].getFailedCount.mockRejectedValue('down');

      await expect(
        service.retryAll(undefined, ADMIN_ID, 'Why'),
      ).resolves.toEqual(expect.objectContaining({ remaining: null }));
    });
  });

  // Every job is read against its record as it runs, so a retry is only
  // sent when that record still waits for it.
  describe('discard', () => {
    it('removes any failed job, and logs whether a retry could have helped', async () => {
      const cannot = jobOf({ id: 'scan-1', data: {}, attemptsMade: 3 });
      const could = jobOf({ id: 'scan-2' });

      failed('file-scan', [cannot, could]);

      await service.discard('file-scan', 'scan-1', ADMIN_ID, 'Swept upload');
      await service.discard('file-scan', 'scan-2', ADMIN_ID, 'Not wanted');

      expect(cannot.remove).toHaveBeenCalled();
      expect(could.remove).toHaveBeenCalled();
      expect(insert).toHaveBeenNthCalledWith(
        1,
        SiteAdminActionEntity,
        expect.objectContaining({
          action: SiteAdminActionKind.SCAN_JOB_DISCARDED,
          actorUserId: ADMIN_ID,
          subjectKind: 'file-scan',
          subjectId: 'scan-1',
          reason: 'Swept upload',
          detail: { attemptsMade: 3, retryable: false },
        }),
      );
      expect(insert).toHaveBeenNthCalledWith(
        2,
        SiteAdminActionEntity,
        expect.objectContaining({
          detail: { attemptsMade: 5, retryable: true },
        }),
      );
    });

    it('says when there is no such job', async () => {
      await expect(
        service.discard('file-scan', 'nope', ADMIN_ID, 'Why'),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses a job that has not failed', async () => {
      failed('file-scan', [jobOf({ id: 'scan-1', state: 'active' })]);

      await expect(
        service.discard('file-scan', 'scan-1', ADMIN_ID, 'Why'),
      ).rejects.toThrow(
        new ConflictException(
          'That job has not failed; it is active, so there is nothing to discard.',
        ),
      );
    });

    it('refuses when somebody else got there first', async () => {
      failed('file-scan', [jobOf({ id: 'scan-1', removeFails: true })]);

      await expect(
        service.discard('file-scan', 'scan-1', ADMIN_ID, 'Why'),
      ).rejects.toThrow(ConflictException);
      expect(insert).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        '[drop] Queue unavailable - Error: Error',
      );
    });
  });

  describe('discardUnretryable', () => {
    it('removes only what a retry cannot help, and logs the counts', async () => {
      const could = jobOf({ id: 'scan-1' });
      const cannot = jobOf({ id: 'scan-2', data: {} });
      const raced = jobOf({ id: 'scan-3', data: {}, removeFails: true });

      failed('file-scan', [could, cannot, raced]);

      const result = await service.discardUnretryable(
        'file-scan',
        ADMIN_ID,
        'Clearing the failed set',
      );

      expect(could.remove).not.toHaveBeenCalled();
      expect(cannot.remove).toHaveBeenCalled();
      expect(result).toEqual({
        discarded: 1,
        kept: 2,
        // The fakes' failed sets do not shrink when a job is removed.
        remaining: 3,
        byQueue: { 'file-scan': { discarded: 1, kept: 2 } },
      });
      expect(insert).toHaveBeenCalledWith(
        SiteAdminActionEntity,
        expect.objectContaining({
          action: SiteAdminActionKind.SCAN_JOB_DISCARDED,
          subjectKind: 'file-scan',
          subjectId: 'ALL',
          reason: 'Clearing the failed set',
          detail: { discarded: 1, kept: 2, byQueue: result.byQueue },
        }),
      );
    });

    it('goes through every queue when asked for none', async () => {
      failed('fleet-roster-replay', [jobOf({ data: { fleetId: 'fleet-1' } })]);

      await expect(
        service.discardUnretryable(undefined, ADMIN_ID, 'Why'),
      ).resolves.toEqual(
        expect.objectContaining({ discarded: 1, kept: 0, remaining: 1 }),
      );
      expect(insert).toHaveBeenCalledWith(
        SiteAdminActionEntity,
        expect.objectContaining({ subjectKind: 'ALL', subjectId: 'ALL' }),
      );
    });
  });

  // FC-042: the page a site admin is sent to in a Redis outage must not
  // wait for Redis.
  describe('while Redis does not answer', () => {
    it('counts every queue at once, each null once past the limit', async () => {
      for (const name of FAILED_JOB_QUEUES) {
        queues[name].getFailedCount.mockImplementation(never);
      }
      queues['file-scan'].getFailedCount.mockResolvedValue(2);

      const outcome = await pastTheLimit(() => service.counts());

      expect(outcome).toEqual({
        status: 'fulfilled',
        value: {
          'file-scan': 2,
          'file-scan-verdict': null,
          'file-asset-publication': null,
          'chat-transcript': null,
          'fleet-roster-replay': null,
        },
      });
    });

    it('answers the list with a 503, not an empty page', async () => {
      for (const name of FAILED_JOB_QUEUES) {
        queues[name].getFailedCount.mockImplementation(never);
      }

      const outcome = await pastTheLimit(() =>
        service.list(undefined, 1, ADMIN_ID),
      );

      expect(outcome).toEqual({
        status: 'rejected',
        reason: new ServiceUnavailableException(
          'The job queues cannot be reached.',
        ),
      });
    });

    it('answers a retry with a 503 when the job cannot be read', async () => {
      queues['file-scan'].getJob.mockImplementation(never);

      const outcome = await pastTheLimit(() =>
        service.retry('file-scan', 'scan-1', ADMIN_ID, 'Why'),
      );

      expect(outcome.status).toBe('rejected');
      expect((outcome as PromiseRejectedResult).reason).toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('answers a retry or discard with a 503 when the command is not answered', async () => {
      const job = jobOf({ id: 'scan-1' });

      job.retry.mockImplementation(never);
      job.remove.mockImplementation(never);
      failed('file-scan', [job]);

      for (const run of [
        () => service.retry('file-scan', 'scan-1', ADMIN_ID, 'Why'),
        () => service.discard('file-scan', 'scan-1', ADMIN_ID, 'Why'),
      ]) {
        const outcome = await pastTheLimit(run);

        expect(outcome).toEqual({
          status: 'rejected',
          reason: new ServiceUnavailableException(
            'The job queues cannot be reached.',
          ),
        });
      }
      expect(insert).not.toHaveBeenCalled();
    });

    it('answers "Retry all" with a 503, logging nothing, when Redis is down from the start', async () => {
      queues['file-scan'].getFailed.mockRejectedValue(new Error('down'));

      await expect(
        service.retryAll('file-scan', ADMIN_ID, 'Why'),
      ).rejects.toThrow(
        new ServiceUnavailableException('The job queues cannot be reached.'),
      );
      expect(insert).not.toHaveBeenCalled();
    });

    it.each([
      ['retryAll', SiteAdminActionKind.SCAN_JOB_RETRIED, { retried: 1 }],
      [
        'discardUnretryable',
        SiteAdminActionKind.SCAN_JOB_DISCARDED,
        { discarded: 1 },
      ],
    ] as const)(
      'logs what %s did before Redis stopped answering, then says so',
      async (method, action, counted) => {
        failed('file-scan', [
          method === 'retryAll' ? jobOf() : jobOf({ data: {} }),
        ]);
        queues['file-scan-verdict'].getFailed.mockRejectedValue('gone');

        await expect(
          service[method](undefined, ADMIN_ID, 'Why'),
        ).rejects.toThrow(
          new ServiceUnavailableException(
            'The job queues stopped answering part way; what was done has ' +
              'been logged in the Security Log.',
          ),
        );
        expect(insert).toHaveBeenCalledWith(
          SiteAdminActionEntity,
          expect.objectContaining({
            action,
            detail: expect.objectContaining({
              ...counted,
              interrupted: true,
            }),
          }),
        );
      },
    );

    it('lets a failure that is not Redis through a sweep', async () => {
      failed('file-scan', [jobOf()]);
      findOne.mockRejectedValue(new TypeError('database said no'));

      await expect(
        service.retryAll(undefined, ADMIN_ID, 'Why'),
      ).rejects.toThrow('database said no');
    });
  });

  describe('whether a retry can help', () => {
    /**
     * Lists one job and reports why it cannot be retried.
     *
     * @param queue - Its queue.
     * @param job - The job.
     * @returns The refusal's code, or null when it can.
     */
    const refusalOf = async (
      queue: FailedJobQueue,
      job: Job,
    ): Promise<string | null> => {
      failed(queue, [job]);

      const [item] = (await service.list(queue, 1, ADMIN_ID)).items;

      return item.notRetryableBecause;
    };

    describe('file-scan', () => {
      it('helps an upload still being scanned, for the same object', async () => {
        await expect(refusalOf('file-scan', jobOf())).resolves.toBeNull();
        await expect(
          refusalOf(
            'file-scan',
            jobOf({ data: { assetId: ASSET_ID, objectKey: 'other' } }),
          ),
        ).resolves.toBe('SETTLED');
      });

      it('does not help an upload that has gone', async () => {
        records.delete(FileAssetEntity);

        await expect(refusalOf('file-scan', jobOf())).resolves.toBe('SETTLED');
      });

      it('helps a rescan still waiting for its verdict, and no other', async () => {
        const rescan = jobOf({ id: `rescan_${RESCAN_ID}` });

        records.set(FileRescanEntity, { state: RescanState.REQUESTED });
        await expect(refusalOf('file-scan', rescan)).resolves.toBeNull();
        expect(findOne).toHaveBeenCalledWith(FileRescanEntity, {
          where: { id: RESCAN_ID },
        });

        records.set(FileRescanEntity, { state: RescanState.FAILED });
        await expect(refusalOf('file-scan', rescan)).resolves.toBe('SETTLED');

        records.delete(FileRescanEntity);
        await expect(refusalOf('file-scan', rescan)).resolves.toBe('SETTLED');
      });
    });

    describe('file-scan-verdict', () => {
      it('needs the asset and the object it answers for', async () => {
        await expect(
          refusalOf(
            'file-scan-verdict',
            jobOf({ data: { assetId: ASSET_ID } }),
          ),
        ).resolves.toBe('NO_SUBJECT');
        await expect(
          refusalOf('file-scan-verdict', jobOf({ data: { objectKey: 'k' } })),
        ).resolves.toBe('NO_SUBJECT');
      });

      it('helps a rescan still waiting, found by its staged copy', async () => {
        records.set(FileRescanEntity, { state: RescanState.REQUESTED });

        await expect(
          refusalOf('file-scan-verdict', jobOf()),
        ).resolves.toBeNull();
        expect(findOne).toHaveBeenCalledWith(FileRescanEntity, {
          where: { assetId: ASSET_ID, stagingKey: 'k' },
        });
      });

      it('otherwise helps an upload still being scanned', async () => {
        await expect(
          refusalOf('file-scan-verdict', jobOf()),
        ).resolves.toBeNull();

        records.set(FileAssetEntity, {
          state: FileAssetState.CLEAN,
          objectKey: 'k',
        });

        await expect(refusalOf('file-scan-verdict', jobOf())).resolves.toBe(
          'SETTLED',
        );
      });
    });

    describe('file-asset-publication', () => {
      it.each([
        [FileAssetState.CLEAN, FileAssetPlacementState.PENDING, null],
        [FileAssetState.AVAILABLE, FileAssetPlacementState.PENDING, null],
        [FileAssetState.CLEAN, FileAssetPlacementState.HELD, null],
        [FileAssetState.AVAILABLE, FileAssetPlacementState.HELD, 'SETTLED'],
        [FileAssetState.CLEAN, FileAssetPlacementState.ACTIVE, 'SETTLED'],
        [FileAssetState.REJECTED, FileAssetPlacementState.PENDING, 'SETTLED'],
        [FileAssetState.CLEAN, null, 'SETTLED'],
      ])(
        'judges a %s asset with a %s placement',
        async (state, placement, refusal) => {
          records.set(FileAssetEntity, { state });
          if (placement === null) {
            records.delete(FileAssetPlacementEntity);
          } else {
            records.set(FileAssetPlacementEntity, { state: placement });
          }

          await expect(
            refusalOf(
              'file-asset-publication',
              jobOf({ data: { assetId: ASSET_ID } }),
            ),
          ).resolves.toBe(refusal);
        },
      );

      it('does not help an asset that has gone, or a job naming none', async () => {
        records.delete(FileAssetEntity);

        await expect(
          refusalOf(
            'file-asset-publication',
            jobOf({ data: { assetId: ASSET_ID } }),
          ),
        ).resolves.toBe('SETTLED');
        await expect(
          refusalOf('file-asset-publication', jobOf({ data: null })),
        ).resolves.toBe('NO_SUBJECT');
      });
    });

    describe('chat-transcript', () => {
      it.each([
        [ChatTranscriptStatus.PENDING, null],
        [ChatTranscriptStatus.FAILED, 'SETTLED'],
        [undefined, 'SETTLED'],
      ])('judges a %s transcript', async (status, refusal) => {
        if (status !== undefined) {
          records.set(ChatTranscriptEntity, { status });
        }

        await expect(
          refusalOf(
            'chat-transcript',
            jobOf({ data: { transcriptId: 'transcript-1' } }),
          ),
        ).resolves.toBe(refusal);
      });

      it('does not help a job naming no transcript', async () => {
        await expect(
          refusalOf('chat-transcript', jobOf({ data: { transcriptId: '' } })),
        ).resolves.toBe('NO_SUBJECT');
      });
    });

    describe('fleet-roster-replay', () => {
      it.each([
        [{ built: 1, requested: 2 }, null],
        [{ built: 2, requested: 2 }, 'SETTLED'],
        [undefined, 'SETTLED'],
      ])('judges a projection of %o', async (projection, refusal) => {
        if (projection !== undefined) {
          records.set(RosterProjectionEntity, projection);
        }

        await expect(
          refusalOf(
            'fleet-roster-replay',
            jobOf({ data: { fleetId: 'fleet-1' } }),
          ),
        ).resolves.toBe(refusal);
      });

      it('does not help a job naming no Fleet', async () => {
        await expect(
          refusalOf('fleet-roster-replay', jobOf({ data: { fleetId: 7 } })),
        ).resolves.toBe('NO_SUBJECT');
      });
    });
  });

  // The text of an error can quote a statement's values, a file's name or
  // a host, so none of it leaves this process: only a code.
  describe('failureCodeOf', () => {
    it.each([
      ['job stalled more than allowable limit', null, 'STALLED'],
      ['connect ECONNREFUSED 10.0.0.1:6379', null, 'ECONNREFUSED'],
      ['getaddrinfo EAI_AGAIN redis.internal', null, 'EAI_AGAIN'],
      ['Upload failed with status 503', null, 'HTTP_503'],
      ['Request failed with status code 429', null, 'HTTP_429'],
      ['Operation timed out after 30s', null, 'TIMEOUT'],
      ['socket timeout', null, 'TIMEOUT'],
      [
        'invalid input syntax for type uuid: "holiday.png"',
        ['Error: first\n    at a', 'QueryFailedError: second\n    at b'],
        'QueryFailedError',
      ],
      ['something personal', ['not a stack'], 'UNKNOWN'],
      ['something personal', null, 'UNKNOWN'],
    ])('reduces "%s" to a code', (failedReason, stacktrace, code) => {
      expect(
        failureCodeOf({
          failedReason,
          stacktrace,
        } as unknown as Job),
      ).toBe(code);
    });

    it('copes with a job that has no reason at all', () => {
      expect(
        failureCodeOf({
          failedReason: undefined,
          stacktrace: [],
        } as unknown as Job),
      ).toBe('UNKNOWN');
    });
  });
});
