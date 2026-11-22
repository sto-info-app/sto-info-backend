import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { ScanRequestProducerService } from 'src/file-scanning/services/scan-request-producer.service';
import { FleetAudience } from 'src/fleet/enums/fleet-audience.enum';

import {
  AssetScanStatus,
  assetScanStatusOf,
} from '../constants/asset-scan-status.constants';
import { FileAssetPlacementEntity } from '../entities/file-asset-placement.entity';
import { FileAssetAudience } from '../enums/file-asset-audience.enum';
import { FileAssetKind } from '../enums/file-asset-kind.enum';
import { FileAssetSlot } from '../enums/file-asset-slot.enum';
import { FileAssetSubject } from '../enums/file-asset-subject.enum';
import { AssetPublisherRegistry } from './asset-publisher.registry';
import { FileAssetPlacementService } from './file-asset-placement.service';
import { FileAssetService } from './file-asset.service';
import { QuarantineStorageService } from './quarantine-storage.service';

/** One upload, on its way to one slot. */
export interface AssetIngressRequest {
  /** What the asset is. */
  readonly kind: FileAssetKind;
  /** Who may see it once it is published. */
  readonly audience: FileAssetAudience;
  /** The kind of record it belongs to. */
  readonly subject: FileAssetSubject;
  /** Which record of that kind. */
  readonly subjectId: string;
  /** Which picture of that record. */
  readonly slot: FileAssetSlot;
  /** The person uploading. */
  readonly ownerUserId: string;
  /** The owning Community, when the audience is scoped to one. */
  readonly communityId?: string | null;
  /** The owning Fleet, when the audience is scoped to one. */
  readonly fleetId?: string | null;
  /** The owning Armada, when the audience is scoped to one. */
  readonly armadaId?: string | null;
  /** Which of the scope's audiences applies, when the audience is scoped. */
  readonly scopeAudience?: FleetAudience | null;
  /** The bytes. */
  readonly bytes: Buffer;
  /** What the browser claimed the file was. Recorded, never believed. */
  readonly declaredContentType: string | null;
  /** What reading the bytes found it to be. */
  readonly detectedContentType: string;
  /** The filename as uploaded. */
  readonly originalFilename: string | null;
  /** What kind of thing this is, as Cloudflare records it. */
  readonly entityTag: string;
  /** What it belongs to, as Cloudflare records it. */
  readonly entityId: string;
  /** Whatever the owning feature will need back at publication. */
  readonly feature?: Record<string, unknown> | null;
}

/** What the uploader is told, and nothing else. */
export interface AcceptedAsset {
  /** The asset to ask about. */
  readonly assetId: string;
  /** How far along it is. */
  readonly status: AssetScanStatus;
}

/**
 * Takes an upload as far as a scanner, and no further.
 *
 * The single route from a request holding bytes to an asset in the registry.
 * Every picture the site accepts comes through here — a profile picture, a
 * Character portrait, seven kinds of Storytime artwork, a Custom Tracking
 * answer and, when FC-013 adds the surfaces, a Fleet emblem — which is the
 * whole of the first acceptance criterion: not ten callers each remembering
 * to register an asset, but one function they cannot get to the bucket
 * without.
 *
 * It is modelled on `RosterImportIngressService`, which did the same job for
 * a sanitised CSV in FC-009, and the order is the same and for the same
 * reasons.
 *
 * **The row comes before the bytes.** An upload interrupted halfway leaves a
 * record of an object that may exist; an object in the bucket with no row is
 * the one thing no inventory can find.
 *
 * **The slot is claimed before the scan is requested.** A crash between the
 * two leaves an asset quarantined with nothing scanning it, which the sweep
 * clears up. The other order would leave a scanned asset with nowhere to go.
 *
 * **Nothing here decides whether the bytes are acceptable.** The slot rules
 * — the shape, the dimensions, the encoding, the ceiling on size — are the
 * uploading feature's, applied before this is called, so a wrong-shaped crop
 * is still a refusal the person reads immediately rather than a state they
 * discover a minute later.
 */
@Injectable()
export class AssetIngressService {
  private readonly _logger = new Logger(AssetIngressService.name);

