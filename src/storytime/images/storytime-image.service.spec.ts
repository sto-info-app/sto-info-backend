import { BadRequestException, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { LimitService } from 'src/access-control/limit.service';
import { ImageUploadsService } from 'src/shared/utilities/image-uploads.service';
import { STORYTIME_LIMITS } from '../constants/storytime-limits.constants';
import { StorytimeImageSlot } from '../enums/storytime-image-slot.enum';
import { StorytimeImageService } from './storytime-image.service';

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
 * Builds a JPEG whose frame header claims the given dimensions.
 *
 * @param width - The width to declare.
 * @param height - The height to declare.
 * @returns The bytes.
 */
const buildJpeg = (width: number, height: number): Buffer => {
  const buffer = Buffer.alloc(13);
  Buffer.from([0xff, 0xd8, 0xff, 0xc0]).copy(buffer);
  buffer.writeUInt16BE(8, 4);
  buffer.writeUInt8(8, 6);
  buffer.writeUInt16BE(height, 7);
  buffer.writeUInt16BE(width, 9);
  return buffer;
};

describe('StorytimeImageService', () => {
  let service: StorytimeImageService;
  let imageUploads: {
    uploadImageToCloudflareImages: jest.Mock;
    deleteImageFromCloudflareImages: jest.Mock;
  };
  let limitService: { resolve: jest.Mock };

  const userId = '2fb1c7d0-0000-4000-8000-000000000001';
  const entityId = '2fb1c7d0-0000-4000-8000-0000000000aa';

  /**
   * Builds an uploaded file around a buffer.
   *
   * @param buffer - The bytes.
   * @param size - The size to report, defaulting to the buffer's own length.
   * @returns The file.
   */
  const buildFile = (buffer: Buffer, size?: number): Express.Multer.File =>
    ({
      buffer,
      size: size ?? buffer.length,
      mimetype: 'image/png',
      originalname: 'artwork.png',
    }) as Express.Multer.File;

  beforeEach(async () => {
    imageUploads = {
      uploadImageToCloudflareImages: jest.fn().mockResolvedValue('image-id'),
      deleteImageFromCloudflareImages: jest.fn().mockResolvedValue('image-id'),
    };
    limitService = {
      resolve: jest
        .fn()
        .mockResolvedValue(STORYTIME_LIMITS.MAX_UPLOAD_BYTES.defaultValue),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeImageService,
        { provide: ImageUploadsService, useValue: imageUploads },
        { provide: LimitService, useValue: limitService },
      ],
    }).compile();

    service = module.get<StorytimeImageService>(StorytimeImageService);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('storing an upload', () => {
    it('hands an acceptable banner to the upload pipeline', async () => {
      const file = buildFile(buildJpeg(2400, 480));

      const imageId = await service.store({
        slot: StorytimeImageSlot.STORY_BANNER,
        userId,
        entityId,
        file,
      });

      expect(imageId).toBe('image-id');
      expect(imageUploads.uploadImageToCloudflareImages).toHaveBeenCalledWith(
        userId,
        file,
        'storytime-story-banner',
        entityId,
      );
    });

    it('accepts a crop larger than the slot needs', async () => {
      await expect(
        service.store({
          slot: StorytimeImageSlot.STORY_PROFILE,
          userId,
          entityId,
          file: buildFile(buildPng(1200, 1200)),
        }),
      ).resolves.toBe('image-id');
    });

    // A browser crop lands on whole pixels, so a 5:1 banner arrives one pixel
    // out as often as not. Refusing those would refuse crops indistinguishable
    // from the ones accepted.
    it('allows rounding either side of the exact ratio', async () => {
      await expect(
        service.store({
          slot: StorytimeImageSlot.STORY_BANNER,
          userId,
          entityId,
          file: buildFile(buildJpeg(2401, 480)),
        }),
      ).resolves.toBe('image-id');
    });

    it('refuses a file that is not a readable image', async () => {
      await expect(
        service.store({
          slot: StorytimeImageSlot.STORY_BANNER,
          userId,
          entityId,
          file: buildFile(Buffer.from('not an image')),
        }),
      ).rejects.toThrow('That file is not a readable PNG or JPEG image.');
    });

    it('refuses an encoding the slot does not use', async () => {
      await expect(
        service.store({
          slot: StorytimeImageSlot.STORY_BANNER,
          userId,
          entityId,
          file: buildFile(buildPng(2400, 480)),
        }),
      ).rejects.toThrow('must be uploaded as JPEG');
    });

    // The minimum is the size the largest variant delivers, so anything under
    // it would reach a reader enlarged.
    it('refuses a crop smaller than the slot delivers', async () => {
      await expect(
        service.store({
          slot: StorytimeImageSlot.CHAPTER_COVER,
          userId,
          entityId,
          file: buildFile(buildJpeg(640, 360)),
        }),
      ).rejects.toThrow('at least 1920 by 1080');
    });

    it('refuses a crop of the wrong shape', async () => {
      await expect(
        service.store({
          slot: StorytimeImageSlot.CHARACTER_PORTRAIT,
          userId,
          entityId,
          file: buildFile(buildPng(600, 600)),
        }),
      ).rejects.toThrow('must be cropped to 2:3');
    });

    it('refuses an upload larger than the user is allowed', async () => {
      limitService.resolve.mockResolvedValue(1_048_576);

      await expect(
        service.store({
          slot: StorytimeImageSlot.STORY_BANNER,
          userId,
          entityId,
          file: buildFile(buildJpeg(2400, 480), 4_194_304),
        }),
      ).rejects.toThrow('4.0 MB. Storytime images must be 1.0 MB or smaller.');
    });

    it('resolves the size ceiling for the uploading user', async () => {
      await service.store({
        slot: StorytimeImageSlot.STORY_BANNER,
        userId,
        entityId,
        file: buildFile(buildJpeg(2400, 480)),
      });

      expect(limitService.resolve).toHaveBeenCalledWith(
        userId,
        STORYTIME_LIMITS.MAX_UPLOAD_BYTES.key,
        STORYTIME_LIMITS.MAX_UPLOAD_BYTES.defaultValue,
      );
    });

    it('refuses before uploading anything', async () => {
      await expect(
        service.store({
          slot: StorytimeImageSlot.STORY_BANNER,
          userId,
          entityId,
          file: buildFile(Buffer.from('not an image')),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(imageUploads.uploadImageToCloudflareImages).not.toHaveBeenCalled();
    });
  });

  describe('releasing a replaced image', () => {
    it('deletes the image', async () => {
      await service.release('old-image');

      expect(imageUploads.deleteImageFromCloudflareImages).toHaveBeenCalledWith(
        'old-image',
      );
    });

    it('does nothing when there was no image', async () => {
      await service.release(null);

      expect(
        imageUploads.deleteImageFromCloudflareImages,
      ).not.toHaveBeenCalled();
    });

    // The work is already saved by this point, so failing here would report a
    // change as unsuccessful when it had in fact happened.
    it('swallows a deletion failure', async () => {
      imageUploads.deleteImageFromCloudflareImages.mockRejectedValue(
        new Error('Cloudflare said no'),
      );

      await expect(service.release('old-image')).resolves.toBeUndefined();
    });
  });
});
