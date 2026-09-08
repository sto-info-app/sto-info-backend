import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { EntityManager, In, Repository } from 'typeorm';

import { ImageSlotService } from 'src/shared/images/image-slot.service';

import {
  CUSTOM_TRACKING_IMAGE_CLEANUP_ALARM_ATTEMPTS,
  CUSTOM_TRACKING_IMAGE_CLEANUP_BATCH,
} from '../constants/custom-tracking-retention.constants';
import { CustomTrackingImageCleanupEntity } from '../entities/custom-tracking-image-cleanup.entity';
import { CustomTrackingImageCleanupReason } from '../enums/custom-tracking-image-cleanup-reason.enum';
import {
  CustomTrackingImageCleanupSummary,
  CustomTrackingObservabilityService,
} from '../observability/custom-tracking-observability.service';

/** How long an error message is kept before it is cut short. */
const MAX_ERROR_LENGTH = 300;

/**
 * Getting rid of pictures the site has stopped pointing at.
 *
 * Deleting from Cloudflare is a network call, and a network call inside the
 * request that dropped the reference is a promise the site cannot keep: the
 * process can be recycled between the row being written and Cloudflare being
 * told, and afterwards nothing could work out that a picture had been left
 * behind, because the only thing that knew about it was the reference that was
 * just removed.
 *
 * So the intent is written down first, in the same transaction as the change
 * itself, and acted on afterwards. If the deletion succeeds the note is torn
 * up straight away and the queue is empty again, which is its normal state. If
 * it fails the note stays, and the nightly pass tries again.
 *
 * This is the reconciliation the plan calls for, arrived at from the other
 * end. Listing everything in the Cloudflare account and comparing it with the
 * database would also find orphans, but it would be a sweep whose correct
 * outcome is deleting things — and a bug in it deletes pictures people are
 * still looking at. This only ever deletes what the site itself recorded as
 * finished with.
 */
@Injectable()
export class CustomTrackingImageCleanupService {
  /**
   * Creates an instance of CustomTrackingImageCleanupService.
   *
   * @param _queueRepository - The queue of pictures to delete.
   * @param _images - Deletes them from Cloudflare.
   * @param _observability - Reports what the passes did.
   */
  constructor(
    @InjectRepository(CustomTrackingImageCleanupEntity)
    private readonly _queueRepository: Repository<CustomTrackingImageCleanupEntity>,
    private readonly _images: ImageSlotService,
    private readonly _observability: CustomTrackingObservabilityService,
  ) {}

  /**
   * Notes that some pictures are no longer pointed at.
   *
   * Written through the caller's transaction on purpose. Queueing has to
   * commit with the change that made it true, or a rolled-back deletion would
   * leave the site pointing at a picture it had promised to remove.
   *
   * @param manager - The transaction dropping the references.
   * @param imageIds - The pictures nothing will point at once it commits.
   * @param reason - What stopped the site pointing at them.
   */
  async enqueue(
    manager: EntityManager,
    imageIds: string[],
    reason: CustomTrackingImageCleanupReason,
  ): Promise<void> {
    if (imageIds.length === 0) {
      return;
    }

    await manager
      .createQueryBuilder()
      .insert()
      .into(CustomTrackingImageCleanupEntity)
      .values(
        imageIds.map(cloudflareImageId => ({ cloudflareImageId, reason })),
      )
      // The same picture can be queued twice by a replacement that was itself
      // retried. Queueing is meant to be safe to repeat.
      .orIgnore()
      .execute();
  }

  /**
   * Tries to delete some queued pictures now, rather than waiting for tonight.
   *
   * Called straight after the transaction that queued them commits. The common
   * case is that Cloudflare answers, the rows disappear, and the queue is
   * empty again before anything has had to look at it.
   *
   * @param imageIds - The pictures to attempt.
   */
  async flush(imageIds: string[]): Promise<void> {
    if (imageIds.length === 0) {
      return;
    }

    await this.drain(
      await this._queueRepository.find({
        where: { cloudflareImageId: In(imageIds) },
      }),
    );
  }

  /**
   * Works through the pictures still waiting to be deleted.
   *
   * Oldest first, and bounded, so a backlog drains steadily instead of turning
   * one night's job into an hour of network calls.
   *
   * @returns What the pass managed.
   */
  async reconcile(): Promise<CustomTrackingImageCleanupSummary> {
    const queued = await this._queueRepository.count();
    const pending = await this._queueRepository.find({
      order: { createdAt: 'ASC' },
      take: CUSTOM_TRACKING_IMAGE_CLEANUP_BATCH,
    });

    const { deleted, failed } = await this.drain(pending);
    const summary: CustomTrackingImageCleanupSummary = {
      queued,
      attempted: pending.length,
      deleted,
      failed,
    };

    this._observability.imagesReconciled(summary);

    return summary;
  }

  /**
   * Attempts each queued picture in turn.
   *
   * One at a time rather than all at once. These are deletions against a third
   * party that is already, by the time a backlog exists, either rate-limiting
   * us or unwell, and firing two hundred parallel requests at it is how a
   * recoverable problem becomes an unrecoverable one.
   *
   * @param rows - The queued pictures to attempt.
   * @returns How many went and how many did not.
   */
  private async drain(
    rows: CustomTrackingImageCleanupEntity[],
  ): Promise<{ deleted: number; failed: number }> {
    let deleted = 0;
    let failed = 0;

    for (const row of rows) {
      if (await this.attempt(row)) {
        deleted += 1;
      } else {
        failed += 1;
      }
    }

    return { deleted, failed };
  }

  /**
   * Attempts one queued picture.
   *
   * @param row - The queued picture.
   * @returns True when Cloudflare confirmed it has gone.
   */
  private async attempt(
    row: CustomTrackingImageCleanupEntity,
  ): Promise<boolean> {
    const outcome = await this._images.tryRelease(row.cloudflareImageId);

    if (outcome.released) {
      await this._queueRepository.delete({ id: row.id });

      return true;
    }

    const attempts = row.attempts + 1;

    await this._queueRepository.update(
      { id: row.id },
      {
        attempts,
        lastAttemptedAt: new Date(),
        lastError: outcome.error.slice(0, MAX_ERROR_LENGTH),
      },
    );

    if (attempts >= CUSTOM_TRACKING_IMAGE_CLEANUP_ALARM_ATTEMPTS) {
      this._observability.imageCleanupStuck(
        row.cloudflareImageId,
        row.reason,
        attempts,
      );
    }

    return false;
  }
}
