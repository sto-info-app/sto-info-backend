import { Logger } from '@nestjs/common';

import { ImageUploadsService } from '../utilities/image-uploads.service';
import { ImageSlotService, ImageSlotSpec } from './image-slot.service';

/**
 * Builds a PNG whose header claims the given dimensions.
 *
 * @param width - The width to declare.
 * @param height - The height to declare.
 * @returns The bytes.
 */
const buildPng = (width: number, height: number): Buffer => {
  const buffer = Buffer.alloc(24);

  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);

  return buffer;
};

/**
 * The shared checker's own contract, as distinct from any one feature's use of
 * it.
 *
 * The shape and encoding rules are exercised thoroughly through Storytime,
 * which runs the real service. What is only visible here is the part that
 * exists so two features can share this at all: the spec and the size-limit
 * wording arrive as parameters rather than being looked up.
 */
describe('ImageSlotService', () => {
  const userId = 'user-1';
  const entityId = 'entity-1';

  const spec: ImageSlotSpec = {
    label: 'Square image',
    aspectRatio: [1, 1],
    minimumWidth: 300,
    minimumHeight: 300,
    recommendedWidth: 300,
    recommendedHeight: 300,
    outputFormat: 'png',
    entityTag: 'custom-tracking-square',
  };

  let service: ImageSlotService;
  let uploadImageToCloudflareImages: jest.Mock;
  let deleteImageFromCloudflareImages: jest.Mock;

  const buildFile = (buffer: Buffer, size?: number): Express.Multer.File =>
    ({
      buffer,
      size: size ?? buffer.length,
      mimetype: 'image/png',
      originalname: 'picture.png',
    }) as Express.Multer.File;

  beforeEach(() => {
    uploadImageToCloudflareImages = jest.fn().mockResolvedValue('image-id');
    deleteImageFromCloudflareImages = jest.fn().mockResolvedValue(undefined);

    service = new ImageSlotService({
      uploadImageToCloudflareImages,
      deleteImageFromCloudflareImages,
    } as unknown as ImageUploadsService);

    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const store = (file: Express.Multer.File, maximumBytes = 1_048_576) =>
    service.store({
      spec,
      userId,
      entityId,
      maximumBytes,
      sizeLimitLabel: 'Custom tracking images',
      file,
    });

  // The tag is what associates the image with the feature and record it
  // belongs to, without which nothing could reconcile orphans later.
  it('records the picture under the tag its spec names', async () => {
    const file = buildFile(buildPng(300, 300));

    await expect(store(file)).resolves.toBe('image-id');
    expect(uploadImageToCloudflareImages).toHaveBeenCalledWith(
      userId,
      file,
      'custom-tracking-square',
      entityId,
    );
  });

  // The sentence differs by feature, and each one's wording is its own to
  // change, so it comes from the caller rather than from the spec.
  it('refuses an oversized picture in the caller’s own words', async () => {
    await expect(
      store(buildFile(buildPng(300, 300), 4_194_304), 1_048_576),
    ).rejects.toThrow(
      'That image is 4.0 MB. Custom tracking images must be 1.0 MB or smaller.',
    );
  });

  it('applies the bounds its spec names rather than any fixed ones', async () => {
    await expect(store(buildFile(buildPng(299, 299)))).rejects.toThrow(
      'at least 300 by 300',
    );
    await expect(store(buildFile(buildPng(400, 300)))).rejects.toThrow(
      'cropped to 1:1',
    );
  });

  it('refuses before anything reaches storage', async () => {
    await expect(store(buildFile(Buffer.from('not an image')))).rejects.toThrow(
      'not a readable PNG or JPEG image',
    );
    expect(uploadImageToCloudflareImages).not.toHaveBeenCalled();
  });

  it('releases an image nothing points at any more', async () => {
    await service.release('old-image');

    expect(deleteImageFromCloudflareImages).toHaveBeenCalledWith('old-image');
  });

  // A request being served must not fail over an untidy leftover.
  it('swallows a failed release', async () => {
    deleteImageFromCloudflareImages.mockRejectedValueOnce(
      new Error('Cloudflare said no'),
    );

    await expect(service.release('old-image')).resolves.toBeUndefined();
  });

  it('has nothing to release when there was no image', async () => {
    await expect(service.tryRelease(null)).resolves.toEqual({
      released: true,
      error: null,
    });
    expect(deleteImageFromCloudflareImages).not.toHaveBeenCalled();
  });

  // A reconciliation job exists precisely to notice a leftover, so the same
  // request has to be reported to it rather than swallowed.
  it('reports a failed release to a caller that asked', async () => {
    deleteImageFromCloudflareImages.mockRejectedValueOnce(
      new Error('Cloudflare said no'),
    );

    await expect(service.tryRelease('old-image')).resolves.toEqual({
      released: false,
      error: 'Cloudflare said no',
    });
  });
});
