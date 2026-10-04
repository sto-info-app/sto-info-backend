import { Injectable } from '@nestjs/common';

import { FleetAudience } from 'src/fleet/enums/fleet-audience.enum';
import { ImageReencodeService } from 'src/shared/images/image-reencode.service';
import {
  ImageSlotService,
  ImageSlotSpec,
} from 'src/shared/images/image-slot.service';

import { FileAssetAudience } from '../enums/file-asset-audience.enum';
import { FileAssetKind } from '../enums/file-asset-kind.enum';
import { FileAssetSlot } from '../enums/file-asset-slot.enum';
import { FileAssetSubject } from '../enums/file-asset-subject.enum';
import { AcceptedAsset, AssetIngressService } from './asset-ingress.service';

/** One picture, on its way to one slot. */
export interface ImageUploadRequest {
  /** The rules the picture is held to, when the slot has any. */
  readonly spec: ImageSlotSpec | null;
  /** The person uploading. */
  readonly userId: string;
  /** What the asset is, for rescans and retention. */
  readonly kind: FileAssetKind;
  /** Who may see it once it is published. */
  readonly audience: FileAssetAudience;
  /** The kind of record it belongs to. */
  readonly subject: FileAssetSubject;
  /** Which record of that kind. */
  readonly subjectId: string;
  /** Which picture of that record. */
  readonly slot: FileAssetSlot;
  /**
   * The Fleet scope the picture belongs to, when it belongs to one.
   *
   * Passed through to the registry's own scope columns, which have been
   * there since FC-012 and had nothing to fill them until a Fleet scope
   * gained artwork. They are what lets a retention sweep or a closure find
   * every asset belonging to a scope without asking each feature in turn.
   */
  readonly scope?: {
    /** The owning Community, where there is one. */
    readonly communityId?: string | null;
    /** The owning Fleet, where there is one. */
    readonly fleetId?: string | null;
    /** The owning Armada, where there is one. */
    readonly armadaId?: string | null;
    /** Which of the scope's audiences applies. */
    readonly audience?: FleetAudience | null;
  } | null;
  /** What kind of thing it is, as Cloudflare records it. */
  readonly entityTag: string;
  /** What it belongs to, as Cloudflare records it. */
  readonly entityId: string;
  /** The largest this uploader's picture may be. */
  readonly maximumBytes: number;
  /** What to call this kind of picture when refusing an oversized one. */
  readonly sizeLimitLabel: string;
  /** The uploaded file. */
  readonly file: Express.Multer.File;
  /** Whatever the owning feature will need back at publication. */
  readonly feature?: Record<string, unknown> | null;
}

/**
 * The front door every picture the site accepts comes through.
 *
 * Two steps that belong together and are written apart: the slot's own
 * rules, which are the uploading feature's and are applied while the person
 * is still waiting, and registration into the asset registry, which is the
 * same six moves whatever the picture is for.
 *
 * Having one of these is the first acceptance criterion. Before FC-012 there
 * were three routes to Cloudflare Images — `ImageSlotService` for Storytime
 * and Custom Tracking, and `ImageUploadsService` directly for profile
 * pictures and Character portraits — and each of them published on the spot.
 * Now there is one, it publishes nothing, and a caller cannot reach a bucket
 * without going through it.
 *
 * **Profile pictures and Character portraits gained a check here.** They
 * never had a slot specification and still do not, but every picture now has
 * its encoding read out of its own bytes, so a PNG that is not a PNG is
 * refused rather than quarantined and scanned as an image.
 *
 * **And every picture is re-encoded before it is quarantined (FC-043)**, so
 * what is scanned, stored and published is pixels and nothing else; see
 * {@link ImageReencodeService} for why the scanner alone was not enough.
 */
/**
 * The one scope column a picture names: the narrowest it was given.
 *
 * The registry holds exactly one of the three (a check constraint), and
 * delivery reads them narrowest first. A Fleet's or an Armada's caller hands
 * over its Community too, and naming both was refused by the database, so
 * every Fleet news cover and Fleet picture upload failed (FC-044).
 *
 * @param scope - What the caller gave.
 * @returns The three columns, at most one of them set.
 */
function namedScope(scope: ImageUploadRequest['scope']): {
  communityId: string | null;
  fleetId: string | null;
  armadaId: string | null;
} {
  const fleetId = scope?.fleetId ?? null;
  const armadaId = fleetId === null ? (scope?.armadaId ?? null) : null;
  const communityId =
    fleetId === null && armadaId === null ? (scope?.communityId ?? null) : null;

  return { communityId, fleetId, armadaId };
}

@Injectable()
export class ImageIngressService {
  /**
   * Creates an instance of ImageIngressService.
   *
   * @param _slots - The slot rules and the image reader.
   * @param _ingress - Registration, quarantine and the scan request.
   * @param _reencoder - Writes every picture out again as pixels only
   *   (FC-043).
   */
  constructor(
    private readonly _slots: ImageSlotService,
    private readonly _ingress: AssetIngressService,
    private readonly _reencoder: ImageReencodeService,
  ) {}

  /**
   * Checks a picture over and sends it to be scanned.
   *
   * @param request - The slot, the uploader and the file.
   * @returns The asset to ask about, and how far along it is.
   * @throws BadRequestException when the file is not acceptable for the slot.
   */
  async accept(request: ImageUploadRequest): Promise<AcceptedAsset> {
    const inspected = this._slots.inspect({
      spec: request.spec,
      userId: request.userId,
      maximumBytes: request.maximumBytes,
      sizeLimitLabel: request.sizeLimitLabel,
      file: request.file,
    });
    // Only pixels go on from here (FC-043): whatever else the file carried,
    // the scanner could not be relied on to see all of it.
    const bytes = await this._reencoder.reencode(
      inspected.bytes,
      inspected.format,
    );

    return this._ingress.accept({
      kind: request.kind,
      audience: request.audience,
      subject: request.subject,
      subjectId: request.subjectId,
      slot: request.slot,
      ownerUserId: request.userId,
      ...namedScope(request.scope),
      scopeAudience: request.scope?.audience ?? null,
      bytes,
      // What the browser said, kept as a claim. The registry normalises it
      // and the worker checks it against the bytes — ADR-0020.
      declaredContentType: request.file.mimetype,
      detectedContentType: inspected.detectedContentType,
      originalFilename: inspected.safeFileName,
      entityTag: request.entityTag,
      entityId: request.entityId,
      feature: request.feature ?? null,
    });
  }
}
