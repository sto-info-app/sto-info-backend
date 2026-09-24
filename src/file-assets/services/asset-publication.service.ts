import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { ImageUploadsService } from 'src/shared/utilities/image-uploads.service';

import { readAssetPlacementDetail } from '../constants/asset-placement-detail.constants';
import { FileAssetPlacementEntity } from '../entities/file-asset-placement.entity';
import { FileAssetEntity } from '../entities/file-asset.entity';
import { FileAssetAudience } from '../enums/file-asset-audience.enum';
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
  | 'NO_BYTES'
  /**
   * The bytes in quarantine are not the ones the scanner cleared.
   *
   * Checked only where the bytes are read into records rather than handed to
   * an image library, because that is where a substituted object would
   * become data nobody could tell apart from the real thing.
   */
  | 'NOT_THESE_BYTES'
  /** The owning feature read the file and would not use it. */
  | 'REFUSED_BY_FEATURE'
  /** The owning feature read the file and is waiting on a decision. */
  | 'HELD_BY_FEATURE';

/** What publishing one asset did. */
export interface PublicationOutcome {
  /** Whether the asset is now in its slot. */
  readonly published: boolean;
  /** Why it is not, when it is not. */
  readonly refusal: PublicationRefusal | null;
  /**
   * How the delivery route addresses it, once it is published. Always null
   * for a restricted asset, which nothing delivers.
   */
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
 *
 * ## A restricted asset takes a different road from the same start
 *
 * A roster export is scanned and placed like a picture, and nobody is ever
 * served it. For an asset whose audience is `RESTRICTED` the sequence is:
 *
 * 1. **The bytes are read out of quarantine and checked against the hash the
 *    scanner cleared.** A picture goes to an image library that re-encodes
 *    it; a restricted file is read into records, where a substituted object
 *    would become data indistinguishable from the real thing.
 * 2. **The owning feature reads them into its own rows**, while the
 *    placement is still pending. Rows written against a pending placement are
 *    not in force, so an interruption here leaves nothing anybody can see;
 *    the retry calls the feature again, and the feature replaces what it
 *    wrote.
 * 3. **The asset is published and the placement activated.** The asset
 *    stays in quarantine storage with no delivery reference, and its bytes
 *    are kept: they are the evidence the rows were read from. A feature that
 *    keeps something up to date with what is in force is told inside the
 *    transaction that activates the placement, so both land or neither
 *    does.
 *
 * A feature that will not use the file refuses it. The placement is settled
 * as rejected, the asset refused with the feature's code, and the bytes
 * dropped — there is nothing left for them to be evidence of.
 *
 * A feature that needs somebody to decide first holds it. The placement is
 * held, the asset stays `CLEAN` and the bytes stay where they are, so a
 * retried job asks the feature again rather than resuming a publication
 * that never started, and nothing from the file is in force.
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
   * @param _dataSource - Opens the transaction a restricted placement is
   *   activated in.
   */
  constructor(
    private readonly _fileAssets: FileAssetService,
    private readonly _placements: FileAssetPlacementService,
    private readonly _publishers: AssetPublisherRegistry,
    private readonly _quarantine: QuarantineStorageService,
    private readonly _images: ImageUploadsService,
    private readonly _withdrawal: AssetWithdrawalService,
    private readonly _dataSource: DataSource,
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

    const restricted = asset.audience === FileAssetAudience.RESTRICTED;

    if (placement.state !== FileAssetPlacementState.PENDING) {
      // A restricted placement is never superseded, because each one is its
      // own record. One that is no longer pending is in force, held, refused
      // or swept, and in the first two cases its bytes are evidence and must
      // stay.
      if (!restricted) {
        await this.dropSupersededBytes(asset);
      }

      return this.refuse(assetId, 'NOT_PENDING');
    }

    return restricted
      ? this.placeRestricted(asset, placement)
      : this.place(asset, placement);
  }

  /**
   * Hands a restricted asset's bytes to the owning feature and puts the
   * placement into force when it accepts them.
   *
   * @param asset - The asset, clean or already published.
   * @param placement - The slot waiting for it.
   * @returns What publishing did.
   */
  private async placeRestricted(
    asset: FileAssetEntity,
    placement: FileAssetPlacementEntity,
  ): Promise<PublicationOutcome> {
    const publisher = this._publishers.requireRestricted(placement.subject);

    // An asset that is already published had its bytes accepted by the
    // feature on an earlier attempt, which was interrupted before the
    // placement was activated. Reading them again would only repeat work the
    // feature has already done.
    if (asset.state === FileAssetState.CLEAN) {
      const bytes = asset.objectKey === null ? null : await this.read(asset);

      if (bytes === null) {
        return this.refuse(asset.id, 'NO_BYTES');
      }

      if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
        bytes.fill(0);

        return this.refuse(asset.id, 'NOT_THESE_BYTES');
      }

      let receipt;

      try {
        receipt = await publisher.receive({
          subjectId: placement.subjectId,
          slot: placement.slot,
          assetId: asset.id,
          bytes,
          uploadedByUserId: asset.ownerUserId,
          detail: placement.detail,
        });
      } finally {
        bytes.fill(0);
      }

      if (receipt.outcome === 'HELD') {
        await this._placements.hold(placement);

        this._logger.log(
          `[placeRestricted] Restricted asset held - AssetId: ${asset.id}, ` +
            `Subject: ${placement.subject}, Reason: ${receipt.reason}`,
        );

        return this.refuse(asset.id, 'HELD_BY_FEATURE');
      }

      if (receipt.outcome === 'REFUSED') {
        await this._placements.settle(
          placement,
          FileAssetPlacementState.REJECTED,
        );
        await this._fileAssets.reject(asset.id, receipt.rejectionCode);
        await this.dropQuarantinedBytes(asset);

        return this.refuse(asset.id, 'REFUSED_BY_FEATURE');
      }

      await this._fileAssets.publish(asset.id);
    }

    await this._dataSource.transaction(async manager => {
      await this._placements.activate(placement, manager);
      await publisher.activated?.(placement.subjectId, manager);
    });

    this._logger.log(
      `[placeRestricted] Restricted asset in force - AssetId: ${asset.id}, ` +
        `Subject: ${placement.subject}, Slot: ${placement.slot}`,
    );

    return { published: true, refusal: null, deliveryReference: null };
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
