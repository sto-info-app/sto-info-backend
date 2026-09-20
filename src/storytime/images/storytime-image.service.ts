import { Injectable } from '@nestjs/common';

import { LimitService } from 'src/access-control/limit.service';
import { FileAssetAudience } from 'src/file-assets/enums/file-asset-audience.enum';
import { FileAssetKind } from 'src/file-assets/enums/file-asset-kind.enum';
import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { AcceptedAsset } from 'src/file-assets/services/asset-ingress.service';
import { AssetWithdrawalService } from 'src/file-assets/services/asset-withdrawal.service';
import { ImageIngressService } from 'src/file-assets/services/image-ingress.service';

import { STORYTIME_IMAGE_SPECS } from '../constants/storytime-image.constants';
import { STORYTIME_LIMITS } from '../constants/storytime-limits.constants';
import { StorytimeImageSlot } from '../enums/storytime-image-slot.enum';

/** What one upload needs to know about itself. */
export interface StorytimeImageUpload {
  /** Which piece of artwork is being set. */
  readonly slot: StorytimeImageSlot;
  /** The person uploading, whose limits and identity the image is recorded under. */
  readonly userId: string;
  /** The work the image belongs to, recorded against the image in Cloudflare. */
  readonly entityId: string;
  /** The uploaded file. */
  readonly file: Express.Multer.File;
  /**
   * What the image shows.
   *
   * Carried through to publication rather than written now. The description
   * belongs to the picture, and writing it onto the work while the work is
   * still showing the previous picture would leave the two describing
   * different images for as long as the scan takes.
   */
  readonly altText: string;
}

/**
 * Which record and which of its pictures each Storytime slot is.
 *
 * Storytime names its slots per picture — a Story's banner and its profile
 * image are different shapes for different jobs — and the registry names
 * them as a record plus a slot, because that pair is what a publisher needs
 * in order to know which column to write. This is the one translation
 * between the two vocabularies.
 */
const STORYTIME_PLACEMENTS: Readonly<
  Record<
    StorytimeImageSlot,
    { readonly subject: FileAssetSubject; readonly slot: FileAssetSlot }
  >
> = {
  [StorytimeImageSlot.STORY_BANNER]: {
    subject: FileAssetSubject.STORYTIME_STORY,
    slot: FileAssetSlot.BANNER,
  },
  [StorytimeImageSlot.STORY_PROFILE]: {
    subject: FileAssetSubject.STORYTIME_STORY,
    slot: FileAssetSlot.PROFILE,
  },
  [StorytimeImageSlot.CHAPTER_COVER]: {
    subject: FileAssetSubject.STORYTIME_CHAPTER,
    slot: FileAssetSlot.COVER,
  },
  [StorytimeImageSlot.CHARACTER_PORTRAIT]: {
    subject: FileAssetSubject.STORYTIME_CAST_MEMBER,
    slot: FileAssetSlot.PORTRAIT,
  },
  [StorytimeImageSlot.ARC_BANNER]: {
    subject: FileAssetSubject.STORYTIME_ARC,
    slot: FileAssetSlot.BANNER,
  },
  [StorytimeImageSlot.ARC_PROFILE]: {
    subject: FileAssetSubject.STORYTIME_ARC,
    slot: FileAssetSlot.PROFILE,
  },
  [StorytimeImageSlot.SPOTLIGHT_OVERRIDE]: {
    subject: FileAssetSubject.STORYTIME_SPOTLIGHT,
    slot: FileAssetSlot.OVERRIDE,
  },
};

/**
 * Taking Storytime artwork as far as a scanner.
 *
 * What is specific to Storytime is which slot a picture is for, and how
 * large a picture this particular creator may upload — a ceiling an
 * administrator can raise for a named user. Everything else about checking a
 * picture over and registering it is the same work any feature does with
 * one, and lives behind {@link ImageIngressService} so Custom Tracking's
 * user-defined image fields are held to exactly the same checks rather than
 * to a second set written for them.
 *
 * **Nothing here stores anything any more.** Since FC-012 the upload ends at
 * quarantine and the work is not touched; the picture and its description
 * reach the Story, Chapter, Character, Arc or spotlight when a scanner has
 * cleared them, by way of that feature's publisher.
 */
@Injectable()
export class StorytimeImageService {
  /**
   * Creates an instance of StorytimeImageService.
   *
   * @param _ingress - Checks a picture over and sends it to be scanned.
   * @param _withdrawal - Takes a published picture down.
   * @param _limitService - Resolves the size ceiling that applies to a user.
   */
  constructor(
    private readonly _ingress: ImageIngressService,
    private readonly _withdrawal: AssetWithdrawalService,
    private readonly _limitService: LimitService,
  ) {}

  /**
   * Checks an upload over and sends it to be scanned.
   *
   * @param upload - The slot, the uploader, the work, the file and the
   *   description.
   * @returns The asset to ask about, and how far along it is.
   * @throws BadRequestException when the file is not an acceptable image for
   * the slot.
   */
  async accept(upload: StorytimeImageUpload): Promise<AcceptedAsset> {
    const spec = STORYTIME_IMAGE_SPECS[upload.slot];
    const placement = STORYTIME_PLACEMENTS[upload.slot];

    return this._ingress.accept({
      spec,
      userId: upload.userId,
      kind: FileAssetKind.STORYTIME_IMAGE,
      audience: FileAssetAudience.PUBLIC,
      subject: placement.subject,
      subjectId: upload.entityId,
      slot: placement.slot,
      entityTag: spec.entityTag,
      entityId: upload.entityId,
      maximumBytes: await this._limitService.resolve(
        upload.userId,
        STORYTIME_LIMITS.MAX_UPLOAD_BYTES.key,
        STORYTIME_LIMITS.MAX_UPLOAD_BYTES.defaultValue,
      ),
      sizeLimitLabel: 'Storytime images',
      file: upload.file,
      feature: { altText: upload.altText },
    });
  }

  /**
   * Takes a picture out of a slot and withdraws it.
   *
   * More than a delete, which is why it is not one. A published image sits
   * behind nine Cloudflare variants on two hostnames and possibly in a
   * cache, so withdrawing it is a registry state change, an object delete
   * and a record of whether the purge actually happened — ADR-0016. The
   * placement is settled with it, so the slot stops claiming to show
   * anything.
   *
   * Failure is not raised. The work has already stopped pointing at the
   * picture by the time this runs, so what a reader sees is correct, and an
   * outstanding purge is recorded on the asset where W10 can find it.
   *
   * @param slot - Which piece of artwork was removed.
   * @param entityId - The work it belonged to.
   * @param imageId - The image that was there, when there was one.
   */
  async withdraw(
    slot: StorytimeImageSlot,
    entityId: string,
    imageId: string | null | undefined,
  ): Promise<void> {
    const placement = STORYTIME_PLACEMENTS[slot];

    await this._withdrawal.withdrawSlot(
      placement.subject,
      entityId,
      placement.slot,
      imageId ?? null,
      'Removed by the owner',
    );
  }
}
