import { Injectable, Logger } from '@nestjs/common';

import { ImageUploadsService } from 'src/shared/utilities/image-uploads.service';

import { FileAssetPlacementState } from '../enums/file-asset-placement-state.enum';
import { FileAssetSlot } from '../enums/file-asset-slot.enum';
import { FileAssetState } from '../enums/file-asset-state.enum';
import { FileAssetSubject } from '../enums/file-asset-subject.enum';
import { FileAssetPlacementService } from './file-asset-placement.service';
import { FileAssetService } from './file-asset.service';

/** What became of an attempt to take a picture down. */
export interface WithdrawalOutcome {
  /** Whether Cloudflare agreed the image has gone. */
  readonly deleted: boolean;
  /** Whether a registry row was moved to `REVOKED`. */
  readonly revoked: boolean;
}

/**
 * Taking a published picture down.
 *
 * The other direction from publication, and it has to do more than delete an
 * image. ADR-0016 records that a Cloudflare Images object is reachable at
 * nine variants on two hostnames, that no purge of the custom domain touches
 * the second of them, and that withdrawing it therefore has to be a delete
 * rather than a cache operation. It also records that the database write and
 * the delete are tracked separately, because the interval between them is
 * the window in which the bytes are still out there.
 *
 * So: revoke the row, which is what `purgeRequiredAt` records as owed;
 * delete the object, which is what actually stops the nine variants; and
 * only then confirm the purge. A delete that fails leaves the asset revoked
 * with a purge outstanding, which is a state W10 can find and act on rather
 * than a failure nobody hears about.
 *
 * **Legacy images go through here too.** An estate row is `UNVERIFIED` and
 * still served, and the backfill gave it the same delivery reference the
 * page holds, so deleting a profile picture uploaded three years ago
 * withdraws its asset exactly as a new one would.
 */
@Injectable()
export class AssetWithdrawalService {
  private readonly _logger = new Logger(AssetWithdrawalService.name);

  /**
   * Creates an instance of AssetWithdrawalService.
   *
   * @param _fileAssets - The asset registry.
   * @param _placements - Which picture is in which slot.
   * @param _images - Cloudflare Images.
   */
  constructor(
    private readonly _fileAssets: FileAssetService,
    private readonly _placements: FileAssetPlacementService,
    private readonly _images: ImageUploadsService,
  ) {}

  /**
   * Withdraws the picture a delivery reference addresses.
   *
   * @param deliveryReference - The identifier the record held.
   * @param reason - The administrator-only reason.
   * @returns What happened to the object and to the row.
   */
  async withdrawByReference(
    deliveryReference: string,
    reason: string,
  ): Promise<WithdrawalOutcome> {
    const asset =
      await this._fileAssets.findByDeliveryReference(deliveryReference);

    let revoked = false;

    if (asset !== null && this.isWithdrawable(asset.state)) {
      await this._fileAssets.revoke(asset.id, reason);
      revoked = true;
    }

    if (asset === null) {
      // A reference the estate backfill never saw. Deleting the object is
      // still right; the log line is the only record that the site was
      // serving something with no row behind it.
      this._logger.warn(
        `[withdrawByReference] No asset for a delivered image - ` +
          `Reference: ${deliveryReference}`,
      );
    }

    const deleted = await this.deleteFromCloudflare(deliveryReference);

    if (deleted && revoked && asset !== null) {
      const purged = await this._fileAssets.findById(asset.id);

      if (purged !== null && purged.purgeRequiredAt !== null) {
        await this._fileAssets.confirmPurged(asset.id);
      }
    }

    return { deleted, revoked };
  }

  /**
   * Empties a slot, withdrawing whatever was in it.
   *
   * The placement is settled whether or not the object could be deleted: as
   * far as the site is concerned the slot is empty the moment the owning
   * record stops pointing at the picture, and the outstanding purge is
   * tracked on the asset rather than by leaving a placement active.
   *
   * @param subject - The kind of record.
   * @param subjectId - Which record.
   * @param slot - Which picture of it.
   * @param deliveryReference - What the record held, when it held anything.
   * @param reason - The administrator-only reason.
   * @returns What happened to the object and to the row.
   */
  async withdrawSlot(
    subject: FileAssetSubject,
    subjectId: string,
    slot: FileAssetSlot,
    deliveryReference: string | null,
    reason: string,
  ): Promise<WithdrawalOutcome> {
    const placement = await this._placements.findActiveForSlot(
      subject,
      subjectId,
      slot,
    );

    if (placement !== null) {
      await this._placements.settle(
        placement,
        FileAssetPlacementState.WITHDRAWN,
      );
    }

    if (deliveryReference === null) {
      return { deleted: false, revoked: false };
    }

    return this.withdrawByReference(deliveryReference, reason);
  }

  /**
   * Reports whether an asset is in a state a withdrawal may move it from.
   *
   * `UNVERIFIED` is here because the estate is served from it. Anything
   * already rejected, revoked or deleted is left alone: it has been
   * withdrawn once and a second withdrawal would rewrite when that happened.
   *
   * @param state - The state.
   * @returns True when it may be revoked.
   */
  private isWithdrawable(state: FileAssetState): boolean {
    return (
      state === FileAssetState.AVAILABLE || state === FileAssetState.UNVERIFIED
    );
  }

  /**
   * Deletes an image from Cloudflare, reporting rather than throwing.
   *
   * A failure must not fail the request. The record has already stopped
   * pointing at the picture by the time this runs, so what the reader sees
   * is already correct, and the outstanding purge is recorded on the row.
   *
   * @param deliveryReference - The image identifier.
   * @returns True when Cloudflare agreed it has gone.
   */
  private async deleteFromCloudflare(
    deliveryReference: string,
  ): Promise<boolean> {
    try {
      await this._images.deleteImageFromCloudflareImages(deliveryReference);

      return true;
    } catch (error: unknown) {
      this._logger.error(
        `[deleteFromCloudflare] Could not delete - ` +
          `Reference: ${deliveryReference}, ` +
          `Reason: ${error instanceof Error ? error.message : 'unknown'}`,
      );

      return false;
    }
  }
}
