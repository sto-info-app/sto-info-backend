import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';

import { Queue } from 'bullmq';

import {
  ROSTER_IDENTITY_QUEUE,
  ROSTER_IDENTITY_RECOMPUTE_ATTEMPTS,
  ROSTER_IDENTITY_RECOMPUTE_BACKOFF_MS,
  ROSTER_IDENTITY_RECOMPUTE_JOB,
} from '../constants/roster-identity.constants';

/**
 * Asks for a Fleet's roster identities to be worked out again.
 *
 * Queued rather than called, because the things that change a Fleet's
 * identities — an import going into force, a reviewer's decision — each
 * finish in a transaction of their own, and a recompute reads every in-force
 * import the Fleet has. Doing that inside either would make an import's
 * activation or a reviewer's click wait on the whole of the Fleet's history.
 *
 * ## Not keyed
 *
 * Every request is its own job. A job keyed by the Fleet would be dropped
 * while one for the same Fleet is running, and the running one may already
 * have read the evidence the new request is about, so the change would never
 * be seen. Jobs for one Fleet instead queue behind a lock in the recompute
 * and each reads the evidence as it then stands, which makes a surplus job
 * a wasted pass rather than a wrong one. Coalescing them is FC-019's, along
 * with the projection revision it will wrap this in.
 */
@Injectable()
export class RosterIdentityQueueService {
  private readonly _logger = new Logger(RosterIdentityQueueService.name);

  /**
   * Creates an instance of RosterIdentityQueueService.
   *
   * @param _queue - The identity queue.
   */
  constructor(
    @InjectQueue(ROSTER_IDENTITY_QUEUE) private readonly _queue: Queue,
  ) {}

  /**
   * Queues one Fleet for a recompute.
   *
   * @param fleetId - The Fleet whose evidence or decisions changed.
   */
  async enqueue(fleetId: string): Promise<void> {
    await this._queue.add(
      ROSTER_IDENTITY_RECOMPUTE_JOB,
      { fleetId },
      {
        attempts: ROSTER_IDENTITY_RECOMPUTE_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: ROSTER_IDENTITY_RECOMPUTE_BACKOFF_MS,
        },
        removeOnComplete: true,
        // Kept, because a recompute that ran out of attempts leaves a Fleet's
        // candidates and proposals behind its evidence, and nothing else
        // would say so.
        removeOnFail: false,
      },
    );

    this._logger.log(
      `[enqueue] Identity recompute queued - FleetId: ${fleetId}`,
    );
  }
}
