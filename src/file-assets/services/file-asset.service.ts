import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { FleetAudience } from 'src/fleet/enums/fleet-audience.enum';

import {
  canTransitionFileAsset,
  INITIAL_FILE_ASSET_STATE,
} from '../constants/file-asset-state.constants';
import { FileAssetEntity } from '../entities/file-asset.entity';
import { FileAssetAudience } from '../enums/file-asset-audience.enum';
import { FileAssetKind } from '../enums/file-asset-kind.enum';
import { FileAssetState } from '../enums/file-asset-state.enum';
import { FileAssetStorage } from '../enums/file-asset-storage.enum';

/** What a feature must say to register an asset. */
export interface RegisterFileAssetInput {
  /** What the asset is. */
  readonly kind: FileAssetKind;
  /** Who it may be handed to once it is available. */
  readonly audience: FileAssetAudience;
  /** The uploading user. */
  readonly ownerUserId: string | null;
  /** The owning Community, when the audience is scoped to one. */
  readonly communityId?: string | null;
  /** The owning Fleet, when the audience is scoped to one. */
  readonly fleetId?: string | null;
  /** The owning Armada, when the audience is scoped to one. */
  readonly armadaId?: string | null;
  /** Which of the scope's audiences applies, when the audience is scoped. */
  readonly scopeAudience?: FleetAudience | null;
  /** What the browser claimed the file was. Recorded, never believed. */
  readonly declaredContentType: string | null;
  /** The filename as uploaded. */
  readonly originalFilename: string | null;
  /** When the retention policy allows the bytes to be destroyed. */
  readonly retainUntil?: Date | null;
}

/** What is known once the bytes are in the bucket. */
export interface StoredFileAssetInput {
  /** The key the bytes were written under. */
  readonly objectKey: string;
  /** The provider's version of the written object, when it gave one. */
  readonly objectVersion: string | null;
  /** The SHA-256 of the stored bytes, lowercase hexadecimal. */
  readonly sha256: string;
  /** How many bytes were stored. */
  readonly byteSize: number;
  /** What inspecting the bytes found, as distinct from what was claimed. */
  readonly detectedContentType: string | null;
}

/** What a scanner reported about an asset. */
export interface FileAssetVerdict {
  /** The scanner that answered. */
  readonly engine: string;
  /** Its version, or null when it does not expose one. */
  readonly engineVersion: string | null;
  /** Its signature database, or null when it does not expose one. */
  readonly signatureVersion: string | null;
  /** The scan policy the verdict was reached under. */
  readonly policyVersion: number;
}

/**
 * The asset registry.
 *
 * Every state change an asset can undergo passes through one of these methods,
 * and each of them checks the move against
 * {@link canTransitionFileAsset} before writing. That check is the service's
 * half of the first acceptance criterion; the database trigger is the other
 * half, and the two exist together on purpose. The service gives a caller a
 * comprehensible error at the point of the mistake, and the trigger makes the
 * property true of writes that never came through here at all.
 *
 * Nothing in this class publishes anything on a scanner's say-so.
 * {@link recordCleanVerdict} moves an asset to `CLEAN`, and `CLEAN` is not
 * serveable. Publication is {@link publish}, a separate call the owning
 * feature makes when it has also satisfied itself that the type is allowed,
 * that processing succeeded and that there is an audience to publish to. Plan
 * section 6.1 is explicit that a clean verdict is necessary and not
 * sufficient, and keeping the two calls apart is what stops a future caller
 * from quietly treating them as the same thing.
 */
@Injectable()
export class FileAssetService {
  private readonly _logger = new Logger(FileAssetService.name);

  /**
   * Creates an instance of FileAssetService.
   *
   * @param _repository - Repository of file assets.
   */
  constructor(
    @InjectRepository(FileAssetEntity)
    private readonly _repository: Repository<FileAssetEntity>,
  ) {}

  /**
   * Registers an asset before its bytes exist anywhere.
   *
   * The row comes first so that an upload interrupted halfway leaves a record
   * of an object that may exist. An object in the bucket with no row is the
   * one thing no inventory and no rescan campaign can reach.
   *
   * @param input - What the feature knows about the upload.
   * @returns The new asset, in `RECEIVING`.
   */
  async register(input: RegisterFileAssetInput): Promise<FileAssetEntity> {
    const asset = this._repository.create({
      kind: input.kind,
      state: INITIAL_FILE_ASSET_STATE,
      audience: input.audience,
      storage: FileAssetStorage.NONE,
      ownerUserId: input.ownerUserId,
      communityId: input.communityId ?? null,
      fleetId: input.fleetId ?? null,
      armadaId: input.armadaId ?? null,
      scopeAudience: input.scopeAudience ?? null,
      declaredContentType: input.declaredContentType,
      originalFilename: input.originalFilename,
      retainUntil: input.retainUntil ?? null,
    });

    return this._repository.save(asset);
  }

