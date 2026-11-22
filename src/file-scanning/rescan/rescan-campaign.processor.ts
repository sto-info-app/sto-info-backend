import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { Job } from 'bullmq';

import { CRON_TIMEZONE } from 'src/cron/constants/cron.constants';

import { RescanCampaignService } from './rescan-campaign.service';
import { RESCAN_BATCH_JOB, RESCAN_CAMPAIGN_QUEUE } from './rescan.constants';

/**
 * Runs rescan campaign batches (FC-041). A job carries a campaign ID and
 * nothing else; the batch reads the campaign's state first, so a pause or
 * a cancellation stops the next one.
 */
@Processor(RESCAN_CAMPAIGN_QUEUE)
export class RescanCampaignProcessor extends WorkerHost {
  private readonly _logger = new Logger(RescanCampaignProcessor.name);

  /**
   * Creates an instance of RescanCampaignProcessor.
   *
   * @param _campaigns - The campaigns.
   */
  constructor(private readonly _campaigns: RescanCampaignService) {
    super();
  }

  /**
   * Handles one job.
   *
   * @param job - The job.
   */
  async process(job: Job<unknown>): Promise<void> {
    const campaignId = (job.data as { campaignId?: unknown } | null)
      ?.campaignId;

    if (job.name !== RESCAN_BATCH_JOB || typeof campaignId !== 'string') {
      this._logger.error(`[process] Job rejected - JobId: ${job.id}`);

      return;
    }

    await this._campaigns.processBatch(campaignId);
  }
}

/**
 * The campaigns' daily round (FC-041): the legacy campaign, once, after
 * release; and rescans that never got a verdict, given up so another
 * campaign may try them.
 */
@Injectable()
export class RescanScheduler {
  private readonly _logger = new Logger(RescanScheduler.name);

  /**
   * Creates an instance of RescanScheduler.
   *
   * @param _campaigns - The campaigns.
   */
  constructor(private readonly _campaigns: RescanCampaignService) {}

  /**
   * Runs the round. A failure is logged and left for tomorrow.
   */
  @Cron('41 4 * * *', { timeZone: CRON_TIMEZONE })
  async run(): Promise<void> {
    try {
      await this._campaigns.startLegacyOnce();
      await this._campaigns.sweepStale();
    } catch (error: unknown) {
      this._logger.error(
        `[run] Rescan round failed - Reason: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}
