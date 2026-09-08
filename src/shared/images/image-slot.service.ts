import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { readImageContent } from 'src/storytime/images/storytime-image-content.utility';

import { ImageUploadsService } from '../utilities/image-uploads.service';

/**
 * The rules one kind of picture is held to.
 *
 * Structural rather than tied to any one feature's slot enumeration, so
 * Storytime's artwork and Custom Tracking's user-defined image fields can be
 * checked by the same code without either knowing about the other.
 */
export interface ImageSlotSpec {
  /** What the slot is called where somebody is asked to fill it. */
  readonly label: string;
  /** The shape the source must be cropped to, as width by height. */
  readonly aspectRatio: readonly [number, number];
  /** The narrowest source accepted. */
  readonly minimumWidth: number;
  /** The shortest source accepted. */
  readonly minimumHeight: number;
  /** The width that needs no enlarging anywhere it is shown. */
  readonly recommendedWidth: number;
  /** The height that needs no enlarging anywhere it is shown. */
  readonly recommendedHeight: number;
  /** The encoding the cropped upload must arrive in. */
  readonly outputFormat: 'png' | 'jpeg';
  /** The entity kind recorded against the image in Cloudflare. */
  readonly entityTag: string;
}

/** What one upload needs to know about itself. */
export interface ImageSlotUpload {
  /** The rules the picture is held to. */
  readonly spec: ImageSlotSpec;
  /** The person uploading, whose identity the image is recorded under. */
  readonly userId: string;
  /** What the image belongs to, recorded against it in Cloudflare. */
  readonly entityId: string;
  /** The largest this uploader's picture may be. */
  readonly maximumBytes: number;
  /**
   * What to call this kind of picture when refusing an oversized one.
   *
   * Supplied by the caller because the sentence differs by feature and each
   * one's wording is its own to change: Storytime speaks of "Storytime
   * images", where a user-defined field speaks of the shape it asked for.
   */
  readonly sizeLimitLabel: string;
  /** The uploaded file. */
  readonly file: Express.Multer.File;
}

/**
 * How far a crop may drift from its slot's exact aspect ratio.
 *
 * A browser crop lands on whole pixels, so a 5:1 banner arrives as 2401 x 480
 * as often as 2400 x 480. Insisting on the exact ratio would refuse crops that
 * are visually identical to the ones it accepts; one per cent is wide enough
 * to cover the rounding and far too narrow to let a square through as a
 * banner.
 */
export const IMAGE_SLOT_ASPECT_TOLERANCE = 0.01;

/**
 * What became of an attempt to delete an image.
 *
 * A union rather than a pair of independent properties, so a caller that has
 * established the deletion failed has the reason without having to allow for
 * its being absent. There is no such state: a failure always has a message.
 */
export type ImageReleaseOutcome =
  | { released: true; error: null }
  | { released: false; error: string };

/** Bytes in a megabyte, for a message somebody will read. */
const BYTES_PER_MEGABYTE = 1_048_576;

/**
 * Checking a picture over and storing it.
 *
 * The site already has an upload pipeline — virus scanning, filename
 * sanitisation, the Cloudflare account — and this does not replace it. What it
 * adds is the part that pipeline cannot know: that a Story banner is a
 * different thing from a portrait, and that a file which is a perfectly good
 * image may still be the wrong one for the slot it was offered to.
 *
 * Every check reads its numbers from the spec it is given, which the editor is
 * also served, so what somebody is asked for and what the server insists on
 * are one statement rather than two that agree today. The spec arrives as a
 * parameter rather than being looked up here, which is what lets one
 * implementation serve both Storytime's fixed slots and Custom Tracking's
 * user-defined image fields.
 */
@Injectable()
export class ImageSlotService {
  private readonly _logger = new Logger(ImageSlotService.name);

  /**
   * Creates an instance of ImageSlotService.
   *
   * @param _imageUploads - The site-wide upload pipeline.
   */
  constructor(private readonly _imageUploads: ImageUploadsService) {}

