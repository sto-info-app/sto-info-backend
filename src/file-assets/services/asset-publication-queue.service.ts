import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';

import { Queue } from 'bullmq';

import {
  FILE_ASSET_PUBLICATION_ATTEMPTS,
  FILE_ASSET_PUBLICATION_BACKOFF_MS,
  FILE_ASSET_PUBLICATION_JOB,
  FILE_ASSET_PUBLICATION_QUEUE,
} from '../constants/file-asset-publication.constants';

/**
 * Asks for a cleared asset to be published.
 *
 * A queue rather than a call, because publication is a conversation with
 * Cloudflare and the thing that triggers it is a verdict arriving off another
 * queue. Doing it inline would make a Cloudflare outage look like a scanning
 * failure, retry the verdict in order to retry an upload, and leave
 * `ScanVerdictService` — which ADR-0015 keeps deliberately narrow — holding
 * an image library's credentials.
 *
 * The job is keyed by the asset, so a verdict delivered twice enqueues one
 * job rather than two.
 */
@Injectable()
export class AssetPublicationQueueService {
  private readonly _logger = new Logger(AssetPublicationQueueService.name);

  /**
   * Creates an instance of AssetPublicationQueueService.
   *
   * @param _queue - The publication queue.
   */
  constructor(
    @InjectQueue(FILE_ASSET_PUBLICATION_QUEUE) private readonly _queue: Queue,
  ) {}

  /**
   * Queues one asset for publication.
   *
   * @param assetId - The asset, already `CLEAN`.
   */
  async enqueue(assetId: string): Promise<void> {
    await this._queue.add(
      FILE_ASSET_PUBLICATION_JOB,
      { assetId },
      {
        jobId: assetId,
        attempts: FILE_ASSET_PUBLICATION_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: FILE_ASSET_PUBLICATION_BACKOFF_MS,
        },
        removeOnComplete: true,
        // Kept, because a publication that ran out of attempts is an asset
        // somebody uploaded and cannot see, and the only trace of it would
        // otherwise be a log line.
        removeOnFail: false,
      },
    );

    this._logger.log(`[enqueue] Publication queued - AssetId: ${assetId}`);
  }
}
