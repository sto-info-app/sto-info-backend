import { crc32, deflateSync } from 'node:zlib';

import { BadRequestException, Logger } from '@nestjs/common';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import sharp from 'sharp';

import {
  IMAGE_MAX_PIXELS,
  ImageReencodeService,
} from './image-reencode.service';

/** Bytes that stand for a payload hidden after the picture. */
const HIDDEN = Buffer.from('PK\u0003\u0004FC043-HIDDEN-PAYLOAD', 'latin1');

/**
 * Draws a small picture.
 *
 * @param format - The encoding.
 * @param width - Its width.
 * @param height - Its height.
 * @returns The bytes.
 */
const picture = (
  format: 'png' | 'jpeg',
  width = 40,
  height = 20,
): Promise<Buffer> => {
  const image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 40, b: 40 },
    },
  });

  return (format === 'png' ? image.png() : image.jpeg()).toBuffer();
};

/**
 * Wraps data in a PNG chunk, with its checksum.
 *
 * @param type - The chunk type.
 * @param data - The chunk data.
 * @returns The chunk.
 */
const chunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);

  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(body));

  return Buffer.concat([length, body, crc]);
};

/**
 * Builds a well-formed PNG that claims the given size and carries almost no
 * pixel data, as a small upload claiming a vast image would.
 *
 * @param width - The width it claims.
 * @param height - The height it claims.
 * @returns The bytes.
 */
const pngClaiming = (width: number, height: number): Buffer => {
  const header = Buffer.alloc(13);

  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(2, 9);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(16))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

/**
 * Proves the one property FC-043 needs from re-encoding: what leaves it is
 * pixels and nothing else, whatever the upload carried. Run against the
 * real sharp, because a stand-in would prove only what it was told.
 */
describe('ImageReencodeService (FC-043)', () => {
  let service: ImageReencodeService;

  beforeEach(() => {
    service = new ImageReencodeService();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(['png', 'jpeg'] as const)(
    'writes a %s out again as the same encoding and size',
    async format => {
      const out = await service.reencode(await picture(format), format);
      const meta = await sharp(out).metadata();

      expect(meta.format).toBe(format);
      expect([meta.width, meta.height]).toEqual([40, 20]);
    },
  );

  it.each(['png', 'jpeg'] as const)(
    'drops whatever was appended to a %s, an archive included',
    async format => {
      const upload = Buffer.concat([await picture(format), HIDDEN]);

      const out = await service.reencode(upload, format);

      expect(out.includes(HIDDEN)).toBe(false);
      expect(out.includes(Buffer.from('FC043', 'latin1'))).toBe(false);
    },
  );

  it('drops every piece of metadata, a location included', async () => {
    const upload = await sharp(await picture('jpeg'))
      .withExif({
        IFD0: { Copyright: 'FC043-EXIF-CANARY', Artist: 'Someone' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' },
      })
      .jpeg()
      .toBuffer();

    expect((await sharp(upload).metadata()).exif).toBeDefined();

    const out = await service.reencode(upload, 'jpeg');
    const meta = await sharp(out).metadata();

    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(out.includes(Buffer.from('FC043-EXIF-CANARY', 'latin1'))).toBe(
      false,
    );
  });

  // A phone records "rotate me" rather than rotating; dropping the record
  // without applying it would publish the photograph on its side.
  it('turns a photograph upright before dropping its orientation', async () => {
    const upload = await sharp(await picture('jpeg', 40, 20))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const meta = await sharp(await service.reencode(upload, 'jpeg')).metadata();

    expect([meta.width, meta.height]).toEqual([20, 40]);
    expect(meta.orientation).toBeUndefined();
  });

  it('refuses a picture with more pixels than it will decode', async () => {
    const claim = pngClaiming(10_000, Math.ceil(IMAGE_MAX_PIXELS / 10_000) + 1);

    await expect(service.reencode(claim, 'png')).rejects.toThrow(
      new BadRequestException(
        'That image is too large to process. Pictures may be at most 50 megapixels.',
      ),
    );
  });

  it('refuses bytes that only look like a picture', async () => {
    await expect(service.reencode(pngClaiming(10, 10), 'png')).rejects.toThrow(
      new BadRequestException('That file is not a readable PNG or JPEG image.'),
    );
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('[reencode] Could not decode an upload'),
    );
  });
});
