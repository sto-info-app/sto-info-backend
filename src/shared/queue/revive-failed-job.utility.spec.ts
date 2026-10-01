import { describe, expect, it, jest } from '@jest/globals';
import { Job, Queue } from 'bullmq';

import { reviveFailedJob } from './revive-failed-job.utility';

/**
 * Builds a queue holding at most one job.
 *
 * @param job - The job it holds, if any.
 * @returns The queue.
 */
const queueWith = (job: Job | undefined): Queue =>
  ({ getJob: jest.fn(() => Promise.resolve(job)) }) as unknown as Queue;

/**
 * Builds a job.
 *
 * @param failed - Whether it is in the failed set.
 * @returns The job, and its retry mock.
 */
function jobOf(failed: boolean): {
  job: Job;
  retry: jest.Mock<(state: string, opts: unknown) => Promise<void>>;
} {
  const retry = jest.fn<(state: string, opts: unknown) => Promise<void>>(() =>
    Promise.resolve(),
  );

  return {
    job: {
      isFailed: jest.fn(() => Promise.resolve(failed)),
      retry,
    } as unknown as Job,
    retry,
  };
}

describe('reviveFailedJob', () => {
  it('sends a failed job with that identifier round again, attempts restored', async () => {
    const { job, retry } = jobOf(true);
    const queue = queueWith(job);

    await expect(reviveFailedJob(queue, 'asset-1')).resolves.toBe(true);
    expect(queue.getJob).toHaveBeenCalledWith('asset-1');
    expect(retry).toHaveBeenCalledWith('failed', {
      resetAttemptsMade: true,
      resetAttemptsStarted: true,
    });
  });

  it('leaves a job that has not failed to BullMQ’s own deduplication', async () => {
    const { job, retry } = jobOf(false);

    await expect(reviveFailedJob(queueWith(job), 'asset-1')).resolves.toBe(
      false,
    );
    expect(retry).not.toHaveBeenCalled();
  });

  it('has nothing to do when there is no such job', async () => {
    await expect(
      reviveFailedJob(queueWith(undefined), 'asset-1'),
    ).resolves.toBe(false);
  });
});
