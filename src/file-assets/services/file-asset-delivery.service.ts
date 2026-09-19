import { Readable } from 'stream';

import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { FleetAudienceService } from 'src/fleet/authorisation/fleet-audience.service';
import { ScopeRef } from 'src/fleet/authorisation/scope-authorisation.interface';
import { FleetScopeKind } from 'src/fleet/enums/fleet-scope-kind.enum';

import { FileAssetEntity } from '../entities/file-asset.entity';
import { FileAssetAudience } from '../enums/file-asset-audience.enum';
import { SERVEABLE_FILE_ASSET_STATES } from '../enums/file-asset-state.enum';
import { FileAssetStorage } from '../enums/file-asset-storage.enum';
import { FileAssetService } from './file-asset.service';
import { QuarantineStorageService } from './quarantine-storage.service';

/** An asset's bytes, and what a response needs to say about them. */
export interface FileAssetContent {
  /** The bytes. */
  readonly stream: Readable;
  /** What to declare the content as. */
  readonly contentType: string;
  /** How many bytes there are, when it is known. */
  readonly byteSize: number | null;
  /** The filename to offer, when the asset has one. */
  readonly filename: string | null;
}

/**
 * Handing an asset's bytes to somebody who is allowed to have them.
 *
 * Two questions are asked on **every** request, in this order, and neither
 * answer is ever cached: is this asset currently serveable, and may this
 * particular reader have it. Asking on every request is the whole mechanism
 * behind the third acceptance criterion. A long-lived signed URL asks once, at
 * the moment it is minted, and there is then nothing left to revoke; an
 * authenticated route that re-reads the row cannot serve bytes that were
 * withdrawn a second ago.
 *
 * Every refusal is a 404. Not a 403, and not a distinguishable message: the
 * response to an asset that does not exist, an asset that exists but has been
 * refused, and an asset the reader simply may not see is the same response.
 * Telling the three apart would let somebody enumerate what is stored and, for
 * a quarantined file, confirm that it was rejected — which is a fact about the
 * scanner and belongs with the rest of the scanner's diagnostics, behind an
 * administrator's authority.
 *
 * This route serves what is in the private bucket. An asset delivered through
 * Cloudflare Images or the legacy public CDN is not fetched through here and
 * is refused by it: that content has its own URL, and pretending otherwise
 * would create a second path to bytes whose revocation story is a purge rather
 * than a database write.
 */
@Injectable()
export class FileAssetDeliveryService {
  private readonly _logger = new Logger(FileAssetDeliveryService.name);

  /**
   * Creates an instance of FileAssetDeliveryService.
   *
   * @param _assetService - The asset registry.
   * @param _storage - The private quarantine bucket.
   * @param _audienceService - The Fleet visibility policy, for scoped assets.
   */
  constructor(
    private readonly _assetService: FileAssetService,
    private readonly _storage: QuarantineStorageService,
    private readonly _audienceService: FleetAudienceService,
  ) {}

  /**
   * Resolves an asset a reader is entitled to, or refuses.
   *
   * @param assetId - The asset asked for.
   * @param userId - The reader, or null when signed out.
   * @returns The asset.
   * @throws NotFoundException whenever the bytes may not be handed over, for
   *   whatever reason.
   */
  async resolveForReader(
    assetId: string,
    userId: string | null,
  ): Promise<FileAssetEntity> {
    const asset = await this._assetService.findById(assetId);

    if (asset === null) {
      throw new NotFoundException('Not found');
    }

    if (!SERVEABLE_FILE_ASSET_STATES.has(asset.state)) {
      this._logger.debug(
        `[resolveForReader] Refused on state - AssetId: ${assetId}, State: ${asset.state}`,
      );

      throw new NotFoundException('Not found');
    }

    if (asset.storage !== FileAssetStorage.QUARANTINE) {
      throw new NotFoundException('Not found');
    }

    if (!(await this.mayRead(asset, userId))) {
      this._logger.debug(
        `[resolveForReader] Refused on audience - AssetId: ${assetId}, Audience: ${asset.audience}`,
      );

      throw new NotFoundException('Not found');
    }

    return asset;
  }

  /**
   * Resolves an asset and opens its bytes.
   *
   * The object version is passed to the store, so what is served is the
   * version a scanner cleared rather than whatever happens to be under the key
   * now.
   *
   * @param assetId - The asset asked for.
   * @param userId - The reader, or null when signed out.
   * @returns The bytes and what to say about them.
   * @throws NotFoundException whenever the bytes may not be handed over.
   */
  async openForReader(
    assetId: string,
    userId: string | null,
  ): Promise<FileAssetContent> {
    const asset = await this.resolveForReader(assetId, userId);

    const stream = await this._storage.getStream(
      asset.objectKey!,
      asset.objectVersion,
    );

    return {
      stream,
      contentType: asset.detectedContentType ?? 'application/octet-stream',
      byteSize: asset.byteSize === null ? null : Number(asset.byteSize),
      filename: asset.originalFilename,
    };
  }

  /**
   * Reports whether a reader may see an asset.
   *
   * @param asset - The asset.
   * @param userId - The reader, or null when signed out.
   * @returns True when the bytes may be handed over.
   */
  private async mayRead(
    asset: FileAssetEntity,
    userId: string | null,
  ): Promise<boolean> {
    switch (asset.audience) {
      case FileAssetAudience.PUBLIC:
        return true;
      case FileAssetAudience.AUTHENTICATED:
        return userId !== null;
      case FileAssetAudience.OWNER:
        return userId !== null && userId === asset.ownerUserId;
      case FileAssetAudience.SCOPE:
        return this.mayReadScoped(asset, userId);
      // Evidence, not content. There is no ordinary route to a retained import
      // source; the investigation route is W09's, with its own authority and
      // its own reason logging. Every audience is named, so one added to the
      // enum without a branch here is a compile error rather than a file that
      // quietly becomes readable.
      case FileAssetAudience.RESTRICTED:
        return false;
    }
  }

  /**
   * Asks the Fleet visibility policy about a scoped asset.
   *
   * The question is delegated rather than answered here. "May this person see
   * this" already has one implementation in this codebase, and a file is not a
   * reason to write a second that will drift from it.
   *
   * @param asset - The asset.
   * @param userId - The reader, or null when signed out.
   * @returns True when the scope's audience admits them.
   */
  private async mayReadScoped(
    asset: FileAssetEntity,
    userId: string | null,
  ): Promise<boolean> {
    const ref = this.scopeRefFor(asset);

    if (ref === null || asset.scopeAudience === null) {
      return false;
    }

    return this._audienceService.canView(asset.scopeAudience, ref, userId);
  }

  /**
   * Names the scope a scoped asset belongs to.
   *
   * @param asset - The asset.
   * @returns The scope, or null when the row names none.
   */
  private scopeRefFor(asset: FileAssetEntity): ScopeRef | null {
    if (asset.fleetId !== null) {
      return { kind: FleetScopeKind.FLEET, id: asset.fleetId };
    }

    if (asset.armadaId !== null) {
      return { kind: FleetScopeKind.ARMADA, id: asset.armadaId };
    }

    if (asset.communityId !== null) {
      return { kind: FleetScopeKind.COMMUNITY, id: asset.communityId };
    }

    return null;
  }
}
