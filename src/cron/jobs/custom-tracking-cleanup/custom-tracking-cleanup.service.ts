import { Injectable, Logger } from '@nestjs/common';

import { CUSTOM_TRACKING_RETENTION_DAYS } from 'src/custom-tracking/constants/custom-tracking-retention.constants';
import { CustomTrackingObservabilityService } from 'src/custom-tracking/observability/custom-tracking-observability.service';
import { CustomTrackingImageCleanupService } from 'src/custom-tracking/retention/custom-tracking-image-cleanup.service';
import { CustomTrackingPurgeService } from 'src/custom-tracking/retention/custom-tracking-purge.service';

@Injectable()
export class CustomTrackingCleanupService {
  private readonly _logger = new Logger(CustomTrackingCleanupService.name);

  /**
   * Creates an instance of CustomTrackingCleanupService.
   *
   * @param _purge - Removes expired definitions and answers.
   * @param _imageCleanup - Drains the queue of pictures to delete.
   * @param _observability - Reports what the sweep removed.
   */
  constructor(
    private readonly _purge: CustomTrackingPurgeService,
    private readonly _imageCleanup: CustomTrackingImageCleanupService,
    private readonly _observability: CustomTrackingObservabilityService,
  ) {}

  /**
   * Removes Custom Tracking data whose retention period has run out, and then
   * deletes the pictures that leaves behind.
   *
   * In that order, and both in the same job. The sweep queues pictures for
   * deletion rather than deleting them, because it holds a transaction and a
   * call to Cloudflare inside one is a way to hold a lock for as long as a
   * third party feels like taking. Draining the queue immediately afterwards
   * is what turns that separation from a delay into an implementation detail.
   *
   * The drain also picks up anything queued by the account-closure job, by
   * failed uploads and by ordinary replacements that Cloudflare refused during
   * the day. That is the reconciliation: not a comparison against the whole
   * image store, but a queue of everything the site itself knows it has
   * finished with, worked until it is empty.
   */
  async cleanup(): Promise<void> {
    const threshold = new Date();

    threshold.setDate(threshold.getDate() - CUSTOM_TRACKING_RETENTION_DAYS);

    this._logger.log(
      `Removing custom tracking data deleted before ${threshold.toISOString()}.`,
    );

    this._observability.retentionSwept(
      await this._purge.purgeExpired(threshold),
    );

    await this._imageCleanup.reconcile();
  }
}
