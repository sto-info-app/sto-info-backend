import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';

import { Job } from 'bullmq';

import { ROSTER_REPLAY_QUEUE } from '../constants/roster-replay.constants';
import { RosterReplayService } from '../services/roster-replay.service';

/**
 * Replays a Fleet's roster when asked.
 *
 * Thin, like the publication processor: the job carries a Fleet identifier
 * and nothing else, and the replay reads the Fleet's evidence and counters as
 * they stand when the job runs rather than anything the message claimed.
 *
 * **A malformed job is dropped.** Its only field is the Fleet, and a job
 * without one will not grow one on the next attempt.
 *
 * **Anything else is rethrown**, so BullMQ retries with backoff. A retry is
 * safe: a replay that failed rolled back, and one that published and failed
 * afterwards has already moved `built`, so the retry finishes its proposals
 * and builds nothing.
 */
@Processor(ROSTER_REPLAY_QUEUE)
export class RosterReplayProcessor extends WorkerHost {
  private readonly _logger = new Logger(RosterReplayProcessor.name);

  /**
   * Creates an instance of RosterReplayProcessor.
   *
   * @param _replay - What replays a Fleet.
   */
  constructor(private readonly _replay: RosterReplayService) {
    super();
  }

  /**
   * Handles one job.
   *
   * @param job - The job.
   */
  async process(job: Job<unknown>): Promise<void> {
    const fleetId = this.fleetIdOf(job.data);

    if (fleetId === null) {
      this._logger.error(`[process] Replay job rejected - JobId: ${job.id}`);

      return;
    }

    await this._replay.replay(fleetId);
  }

  /**
   * Reads the Fleet identifier out of a job.
   *
   * @param data - The job's payload.
   * @returns The Fleet, or null when the job does not carry one.
   */
  private fleetIdOf(data: unknown): string | null {
    if (typeof data !== 'object' || data === null) {
      return null;
    }

    const fleetId = (data as { fleetId?: unknown }).fleetId;

    return typeof fleetId === 'string' && fleetId.length > 0 ? fleetId : null;
  }
}