  /**
   * Checks an upload over and stores it, returning the new image's identifier.
   *
   * The caller writes the identifier to its own row and then releases whatever
   * was there before. Doing it in that order matters: an upload that succeeds
   * and a save that fails leaves an unreferenced image, which costs nothing but
   * storage, whereas releasing first would leave a record pointing at an image
   * that no longer exists.
   *
   * @param upload - The rules, the uploader, what it belongs to and the file.
   * @returns The Cloudflare Images identifier of the stored image.
   * @throws BadRequestException when the file is not acceptable for the slot.
   */
  async store(upload: ImageSlotUpload): Promise<string> {
    this.assertWithinUploadLimit(upload);
    this.assertAcceptableForSlot(upload.file, upload.spec);

    this._logger.debug(
      `[store] Accepted upload - Slot: ${upload.spec.entityTag}, EntityId: ${upload.entityId}, UserId: ${upload.userId}`,
    );

    return this._imageUploads.uploadImageToCloudflareImages(
      upload.userId,
      upload.file,
      upload.spec.entityTag,
      upload.entityId,
    );
  }

  /**
   * Deletes an image that nothing points at any more.
   *
   * Failure is logged and swallowed. This is always called after the record
   * itself has been saved, so the state a reader sees is already correct; an
   * image left behind in Cloudflare is untidy, whereas failing the request at
   * this point would tell somebody their change did not happen when it did.
   *
   * Callers that keep a queue of images to delete want to know whether it
   * worked, so they can leave a failed one queued. They call
   * {@link tryRelease} instead.
   *
   * @param imageId - The image to delete, or null when there was none.
   */
  async release(imageId: string | null | undefined): Promise<void> {
    await this.tryRelease(imageId);
  }

  /**
   * Deletes an image and says whether Cloudflare agreed.
   *
   * The same request as {@link release}, reported rather than swallowed. Two
   * methods rather than one because the two callers want opposite things: a
   * request being served must not fail over an untidy leftover, and a
   * reconciliation job exists precisely to notice one.
   *
   * @param imageId - The image to delete, or null when there was none.
   * @returns Whether the image is gone, and why not when it is not.
   */
  async tryRelease(
    imageId: string | null | undefined,
  ): Promise<ImageReleaseOutcome> {
    if (!imageId) {
      return { released: true, error: null };
    }

    try {
      await this._imageUploads.deleteImageFromCloudflareImages(imageId);
      this._logger.debug(`[release] Deleted image - ImageId: ${imageId}`);

      return { released: true, error: null };
    } catch (error: unknown) {
      const message = (error as Error).message;

      this._logger.warn(
        `[release] Could not delete image - ImageId: ${imageId}, Error: ${message}`,
      );

      return { released: false, error: message };
    }
  }

  /**
   * Requires the upload to be no larger than the uploader is allowed.
   *
   * @param upload - The upload being checked.
   * @throws BadRequestException when the file is too large.
   */
  private assertWithinUploadLimit(upload: ImageSlotUpload): void {
    if (upload.file.size > upload.maximumBytes) {
      throw new BadRequestException(
        `That image is ${describeBytes(upload.file.size)}. ${upload.sizeLimitLabel} must be ${describeBytes(upload.maximumBytes)} or smaller.`,
      );
    }
  }

  /**
   * Requires the file to be an image of the shape and size the slot needs.
   *
   * The bytes are read rather than the declared content type. A request states
   * its own MIME type and a filename ends in whatever the person uploading
   * chose, so neither is evidence of anything.
   *
   * @param file - The uploaded file.
   * @param spec - The rules the slot is held to.
   * @throws BadRequestException when the file is unreadable, the wrong
   *   encoding, too small, or the wrong shape.
   */
  private assertAcceptableForSlot(
    file: Express.Multer.File,
    spec: ImageSlotSpec,
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
        `That crop is ${content.width} by ${content.height} pixels. A ${spec.label.toLowerCase()} must be at least ${spec.minimumWidth} by ${spec.minimumHeight}, and ${spec.recommendedWidth} by ${spec.recommendedHeight} is where it stops being enlarged anywhere it is shown.`,
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
  spec: ImageSlotSpec,
): boolean {
  const [wide, tall] = spec.aspectRatio;
  const expected = wide / tall;
  const actual = width / height;

  return Math.abs(actual - expected) / expected <= IMAGE_SLOT_ASPECT_TOLERANCE;
}

/**
 * Describes a size in whole megabytes, for a message somebody will read.
 *
 * @param bytes - The size in bytes.
 * @returns The size in megabytes, to one decimal place.
 */
function describeBytes(bytes: number): string {
  return `${(bytes / BYTES_PER_MEGABYTE).toFixed(1)} MB`;
}