  /**
   * Records that the bytes are in quarantine.
   *
   * This is the call that binds a verdict to an object: the key, the version
   * and the hash are written here and the database refuses to change any of
   * them afterwards.
   *
   * @param assetId - The asset.
   * @param stored - What was stored, and where.
   * @returns The asset, in `QUARANTINED`.
   */
  async recordStored(
    assetId: string,
    stored: StoredFileAssetInput,
  ): Promise<FileAssetEntity> {
    const asset = await this.requireAsset(assetId);

    this.assertTransition(asset, FileAssetState.QUARANTINED);

    asset.state = FileAssetState.QUARANTINED;
    asset.storage = FileAssetStorage.QUARANTINE;
    asset.objectKey = stored.objectKey;
    asset.objectVersion = stored.objectVersion;
    asset.sha256 = stored.sha256;
    asset.byteSize = String(stored.byteSize);
    asset.detectedContentType = stored.detectedContentType;

    return this._repository.save(asset);
  }

  /**
   * Records that a scanner has taken the object.
   *
   * @param assetId - The asset.
   * @returns The asset, in `SCANNING`.
   */
  async markScanning(assetId: string): Promise<FileAssetEntity> {
    const asset = await this.requireAsset(assetId);

    this.assertTransition(asset, FileAssetState.SCANNING);
    asset.state = FileAssetState.SCANNING;

    return this._repository.save(asset);
  }

  /**
   * Records an affirmative clean verdict.
   *
   * Clean, and not available. Whether these bytes are ever served is a
   * separate decision made by {@link publish}.
   *
   * @param assetId - The asset.
   * @param verdict - Which scanner said so, and under which policy.
   * @returns The asset, in `CLEAN`.
   */
  async recordCleanVerdict(
    assetId: string,
    verdict: FileAssetVerdict,
  ): Promise<FileAssetEntity> {
    const asset = await this.requireAsset(assetId);

    this.assertTransition(asset, FileAssetState.CLEAN);

    asset.state = FileAssetState.CLEAN;
    this.applyVerdict(asset, verdict);

    return this._repository.save(asset);
  }

  /**
   * Refuses an asset.
   *
   * Used for an infection, an unsupported or encrypted payload, an exhausted
   * retry budget and a scanner that could not be trusted to answer. All of
   * them are the same outcome and the uploader is told the same thing; the
   * code that distinguishes them is administrator-only and never a signature
   * name.
   *
   * @param assetId - The asset.
   * @param rejectionCode - The administrator-only reason code.
   * @param verdict - The scanner that answered, when one did.
   * @returns The asset, in `REJECTED`.
   */
  async reject(
    assetId: string,
    rejectionCode: string,
    verdict: FileAssetVerdict | null = null,
  ): Promise<FileAssetEntity> {
    const asset = await this.requireAsset(assetId);

    this.assertTransition(asset, FileAssetState.REJECTED);

    asset.state = FileAssetState.REJECTED;
    asset.rejectionCode = rejectionCode;
    asset.withdrawnAt = new Date();

    if (verdict !== null) {
      this.applyVerdict(asset, verdict);
    }

    this._logger.warn(
      `[reject] Asset refused - AssetId: ${assetId}, Code: ${rejectionCode}`,
    );

    return this._repository.save(asset);
  }

  /**
   * Marks an asset as worth trying again.
   *
   * A transient fault — the scanner was unreachable, the deadline passed — as
   * distinct from an answer. It is not serveable meanwhile, because a scanner
   * that did not answer has not said the file is safe.
   *
   * @param assetId - The asset.
   * @returns The asset, in `RETRY_PENDING`.
   */
  async markRetryPending(assetId: string): Promise<FileAssetEntity> {
    const asset = await this.requireAsset(assetId);

    this.assertTransition(asset, FileAssetState.RETRY_PENDING);
    asset.state = FileAssetState.RETRY_PENDING;

    return this._repository.save(asset);
  }