  /**
   * Creates an instance of AssetIngressService.
   *
   * @param _fileAssets - The asset registry.
   * @param _placements - Which picture is in which slot.
   * @param _publishers - What writes each feature's own row.
   * @param _quarantine - The private bucket.
   * @param _scanRequests - The scan request queue.
   */
  constructor(
    private readonly _fileAssets: FileAssetService,
    private readonly _placements: FileAssetPlacementService,
    private readonly _publishers: AssetPublisherRegistry,
    private readonly _quarantine: QuarantineStorageService,
    private readonly _scanRequests: ScanRequestProducerService,
  ) {}

  /**
   * Registers an upload, quarantines it and asks for it to be scanned.
   *
   * @param request - The upload.
   * @returns The asset to ask about, and how far along it is.
   * @throws InternalServerErrorException when nothing could publish the
   *   asset even if it were cleared.
   */
  async accept(request: AssetIngressRequest): Promise<AcceptedAsset> {
    // Asked here rather than at publication. A subject with no publisher is
    // a wiring mistake, and the difference between finding it in a failing
    // upload and finding it in an asset stuck at CLEAN an hour later is
    // whether anybody can tell what went wrong.
    this._publishers.require(request.subject);

    const sha256 = createHash('sha256').update(request.bytes).digest('hex');

    const asset = await this._fileAssets.register({
      kind: request.kind,
      audience: request.audience,
      ownerUserId: request.ownerUserId,
      communityId: request.communityId ?? null,
      fleetId: request.fleetId ?? null,
      armadaId: request.armadaId ?? null,
      scopeAudience: request.scopeAudience ?? null,
      declaredContentType: request.declaredContentType,
      originalFilename: request.originalFilename,
    });

    const objectKey = this._quarantine.buildObjectKey(asset.id);
    const stored = await this._quarantine.put(objectKey, request.bytes);

    const quarantined = await this._fileAssets.recordStored(asset.id, {
      objectKey: stored.objectKey,
      objectVersion: stored.objectVersion,
      sha256,
      byteSize: request.bytes.length,
      detectedContentType: request.detectedContentType,
    });

    const { superseded } = await this._placements.placePending({
      assetId: asset.id,
      subject: request.subject,
      subjectId: request.subjectId,
      slot: request.slot,
      detail: {
        entityTag: request.entityTag,
        entityId: request.entityId,
        feature: request.feature ?? null,
      },
    });

    await this.abandon(superseded);

    const scanning = await this._scanRequests.requestScan(quarantined);

    this._logger.log(
      `[accept] Upload quarantined - AssetId: ${asset.id}, ` +
        `Kind: ${request.kind}, Subject: ${request.subject}, ` +
        `Slot: ${request.slot}, Bytes: ${request.bytes.length}, ` +
        `TraceId: ${scanning.traceId}`,
    );

    return {
      assetId: asset.id,
      status: assetScanStatusOf(scanning.asset.state),
    };
  }

  /**
   * Gives up on an upload a newer one overtook.
   *
   * Done at once rather than left for the verdict, because the bytes are of
   * no use to anybody from this moment: no slot is waiting for them and
   * nothing will ever publish them. A scanner part-way through reading the
   * object finds it gone and reports a fault, and the verdict that follows
   * is refused because the asset is no longer scanning — which is the
   * correct outcome reached by three independent routes.
   *
   * Failures are logged and swallowed. The new upload is not the old one's
   * business, and refusing somebody's portrait because a previous attempt
   * could not be tidied away would be absurd.
   *
   * @param superseded - The placement that lost the slot, when there was one.
   */
  private async abandon(
    superseded: FileAssetPlacementEntity | null,
  ): Promise<void> {
    if (superseded === null) {
      return;
    }

    try {
      const asset = await this._fileAssets.findById(superseded.assetId);

      if (asset === null) {
        return;
      }

      if (asset.objectKey !== null) {
        await this._quarantine.remove(asset.objectKey);
      }

      await this._fileAssets.discard(asset.id, 'Superseded by a later upload');
    } catch (error: unknown) {
      this._logger.error(
        `[abandon] Could not abandon a superseded upload - ` +
          `PlacementId: ${superseded.id}, ` +
          `Reason: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}
