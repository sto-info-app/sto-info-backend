import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';

import { Job } from 'bullmq';

import { AssetPublicationQueueService } from 'src/file-assets/services/asset-publication-queue.service';

import {
  FILE_SCAN_VERDICT_QUEUE,
  FileScanContractError,
  parseScanVerdictMessage,
} from '../contract/file-scan-contract';
import { ScanVerdictService } from '../services/scan-verdict.service';

/**
 * Takes verdicts off the queue.
 *
 * The one place in the backend that reads anything the worker wrote, and it
 * treats it as what it is: a message from another process, parsed against
 * the contract before a single field is touched. The worker is trusted to
 * run a scanner, not to send well-formed messages.
 *
 * A message that violates the contract is dropped rather than retried, for
 * the same reason the worker drops one: it will violate it identically every
 * time, and the asset stays in `SCANNING`, which is not serveable. Anything
 * else is rethrown so BullMQ retries and then keeps the job visible in its
 * failed set.
 *
 * **A clean verdict is followed by a request to publish, not by publication.**
 * The asset reaches `CLEAN` here and a job on another queue takes it the rest
 * of the way — FC-012. Publishing inline would put an image library's
 * availability on the verdict queue's critical path and would give
 * {@link ScanVerdictService}, which ADR-0015 keeps deliberately narrow, a
 * second job. What is enqueued is an asset identifier; everything else is
 * decided against the registry when the job runs.
 */
@Processor(FILE_SCAN_VERDICT_QUEUE)
export class ScanVerdictProcessor extends WorkerHost {
  private readonly _logger = new Logger(ScanVerdictProcessor.name);

  /**
   * Creates an instance of ScanVerdictProcessor.
   *
   * @param _scanVerdictService - What acts on a verdict.
   * @param _publication - The publication queue.
   */
  constructor(
    private readonly _scanVerdictService: ScanVerdictService,
    private readonly _publication: AssetPublicationQueueService,
  ) {
    super();
  }

  /**
   * Handles one job.
   *
   * @param job - The job.
   */
  async process(job: Job<unknown>): Promise<void> {
    let verdict;

    try {
      verdict = parseScanVerdictMessage(job.data);
    } catch (error) {
      if (error instanceof FileScanContractError) {
        this._logger.error(
          `[process] Verdict rejected - JobId: ${job.id}, ` +
            `Field: ${error.field}`,
        );

        return;
      }

      throw error;
    }

    const outcome = await this._scanVerdictService.apply(verdict);

    if (outcome.applied && verdict.outcome === 'CLEAN') {
      await this._publication.enqueue(verdict.assetId);
    }
  }
}
