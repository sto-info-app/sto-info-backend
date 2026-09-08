import { Injectable } from '@nestjs/common';

import { LimitService } from 'src/access-control/limit.service';
import { ImageSlotService } from 'src/shared/images/image-slot.service';

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
}

/**
 * Putting artwork into Cloudflare Images on Storytime's behalf.
 *
 * What is specific to Storytime is which slot a picture is for, and how large
 * a picture this particular creator may upload — a ceiling an administrator
 * can raise for a named user. Everything else about checking a picture over is
 * the same work any feature does with one, and lives in
 * {@link ImageSlotService} so Custom Tracking's user-defined image fields are
 * held to exactly the same checks rather than to a second set written for
 * them.
 *
 * The size ceiling is resolved here rather than there because only this side
 * knows to ask `LimitService` for a per-user exemption.
 */
@Injectable()
export class StorytimeImageService {
  /**
   * Creates an instance of StorytimeImageService.
   *
   * @param _images - Checks a picture over and stores it.
   * @param _limitService - Resolves the size ceiling that applies to a user.
   */
  constructor(
    private readonly _images: ImageSlotService,
    private readonly _limitService: LimitService,
  ) {}

  /**
   * Checks an upload over and stores it, returning the new image's identifier.
   *
   * The caller writes the identifier to its own entity and then releases
   * whatever was there before. Doing it in that order matters: an upload that
   * succeeds and a save that fails leaves an unreferenced image, which costs
   * nothing but storage, whereas releasing first would leave a work pointing
   * at an image that no longer exists.
   *
   * @param upload - The slot, the uploader, the work and the file.
   * @returns The Cloudflare Images identifier of the stored image.
   * @throws BadRequestException when the file is not an acceptable image for
   * the slot.
   */
  async store(upload: StorytimeImageUpload): Promise<string> {
    return this._images.store({
      spec: STORYTIME_IMAGE_SPECS[upload.slot],
      userId: upload.userId,
      entityId: upload.entityId,
      maximumBytes: await this._limitService.resolve(
        upload.userId,
        STORYTIME_LIMITS.MAX_UPLOAD_BYTES.key,
        STORYTIME_LIMITS.MAX_UPLOAD_BYTES.defaultValue,
      ),
      sizeLimitLabel: 'Storytime images',
      file: upload.file,
    });
  }

  /**
   * Deletes an image that nothing points at any more.
   *
   * @param imageId - The image to delete, or null when there was none.
   */
  release(imageId: string | null | undefined): Promise<void> {
    return this._images.release(imageId);
  }
}
