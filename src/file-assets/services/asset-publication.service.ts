import { Injectable, Logger } from '@nestjs/common';

import { ImageUploadsService } from 'src/shared/utilities/image-uploads.service';

import { readAssetPlacementDetail } from '../constants/asset-placement-detail.constants';
import { FileAssetPlacementEntity } from '../entities/file-asset-placement.entity';
import { FileAssetEntity } from '../entities/file-asset.entity';
import { FileAssetPlacementState } from '../enums/file-asset-placement-state.enum';
import { FileAssetState } from '../enums/file-asset-state.enum';
import { FileAssetStorage } from '../enums/file-asset-storage.enum';
import { AssetPublisherRegistry } from './asset-publisher.registry';
import { AssetWithdrawalService } from './asset-withdrawal.service';
import { FileAssetPlacementService } from './file-asset-placement.service';
import { FileAssetService } from './file-asset.service';
import { QuarantineStorageService } from './quarantine-storage.service';

/** Why an asset was not published. */
export type PublicationRefusal =
  /** No such asset. */
  | 'NO_SUCH_ASSET'
  /** The asset is not waiting to be published. */
  | 'NOT_PUBLISHABLE'
  /** Nothing is waiting for it: no slot was ever claimed. */
  | 'NOT_PLACED'
  /** The slot moved on while the scanner was working. */
  | 'NOT_PENDING'
  /** The bytes are not where the registry says they are. */
  | 'NO_BYTES';

/** What publishing one asset did. */
export interface PublicationOutcome {
  /** Whether the picture is now in its slot. */
  readonly published: boolean;
  /** Why it is not, when it is not. */
  readonly refusal: PublicationRefusal | null;
  /** How the delivery route addresses it, once it is published. */
  readonly deliveryReference: string | null;
}

/**
 * Turns a cleared asset into a picture on a page.
 *
 * The step ADR-0015 deliberately left to a caller. A scanner says bytes are
 * clean; this says they are an image of an allowed type, that a slot is still
 * waiting for them, that the record they belong to still exists, and only
 * then that they may be served — which is the difference between `CLEAN` and
 * `AVAILABLE` and the reason the two are separate calls.
 *
 * The sequence is ordered so that every interruption leaves something safe.
 *
 * 1. **The picture goes to Cloudflare Images before anything is published.**
 *    A failure here leaves the asset `CLEAN` and the slot pending, which the
 *    job retries and the nightly sweep eventually abandons.
 * 2. **The asset is published before the record is pointed at it**, so the
 *    third acceptance criterion holds in the only order that can satisfy it:
 *    no reference changes until the registry says the bytes may be served.
 *    An interruption between the two leaves a published asset nothing points
 *    at, and the retry picks it up from there — which is why an `AVAILABLE`
 *    asset whose placement is still pending is resumed rather than refused.
 * 3. **What was there before is withdrawn last.** Until that write, the old
 *    picture is still published and still being served, which is exactly
 *    what should happen if this fails: a replacement that goes wrong leaves
 *    the previous image in place.
 *
 * **A superseded upload publishes nothing.** Somebody who uploads twice gets
 * the second picture, so a verdict arriving for the first finds a placement
 * that is no longer pending, drops the bytes and stops.
 *
 * The one window this leaves is between the slot being activated and the
 * record being pointed at the picture: a crash there leaves an `AVAILABLE`
 * asset the record does not show, and the retry refuses it because the
 * placement is no longer pending. That is the safe way round — the reader
 * keeps the picture they had — and the alternative order would have a retry
 * withdraw the picture it had just published.
 */
@Injectable()
export class AssetPublicationService {
  private readonly _logger = new Logger(AssetPublicationService.name);

  /**
   * Creates an instance of AssetPublicationService.
   *
   * @param _fileAssets - The asset registry.
   * @param _placements - Which picture is in which slot.
   * @param _publishers - What writes each feature's own row.
   * @param _quarantine - The private bucket.
   * @param _images - Cloudflare Images.
   * @param _withdrawal - What takes a published picture down.
   */
  constructor(
    private readonly _fileAssets: FileAssetService,
    private readonly _placements: FileAssetPlacementService,
    private readonly _publishers: AssetPublisherRegistry,
    private readonly _quarantine: QuarantineStorageService,
    private readonly _images: ImageUploadsService,
    private readonly _withdrawal: AssetWithdrawalService,
  ) {}

  /**
   * Publishes one cleared asset into the slot that is waiting for it.
   *
   * @param assetId - The asset.
   * @returns Whether the picture is in its slot, and why not when it is not.
   */
  async publish(assetId: string): Promise<PublicationOutcome> {
    const asset = await this._fileAssets.findById(assetId);

    if (asset === null) {
      return this.refuse(assetId, 'NO_SUCH_ASSET');
    }

    if (
      asset.state !== FileAssetState.CLEAN &&
      asset.state !== FileAssetState.AVAILABLE
    ) {
      return this.refuse(assetId, 'NOT_PUBLISHABLE');
    }

    const placement = await this._placements.findByAssetId(assetId);

    if (placement === null) {
      return this.refuse(assetId, 'NOT_PLACED');
    }

    if (placement.state !== FileAssetPlacementState.PENDING) {
      await this.dropSupersededBytes(asset);

      return this.refuse(assetId, 'NOT_PENDING');
    }

    return this.place(asset, placement);
  }