  /**
   * Publishes an asset to its audience.
   *
   * The only call that makes bytes serveable, and it refuses anything that is
   * not already `CLEAN` or a legacy `UNVERIFIED` row. The caller is expected
   * to have satisfied itself of everything a scanner cannot know — that the
   * type is one the feature accepts, that whatever processing was needed
   * succeeded, and that the parent record still exists and still wants it.
   *
   * @param assetId - The asset.
   * @param storage - Where the bytes are delivered from.
   * @returns The asset, in `AVAILABLE`.
   */
  async publish(
    assetId: string,
    storage: FileAssetStorage = FileAssetStorage.QUARANTINE,
  ): Promise<FileAssetEntity> {
    const asset = await this.requireAsset(assetId);

    this.assertTransition(asset, FileAssetState.AVAILABLE);

    asset.state = FileAssetState.AVAILABLE;
    asset.storage = storage;
    asset.availableAt = new Date();

    return this._repository.save(asset);
  }

  /**
   * Withdraws an asset that was available.
   *
   * The database write comes first and is what stops the next authenticated
   * request, which is the whole of the guarantee for a privately delivered
   * asset. An asset that was on a public route additionally needs its object
   * deleted and its caches purged, and this records that the purge is owed so
   * that the interval before it happens is visible rather than assumed.
   *
   * @param assetId - The asset.
   * @param reason - The administrator-only reason.
   * @returns The asset, in `REVOKED`.
   */
  async revoke(assetId: string, reason: string): Promise<FileAssetEntity> {
    const asset = await this.requireAsset(assetId);

    this.assertTransition(asset, FileAssetState.REVOKED);

    const wasPubliclyDelivered =
      asset.storage === FileAssetStorage.PUBLIC_IMAGES ||
      asset.storage === FileAssetStorage.LEGACY_PUBLIC_R2;

    asset.state = FileAssetState.REVOKED;
    asset.revocationReason = reason;
    asset.withdrawnAt = new Date();

    if (wasPubliclyDelivered) {
      asset.purgeRequiredAt = new Date();
    }

    this._logger.warn(
      `[revoke] Asset withdrawn - AssetId: ${assetId}, PurgeOwed: ${wasPubliclyDelivered}`,
    );

    return this._repository.save(asset);
  }

  /**
   * Records that a withdrawn asset's public routes have been cleared.
   *
   * @param assetId - The asset.
   * @returns The asset.
   */
  async confirmPurged(assetId: string): Promise<FileAssetEntity> {
    const asset = await this.requireAsset(assetId);

    if (asset.purgeRequiredAt === null) {
      throw new ConflictException('No purge is outstanding for this asset');
    }

    asset.purgedAt = new Date();

    return this._repository.save(asset);
  }

  /**
   * Finds an asset by its identifier.
   *
   * @param assetId - The asset.
   * @returns The asset, or null when there is no such row.
   */
  async findById(assetId: string): Promise<FileAssetEntity | null> {
    return this._repository.findOne({ where: { id: assetId } });
  }

  /**
   * Loads an asset or refuses to continue.
   *
   * @param assetId - The asset.
   * @returns The asset.
   * @throws ConflictException when there is no such row.
   */
  private async requireAsset(assetId: string): Promise<FileAssetEntity> {
    const asset = await this.findById(assetId);

    if (asset === null) {
      throw new ConflictException(`No such asset: ${assetId}`);
    }

    return asset;
  }

  /**
   * Refuses a move the state machine does not allow.
   *
   * @param asset - The asset.
   * @param to - The state it would move to.
   * @throws ConflictException when the move is not allowed.
   */
  private assertTransition(asset: FileAssetEntity, to: FileAssetState): void {
    if (canTransitionFileAsset(asset.state, to)) {
      return;
    }

    throw new ConflictException(
      `An asset cannot move from ${asset.state} to ${to}`,
    );
  }

  /**
   * Writes a scanner's own account of itself onto the asset.
   *
   * A scanner that does not expose a version or a signature database is
   * recorded as having none, never as a plausible value — ADR-0005.
   *
   * @param asset - The asset.
   * @param verdict - What the scanner reported.
   */
  private applyVerdict(
    asset: FileAssetEntity,
    verdict: FileAssetVerdict,
  ): void {
    asset.scanEngine = verdict.engine;
    asset.scanEngineVersion = verdict.engineVersion;
    asset.scanSignatureVersion = verdict.signatureVersion;
    asset.policyVersion = verdict.policyVersion;
    asset.lastVerdictAt = new Date();
  }
}
