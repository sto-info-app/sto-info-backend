import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';

import { DelayedError, Job } from 'bullmq';

import {
  FILE_ASSET_PUBLICATION_QUEUE,
  PUBLICATION_PAUSED_RECHECK_MS,
} from '../constants/file-asset-publication.constants';
import { PublicationPauseService } from '../publication/publication-pause.service';
import { AssetPublicationService } from '../services/asset-publication.service';

/**
 * Publishes assets a scanner has cleared.
 *
 * Thin, like the two processors either side of it: the message carries an
 * asset identifier and nothing else, and every decision is made against the
 * registry as it stands when the job runs rather than against anything the
 * message claimed. A verdict that has since been overtaken by a second
 * upload, an asset whose record has since been deleted and a duplicate
 * delivery all reach the same code and are refused there.
 *
 * **A malformed job is dropped.** The only field is an asset identifier, and
 * a job without one will not grow one on the next attempt.
 *
 * **Anything else is rethrown**, so BullMQ retries with backoff. That is the
 * behaviour that matters here: the usual reason publication fails is that
 * Cloudflare Images did not answer, which is exactly the kind of thing that
 * works five minutes later.
 *
 * **Nothing is published while publication is paused** (FC-042). A paused
 * queue hands out no jobs, but the switch in the database is the authority:
 * a job that reaches here while it is on — Redis lost, say, and the queue
 * not yet paused again — puts the queue back in line and itself back for a
 * minute, unharmed.
 */
@Processor(FILE_ASSET_PUBLICATION_QUEUE)
export class AssetPublicationProcessor extends WorkerHost {
  private readonly _logger = new Logger(AssetPublicationProcessor.name);

  /**
   * Creates an instance of AssetPublicationProcessor.
   *
   * @param _publication - What publishes a cleared asset.
   * @param _pause - The publication pause.
   */
  constructor(
    private readonly _publication: AssetPublicationService,
    private readonly _pause: PublicationPauseService,
  ) {
    super();
  }

  /**
   * Handles one job.
   *
   * @param job - The job.
   * @param token - The lock this worker holds the job by.
   * @throws DelayedError when publication is paused, having put the job back.
   */
  async process(job: Job<unknown>, token?: string): Promise<void> {
    if (await this._pause.isPaused()) {
      this._logger.warn(
        `[process] Publication paused; job put back - JobId: ${job.id}`,
      );
      await this._pause.apply('processor');
      await job.moveToDelayed(
        Date.now() + PUBLICATION_PAUSED_RECHECK_MS,
        token,
      );

      throw new DelayedError();
    }

    const assetId = this.assetIdOf(job.data);

    if (assetId === null) {
      this._logger.error(
        `[process] Publication job rejected - JobId: ${job.id}`,
      );

      return;
    }

    await this._publication.publish(assetId);
  }

  /**
   * Reads the asset identifier out of a job.
   *
   * @param data - The job's payload.
   * @returns The asset identifier, or null when the job does not carry one.
   */
  private assetIdOf(data: unknown): string | null {
    if (typeof data !== 'object' || data === null) {
      return null;
    }

    const assetId = (data as { assetId?: unknown }).assetId;

    return typeof assetId === 'string' && assetId.length > 0 ? assetId : null;
  }
}
