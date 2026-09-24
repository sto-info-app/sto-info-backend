import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';

import { Job } from 'bullmq';

import { ROSTER_IDENTITY_QUEUE } from '../constants/roster-identity.constants';
import { RosterIdentityRecomputeService } from '../services/roster-identity-recompute.service';

/**
 * Works out a Fleet's roster identities again when asked.
 *
 * Thin, like the publication processor: the job carries a Fleet identifier
 * and nothing else, and the recompute reads the Fleet's evidence as it stands
 * when the job runs rather than anything the message claimed.
 *
 * **A malformed job is dropped.** Its only field is the Fleet, and a job
 * without one will not grow one on the next attempt.
 *
 * **Anything else is rethrown**, so BullMQ retries with backoff.
 */
@Processor(ROSTER_IDENTITY_QUEUE)
export class RosterIdentityProcessor extends WorkerHost {
  private readonly _logger = new Logger(RosterIdentityProcessor.name);

  /**
   * Creates an instance of RosterIdentityProcessor.
   *
   * @param _recompute - What works a Fleet's identities out.
   */
  constructor(private readonly _recompute: RosterIdentityRecomputeService) {
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
      this._logger.error(`[process] Identity job rejected - JobId: ${job.id}`);

      return;
    }

    await this._recompute.recompute(fleetId);
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
