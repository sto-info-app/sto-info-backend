import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';

import { Queue } from 'bullmq';
import { EntityManager } from 'typeorm';

import {
  ROSTER_REPLAY_ATTEMPTS,
  ROSTER_REPLAY_BACKOFF_MS,
  ROSTER_REPLAY_JOB,
  ROSTER_REPLAY_QUEUE,
} from '../constants/roster-replay.constants';
import { RosterProjectionEntity } from '../entities/roster-projection.entity';

/**
 * Asks for a Fleet's roster to be replayed (FC-019).
 *
 * In two halves, because the two have different transactions:
 *
 * - **{@link request}**, inside the transaction that changed the evidence,
 *   bumps the Fleet's `requested` counter. The change and the request commit
 *   together or not at all, so a change can never be made without the
 *   projection knowing it is behind.
 * - **{@link enqueue}**, after that transaction commits, queues a job. Only
 *   after, so the job cannot run before the change it is about is visible.
 *
 * ## Coalescing — Steve's decision of 25 September 2026
 *
 * Every request is its own job, and the counters make surplus ones cheap: a
 * replay reads `requested` when it starts, builds from the evidence as it
 * then stands, and records that value as `built`. A job that finds `built`
 * already at or past `requested` does nothing. Ten changes arriving during
 * one replay are covered by the next, and the nine jobs after it read two
 * numbers and stop.
 *
 * If queueing fails after the commit, the request is still recorded, and the
 * sweep in {@link RosterReplaySweepService} queues the Fleet again.
 */
@Injectable()
export class RosterReplayQueueService {
  private readonly _logger = new Logger(RosterReplayQueueService.name);

  /**
   * Creates an instance of RosterReplayQueueService.
   *
   * @param _queue - The replay queue.
   */
  constructor(
    @InjectQueue(ROSTER_REPLAY_QUEUE) private readonly _queue: Queue,
  ) {}

  /**
   * Records that a Fleet's evidence or decisions changed.
   *
   * @param manager - The transaction the change is being made in.
   * @param fleetId - The Fleet.
   */
  async request(manager: EntityManager, fleetId: string): Promise<void> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(RosterProjectionEntity)
      .values({ fleetId })
      .orIgnore()
      .execute();

    await manager.increment(
      RosterProjectionEntity,
      { fleetId },
      'requested',
      1,
    );
  }

  /**
   * Queues one Fleet for a replay.
   *
   * @param fleetId - The Fleet whose evidence or decisions changed.
   */
  async enqueue(fleetId: string): Promise<void> {
    await this._queue.add(
      ROSTER_REPLAY_JOB,
      { fleetId },
      {
        attempts: ROSTER_REPLAY_ATTEMPTS,
        backoff: { type: 'exponential', delay: ROSTER_REPLAY_BACKOFF_MS },
        removeOnComplete: true,
        // Kept, because a replay that ran out of attempts leaves a Fleet's
        // history behind its evidence, and the failure is how to find out
        // why.
        removeOnFail: false,
      },
    );

    this._logger.log(`[enqueue] Roster replay queued - FleetId: ${fleetId}`);
  }
}
