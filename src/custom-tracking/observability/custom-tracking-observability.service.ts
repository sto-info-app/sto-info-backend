import { Injectable, Logger } from '@nestjs/common';

import { CUSTOM_TRACKING_LIMITS } from '../constants/custom-tracking-limits.constants';
import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import { CustomTrackingImageCleanupReason } from '../enums/custom-tracking-image-cleanup-reason.enum';

/** The name of one of the ceilings a request can run into. */
export type CustomTrackingLimitName = keyof typeof CUSTOM_TRACKING_LIMITS;

/** What one sweep of the retention job removed. */
export interface CustomTrackingPurgeSummary {
  /** Sections removed for good. */
  sections: number;
  /** Tabs removed for good. */
  tabs: number;
  /** Fields removed for good. */
  fields: number;
  /** Options removed for good. */
  options: number;
  /** Answers removed for good. */
  values: number;
  /** Pictures queued for deletion from Cloudflare. */
  images: number;
  /**
   * Rows left in place because something retained still refers to them.
   *
   * Expected rather than exceptional: an option outlives its 180 days for as
   * long as any surviving answer selected it. Worth counting, because a number
   * that only ever grows means answers are being retained that should not be.
   */
  retained: number;
}

/** What one reconciliation pass did about the pictures waiting to be deleted. */
export interface CustomTrackingImageCleanupSummary {
  /** Pictures the pass tried to delete. */
  attempted: number;
  /** Pictures Cloudflare confirmed gone. */
  deleted: number;
  /** Pictures still queued after the pass. */
  failed: number;
  /** How many were queued in total when the pass began. */
  queued: number;
}

/**
 * What the site records about Custom Tracking going wrong.
 *
 * Every parameter here is an identifier, a count or a value from one of our
 * own enumerations. That is deliberate and it is the only thing making this
 * class worth having as a class: there is no parameter that could carry
 * something a user wrote, so no future edit can start logging somebody's notes
 * about themselves by accident. Content stays in the tables that have a
 * retention rule; logs get the shape of the problem.
 *
 * What is here that the site-wide HTTP log does not already give:
 *
 * - Which ceiling a request hit. A hundred refusals a minute is only legible
 *   as abuse if you can see they are all the same limit.
 * - Which type of Field failed validation. A single type failing everywhere is
 *   a bug in our own rules; many types failing for one member is somebody
 *   probing.
 * - What the cleanup jobs actually did. Nothing else reports on work that
 *   happens when no request is in flight.
 */
@Injectable()
export class CustomTrackingObservabilityService {
  private readonly _logger = new Logger('CustomTracking');

  /**
   * Records a request refused because a collection was full.
   *
   * @param userId - Whose request it was.
   * @param limitName - Which ceiling was reached.
   * @param used - How many they already had.
   */
  limitReached(
    userId: string,
    limitName: CustomTrackingLimitName,
    used: number,
  ): void {
    this._logger.warn(
      `[limit] Refused - Limit: ${limitName}, Used: ${used}, Allowed: ${CUSTOM_TRACKING_LIMITS[limitName]}, UserId: ${userId}`,
    );
  }

  /**
   * Records an answer refused by validation.
   *
   * The reason is not recorded. Every sentence validation produces names the
   * rule and some of them quote the configured bound, and none of that is
   * worth the risk of one of them one day quoting the value instead.
   *
   * @param userId - Whose answer it was.
   * @param fieldId - The Field being answered.
   * @param fieldType - What kind of Field it is.
   */
  valueRefused(
    userId: string,
    fieldId: string,
    fieldType: CustomTrackingFieldType,
  ): void {
    this._logger.warn(
      `[value] Refused - FieldType: ${fieldType}, FieldId: ${fieldId}, UserId: ${userId}`,
    );
  }

  /**
   * Records a picture that could not be stored.
   *
   * @param userId - Who was uploading.
   * @param fieldId - The Field being answered.
   * @param cause - The class of error, never its message.
   */
  uploadRefused(userId: string, fieldId: string, cause: string): void {
    this._logger.warn(
      `[image] Upload failed - Cause: ${cause}, FieldId: ${fieldId}, UserId: ${userId}`,
    );
  }

  /**
   * Records a picture left in Cloudflare because the upload's own transaction
   * did not commit.
   *
   * @param imageId - The picture nothing will ever point at.
   */
  uploadAbandoned(imageId: string): void {
    this._logger.warn(
      `[image] Abandoned upload queued for deletion - ImageId: ${imageId}`,
    );
  }

  /**
   * Records what the nightly retention sweep removed.
   *
   * @param summary - The counts.
   */
  retentionSwept(summary: CustomTrackingPurgeSummary): void {
    this._logger.log(
      `[retention] Swept - Sections: ${summary.sections}, Tabs: ${summary.tabs}, ` +
        `Fields: ${summary.fields}, Options: ${summary.options}, Values: ${summary.values}, ` +
        `Images: ${summary.images}, Retained: ${summary.retained}`,
    );
  }

  /**
   * Records what the nightly reconciliation did about queued pictures.
   *
   * @param summary - The counts.
   */
  imagesReconciled(summary: CustomTrackingImageCleanupSummary): void {
    this._logger.log(
      `[images] Reconciled - Queued: ${summary.queued}, Attempted: ${summary.attempted}, ` +
        `Deleted: ${summary.deleted}, Failed: ${summary.failed}`,
    );
  }

  /**
   * Records a queued picture that has failed too often to be a passing fault.
   *
   * @param imageId - The picture that will not delete.
   * @param reason - Why it was queued.
   * @param attempts - How many attempts have failed.
   */
  imageCleanupStuck(
    imageId: string,
    reason: CustomTrackingImageCleanupReason,
    attempts: number,
  ): void {
    this._logger.error(
      `[images] Deletion stuck - ImageId: ${imageId}, Reason: ${reason}, Attempts: ${attempts}`,
    );
  }
}