  /**
   * Publishes the bytes and hands the reference to the owning feature.
   *
   * @param asset - The asset, clean or already published.
   * @param placement - The slot waiting for it.
   * @returns What publishing did.
   */
  private async place(
    asset: FileAssetEntity,
    placement: FileAssetPlacementEntity,
  ): Promise<PublicationOutcome> {
    const publisher = this._publishers.require(placement.subject);
    const detail = readAssetPlacementDetail(placement.detail);

    const deliveryReference =
      asset.deliveryReference ?? (await this.sendToCloudflare(asset, detail));

    if (deliveryReference === null) {
      return this.refuse(asset.id, 'NO_BYTES');
    }

    if (asset.state === FileAssetState.CLEAN) {
      await this._fileAssets.publish(
        asset.id,
        FileAssetStorage.PUBLIC_IMAGES,
        deliveryReference,
      );
    }

    await this._placements.activate(placement);

    const previousReference = await publisher.attach({
      subjectId: placement.subjectId,
      slot: placement.slot,
      deliveryReference,
      uploadedByUserId: asset.ownerUserId,
      detail: detail?.feature ?? null,
    });

    await this.withdrawPrevious(previousReference);
    await this.dropQuarantinedBytes(asset);

    this._logger.log(
      `[place] Picture published - AssetId: ${asset.id}, ` +
        `Subject: ${placement.subject}, Slot: ${placement.slot}, ` +
        `Replaced: ${previousReference ?? 'none'}`,
    );

    return { published: true, refusal: null, deliveryReference };
  }

  /**
   * Sends the quarantined bytes to Cloudflare Images.
   *
   * @param asset - The asset.
   * @param detail - What the placement kept for Cloudflare's bookkeeping.
   * @returns The new image identifier, or null when the bytes have gone.
   */
  private async sendToCloudflare(
    asset: FileAssetEntity,
    detail: { entityTag: string; entityId: string } | null,
  ): Promise<string | null> {
    if (asset.objectKey === null) {
      return null;
    }

    const bytes = await this.read(asset);

    if (bytes === null) {
      return null;
    }

    return this._images.publishImageToCloudflareImages({
      userId: asset.ownerUserId,
      buffer: bytes,
      filename: asset.originalFilename,
      contentType: asset.detectedContentType ?? asset.declaredContentType,
      entityType: detail?.entityTag ?? null,
      entityId: detail?.entityId ?? null,
    });
  }

  /**
   * Reads an asset's bytes out of quarantine.
   *
   * A missing object is not an error to retry. The nightly sweep and a
   * superseding upload both delete quarantined bytes, so the honest reading
   * of an absent object is that this upload was already abandoned.
   *
   * @param asset - The asset.
   * @returns The bytes, or null when the object has gone.
   */
  private async read(asset: FileAssetEntity): Promise<Buffer | null> {
    try {
      const stream = await this._quarantine.getStream(
        asset.objectKey as string,
        asset.objectVersion,
      );

      const chunks: Buffer[] = [];

      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk as Buffer));
      }

      return Buffer.concat(chunks);
    } catch (error: unknown) {
      this._logger.error(
        `[read] Quarantined bytes could not be read - AssetId: ${asset.id}, ` +
          `Reason: ${error instanceof Error ? error.message : 'unknown'}`,
      );

      return null;
    }
  }

  /**
   * Withdraws the picture a slot was showing before.
   *
   * Driven by what the owning row actually held rather than by the registry,
   * because the row is the thing a reader was being served from. A record
   * that held nothing replaced nothing, whatever the placements say.
   *
   * Every step of it is survivable, and the one that matters is the last: a
   * Cloudflare delete that fails leaves `purgeRequiredAt` set and `purgedAt`
   * null, which is precisely the state ADR-0016 invented so that an
   * outstanding purge is visible rather than assumed.
   *
   * @param previousReference - What the record pointed at before.
   */
  private async withdrawPrevious(
    previousReference: string | null,
  ): Promise<void> {
    if (previousReference === null) {
      return;
    }

    await this._withdrawal.withdrawByReference(
      previousReference,
      'Replaced by a new upload',
    );
  }

  /**
   * Drops the bytes of an upload that lost its slot.
   *
   * @param asset - The asset.
   */
  private async dropSupersededBytes(asset: FileAssetEntity): Promise<void> {
    await this.dropQuarantinedBytes(asset);

    if (asset.state === FileAssetState.CLEAN) {
      await this._fileAssets.discard(asset.id, 'Superseded before publication');
    }
  }

  /**
   * Removes an asset's object from quarantine, reporting rather than throwing.
   *
   * Published bytes live in Cloudflare Images from here on. Keeping the
   * quarantined copy would mean holding two of every picture the site shows,
   * permanently, including ones a person later deletes.
   *
   * @param asset - The asset.
   */
  private async dropQuarantinedBytes(asset: FileAssetEntity): Promise<void> {
    if (asset.objectKey === null) {
      return;
    }

    try {
      await this._quarantine.remove(asset.objectKey);
    } catch (error: unknown) {
      this._logger.error(
        `[dropQuarantinedBytes] Could not remove - AssetId: ${asset.id}, ` +
          `Reason: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  /**
   * Records that an asset was not published.
   *
   * At `log` rather than `warn`. Every refusal here is an ordinary
   * consequence of a queue that delivers at least once and of people who
   * upload twice.
   *
   * @param assetId - The asset.
   * @param refusal - Why it was not published.
   * @returns The outcome.
   */
  private refuse(
    assetId: string,
    refusal: PublicationRefusal,
  ): PublicationOutcome {
    this._logger.log(
      `[publish] Not published - AssetId: ${assetId}, Reason: ${refusal}`,
    );

    return { published: false, refusal, deliveryReference: null };
  }
}
