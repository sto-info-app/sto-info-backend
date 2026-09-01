import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { LimitService } from 'src/access-control/limit.service';
import { ImageUploadsService } from 'src/shared/utilities/image-uploads.service';
import {
  STORYTIME_IMAGE_ASPECT_TOLERANCE,
  STORYTIME_IMAGE_SPECS,
  StorytimeImageSpec,
} from '../constants/storytime-image.constants';
import { STORYTIME_LIMITS } from '../constants/storytime-limits.constants';
import { StorytimeImageSlot } from '../enums/storytime-image-slot.enum';
import { readImageContent } from './storytime-image-content.utility';

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
 * The site already has an upload pipeline — virus scanning, filename
 * sanitisation, the Cloudflare account — and this does not replace it. What it
 * adds is the part that pipeline cannot know: that a Story banner is a
 * different thing from a Character portrait, and that a file which is a
 * perfectly good image may still be the wrong one for the slot it was offered
 * to. Refusing that here means a reader never meets a banner stretched from
 * something a quarter of its size.
 *
 * Every check reads its numbers from {@link STORYTIME_IMAGE_SPECS}, which the
 * editor is also served, so what a creator is asked for and what the server
 * insists on are one statement rather than two that agree today.
 */
@Injectable()
export class StorytimeImageService {
  private readonly _logger = new Logger(StorytimeImageService.name);

  /**
   * Creates an instance of StorytimeImageService.
   *
   * @param _imageUploads - The site-wide upload pipeline.
   * @param _limitService - Resolves the size ceiling that applies to a user.
   */
  constructor(
    private readonly _imageUploads: ImageUploadsService,
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
    const spec = STORYTIME_IMAGE_SPECS[upload.slot];

    await this.assertWithinUploadLimit(upload.userId, upload.file);
    this.assertAcceptableForSlot(upload.file, spec);

    this._logger.debug(
      `[store] Accepted upload - Slot: ${upload.slot}, EntityId: ${upload.entityId}, UserId: ${upload.userId}`,
    );

    return this._imageUploads.uploadImageToCloudflareImages(
      upload.userId,
      upload.file,
      spec.entityTag,
      upload.entityId,
    );
  }

  /**
   * Deletes an image that nothing points at any more.
   *
   * Failure is logged and swallowed. This is always called after the work
   * itself has been saved, so the state a reader sees is already correct; an
   * image left behind in Cloudflare is untidy, whereas failing the request at
   * this point would tell a creator their change did not happen when it did.
   *
   * @param imageId - The image to delete, or null when there was none.
   */
  async release(imageId: string | null | undefined): Promise<void> {
    if (!imageId) {
      return;
    }

    try {
      await this._imageUploads.deleteImageFromCloudflareImages(imageId);
      this._logger.debug(`[release] Deleted image - ImageId: ${imageId}`);
    } catch (error: unknown) {
      this._logger.warn(
        `[release] Could not delete image - ImageId: ${imageId}, Error: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Requires the upload to be no larger than the uploader is allowed.
   *
   * @param userId - The uploader.
   * @param file - The uploaded file.
   * @throws BadRequestException when the file is too large.
   */
  private async assertWithinUploadLimit(
    userId: string,
    file: Express.Multer.File,
  ): Promise<void> {
    const maximumBytes = await this._limitService.resolve(
      userId,
      STORYTIME_LIMITS.MAX_UPLOAD_BYTES.key,
      STORYTIME_LIMITS.MAX_UPLOAD_BYTES.defaultValue,
    );

    if (file.size > maximumBytes) {
      throw new BadRequestException(
        `That image is ${describeBytes(file.size)}. Storytime images must be ${describeBytes(maximumBytes)} or smaller.`,
      );
    }
  }

  /**
   * Requires the file to be an image of the shape and size the slot needs.
   *
   * @param file - The uploaded file.
   * @param spec - The rules the slot is held to.
   * @throws BadRequestException when the file is unreadable, the wrong
   * encoding, too small, or the wrong shape.
   */
  private assertAcceptableForSlot(
    file: Express.Multer.File,
    spec: StorytimeImageSpec,
  ): void {
    const content = readImageContent(file.buffer);

    if (!content) {
      throw new BadRequestException(
        'That file is not a readable PNG or JPEG image.',
      );
    }

    if (content.format !== spec.outputFormat) {
      throw new BadRequestException(
        `A ${spec.label.toLowerCase()} must be uploaded as ${spec.outputFormat.toUpperCase()}.`,
      );
    }

    if (
      content.width < spec.minimumWidth ||
      content.height < spec.minimumHeight
    ) {
      throw new BadRequestException(
        `That crop is ${content.width} by ${content.height} pixels. A ${spec.label.toLowerCase()} must be at least ${spec.minimumWidth} by ${spec.minimumHeight}, so that it is never enlarged to fill the space it is shown in.`,
      );
    }

    if (!isExpectedShape(content.width, content.height, spec)) {
      const [wide, tall] = spec.aspectRatio;
      throw new BadRequestException(
        `A ${spec.label.toLowerCase()} must be cropped to ${wide}:${tall}.`,
      );
    }
  }
}

/**
 * Determines whether a crop matches its slot's aspect ratio closely enough.
 *
 * @param width - The crop's width in pixels.
 * @param height - The crop's height in pixels.
 * @param spec - The rules the slot is held to.
 * @returns True when the shape is within tolerance.
 */
function isExpectedShape(
  width: number,
  height: number,
  spec: StorytimeImageSpec,
): boolean {
  const [wide, tall] = spec.aspectRatio;
  const expected = wide / tall;
  const actual = width / height;

  return (
    Math.abs(actual - expected) / expected <= STORYTIME_IMAGE_ASPECT_TOLERANCE
  );
}

/**
 * Describes a size in whole megabytes, for a message a creator will read.
 *
 * @param bytes - The size in bytes.
 * @returns The size in megabytes, to one decimal place.
 */
function describeBytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
