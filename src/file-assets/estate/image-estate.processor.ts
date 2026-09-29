import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';

import { Job } from 'bullmq';

import {
  IMAGE_ESTATE_BATCH_JOB,
  IMAGE_ESTATE_QUEUE,
  IMAGE_INVENTORY_JOB,
} from './image-estate.constants';
import { ImageEstateService } from './image-estate.service';
import { ImageInventoryService } from './image-inventory.service';

/**
 * Runs the image estate's inventories and batches (FC-040).
 *
 * Thin: a job carries an ID and nothing else, and every decision is made
 * against the database as it stands. A batch reads its run's state first,
 * so a pause stops the next batch and a duplicate delivery does nothing.
 */
@Processor(IMAGE_ESTATE_QUEUE)
export class ImageEstateProcessor extends WorkerHost {
  private readonly _logger = new Logger(ImageEstateProcessor.name);

  /**
   * Creates an instance of ImageEstateProcessor.
   *
   * @param _estate - The runs.
   * @param _inventory - The inventory.
   */
  constructor(
    private readonly _estate: ImageEstateService,
    private readonly _inventory: ImageInventoryService,
  ) {
    super();
  }

  /**
   * Handles one job.
   *
   * @param job - The job.
   */
  async process(job: Job<unknown>): Promise<void> {
    const data = (job.data ?? {}) as { runId?: unknown; inventoryId?: unknown };

    if (job.name === IMAGE_ESTATE_BATCH_JOB && typeof data.runId === 'string') {
      await this._estate.processBatch(data.runId);

      return;
    }

    if (
      job.name === IMAGE_INVENTORY_JOB &&
      typeof data.inventoryId === 'string'
    ) {
      await this._inventory.run(data.inventoryId);

      return;
    }

    this._logger.error(`[process] Job rejected - JobId: ${job.id}`);
  }
}
