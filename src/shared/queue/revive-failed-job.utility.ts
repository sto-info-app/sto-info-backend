import { Queue } from 'bullmq';

/**
 * Sends a failed job round again, when a producer is about to add a job
 * with the same identifier (FC-042).
 *
 * BullMQ ignores an `add` whose `jobId` is already in the queue, in any
 * state. That is what makes a deterministic identifier deduplicate a job
 * that is waiting or running, and it is also a trap: a job kept in the
 * failed set (`removeOnFail: false`) swallows every later request for the
 * same work, silently, so the work is stranded until somebody retries the
 * old job by hand. A producer calls this first; when it answers true the
 * failed job is back in the queue with its attempts restored, and there is
 * nothing to add.
 *
 * @param queue - The queue.
 * @param jobId - The identifier the producer is about to add.
 * @returns True when a failed job with that identifier was sent round
 *   again; false when there is none, or it has not failed.
 */
export async function reviveFailedJob(
  queue: Queue,
  jobId: string,
): Promise<boolean> {
  const job = await queue.getJob(jobId);

  if (job === undefined || !(await job.isFailed())) {
    return false;
  }

  await job.retry('failed', {
    resetAttemptsMade: true,
    resetAttemptsStarted: true,
  });

  return true;
}
