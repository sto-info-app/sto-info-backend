import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import sharp from 'sharp';

/**
 * The most pixels a picture may have, by Steve's choice of 1 October 2026.
 *
 * Decoding is what costs memory, at four bytes a pixel, and a small file can
 * claim an enormous image. Fifty megapixels covers a 48-megapixel phone
 * photograph (8064 by 6048) and bounds one decode at about 200 MB, where
 * sharp's own default of 268 megapixels would allow about a gigabyte.
 */
export const IMAGE_MAX_PIXELS = 50_000_000;

/** The JPEG quality pictures are written at, with mozjpeg. */
export const IMAGE_JPEG_QUALITY = 90;

/** The two encodings the site accepts. */
export type ReencodableFormat = 'png' | 'jpeg';

/**
 * Re-encodes every picture before it is quarantined (FC-043).
 *
 * The scanner cannot be trusted to see everything an image can carry.
 * `clamd` reads an archive member only up to `MaxFileSize` and says nothing
 * about the rest, so a small PNG with an archive appended — still a PNG to
 * every header check — could hide a payload past that point and come back
 * clean; the scan rehearsal in the worker shows it. Decoding the picture and
 * writing it out again leaves nothing but pixels: appended bytes, archives in
 * ancillary chunks or APP segments, comments and every kind of metadata are
 * gone before the bytes are stored, scanned or published.
 *
 * With Steve's choices of 1 October 2026:
 *
 * - **Upright first.** The orientation a camera recorded in EXIF is applied
 *   before the metadata goes, so a phone photograph is not published on its
 *   side.
 * - **Then no metadata at all** — EXIF, GPS, the camera, comments and the
 *   colour profile; sharp converts to sRGB as it writes. That is a privacy
 *   gain in its own right: a location in a profile picture is no longer
 *   published with it.
 * - **PNG stays lossless; JPEG is written at quality
 *   {@link IMAGE_JPEG_QUALITY}** with mozjpeg.
 * - **At most {@link IMAGE_MAX_PIXELS} pixels**, refused before decoding.
 *
 * A picture that cannot be decoded is refused here, with the same words the
 * header check uses, rather than quarantined: it is not an image.
 */
@Injectable()
export class ImageReencodeService {
  private readonly _logger = new Logger(ImageReencodeService.name);

  /**
   * Decodes a picture and writes it out again in the same encoding.
   *
   * @param bytes - The uploaded bytes, already checked to be a PNG or JPEG
   *   by their header.
   * @param format - The encoding the header said they are in.
   * @returns The re-encoded bytes.
   * @throws BadRequestException when the picture has too many pixels or
   *   cannot be decoded.
   */
  async reencode(bytes: Buffer, format: ReencodableFormat): Promise<Buffer> {
    const image = sharp(bytes, { limitInputPixels: IMAGE_MAX_PIXELS }).rotate();

    try {
      return await (
        format === 'png'
          ? image.png()
          : image.jpeg({ quality: IMAGE_JPEG_QUALITY, mozjpeg: true })
      ).toBuffer();
    } catch (error: unknown) {
      const message = String((error as { message?: unknown }).message);

      if (/pixel limit/i.test(message)) {
        throw new BadRequestException(
          `That image is too large to process. Pictures may be at most ` +
            `${IMAGE_MAX_PIXELS / 1_000_000} megapixels.`,
        );
      }

      this._logger.warn(
        `[reencode] Could not decode an upload - Format: ${format}, Reason: ${message}`,
      );

      throw new BadRequestException(
        'That file is not a readable PNG or JPEG image.',
      );
    }
  }
}
