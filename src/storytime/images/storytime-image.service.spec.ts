import { BadRequestException, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { LimitService } from 'src/access-control/limit.service';
import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { AssetIngressService } from 'src/file-assets/services/asset-ingress.service';
import { AssetWithdrawalService } from 'src/file-assets/services/asset-withdrawal.service';
import { ImageIngressService } from 'src/file-assets/services/image-ingress.service';
import { ImageSlotService } from 'src/shared/images/image-slot.service';
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
    validateAndSanitiseFile: jest.Mock;
    deleteImageFromCloudflareImages: jest.Mock;
  };
  let ingress: { accept: jest.Mock };
  let withdrawal: { withdrawSlot: jest.Mock };
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
      validateAndSanitiseFile: jest
        .fn()
        .mockImplementation((_userId: string, file: Express.Multer.File) => ({
          fileBuffer: file.buffer,
          safeFileName: file.originalname,
        })),
      deleteImageFromCloudflareImages: jest.fn().mockResolvedValue('image-id'),
    };
    ingress = {
      accept: jest
        .fn()
        .mockResolvedValue({ assetId: 'asset-1', status: 'SCANNING' }),
    };
    withdrawal = {
      withdrawSlot: jest
        .fn()
        .mockResolvedValue({ deleted: true, revoked: true }),
    };
    limitService = {
      resolve: jest
        .fn()
        .mockResolvedValue(STORYTIME_LIMITS.MAX_UPLOAD_BYTES.defaultValue),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeImageService,
        // The real shared checker and the real image front door, not
        // stand-ins. What is worth asserting is that a crop of the wrong
        // shape is never registered at all, and only running the actual
        // checks says that.
        ImageIngressService,
        ImageSlotService,
        { provide: AssetIngressService, useValue: ingress },
        { provide: AssetWithdrawalService, useValue: withdrawal },
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

  describe('accepting an upload', () => {
    it('registers an acceptable banner against its slot', async () => {
      const file = buildFile(buildJpeg(2400, 480));

      const accepted = await service.accept({
        slot: StorytimeImageSlot.STORY_BANNER,
        userId,
        entityId,
        file,
        altText: 'A ship at warp',
      });

      expect(accepted).toEqual({ assetId: 'asset-1', status: 'SCANNING' });
      expect(ingress.accept).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: FileAssetSubject.STORYTIME_STORY,
          slot: FileAssetSlot.BANNER,
          subjectId: entityId,
          entityTag: 'storytime-story-banner',
          detectedContentType: 'image/jpeg',
          feature: { altText: 'A ship at warp' },
        }),
      );
    });

    // The description belongs to the picture. Writing it onto the work now
    // would describe whatever the work is still showing.
    it('carries the description through rather than writing it now', async () => {
      await service.accept({
        slot: StorytimeImageSlot.CHAPTER_COVER,
        userId,
        entityId,
        file: buildFile(buildJpeg(1920, 1080)),
        altText: 'The bridge, in flames',
      });

      expect(ingress.accept).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: { altText: 'The bridge, in flames' },
        }),
      );
    });

    it('accepts a crop larger than the slot needs', async () => {
      await expect(
        service.accept({
          slot: StorytimeImageSlot.STORY_PROFILE,
          userId,
          entityId,
          altText: 'Something the picture shows',
          file: buildFile(buildPng(1200, 1200)),
        }),
      ).resolves.toEqual({ assetId: 'asset-1', status: 'SCANNING' });
    });

    // A browser crop lands on whole pixels, so a 5:1 banner arrives one pixel
    // out as often as not. Refusing those would refuse crops indistinguishable
    // from the ones accepted.
    it('allows rounding either side of the exact ratio', async () => {
      await expect(
        service.accept({
          slot: StorytimeImageSlot.STORY_BANNER,
          userId,
          entityId,
          altText: 'Something the picture shows',
          file: buildFile(buildJpeg(2401, 480)),
        }),
      ).resolves.toEqual({ assetId: 'asset-1', status: 'SCANNING' });
    });

    it('refuses a file that is not a readable image', async () => {
      await expect(
        service.accept({
          slot: StorytimeImageSlot.STORY_BANNER,
          userId,
          entityId,
          altText: 'Something the picture shows',
          file: buildFile(Buffer.from('not an image')),
        }),
      ).rejects.toThrow('That file is not a readable PNG or JPEG image.');
    });

    it('refuses an encoding the slot does not use', async () => {
      await expect(
        service.accept({
          slot: StorytimeImageSlot.STORY_BANNER,
          userId,
          entityId,
          altText: 'Something the picture shows',
          file: buildFile(buildPng(2400, 480)),
        }),
      ).rejects.toThrow('must be uploaded as JPEG');
    });

    // The minimum is the size the smallest variant delivers, so under it even
    // the compact rendering would reach a reader enlarged.
    it('refuses a crop smaller than the slot can use at all', async () => {
      await expect(
        service.accept({
          slot: StorytimeImageSlot.CHAPTER_COVER,
          userId,
          entityId,
          altText: 'Something the picture shows',
          file: buildFile(buildJpeg(320, 180)),
        }),
      ).rejects.toThrow('at least 640 by 360');
    });

    // Between the minimum and the recommended size only the largest variant
    // has to enlarge the crop. The editor warns about that; the server takes
    // it, because refusing turned away artwork its creator was content with.
    it('accepts a crop below the recommended size but above the minimum', async () => {
      await expect(
        service.accept({
          slot: StorytimeImageSlot.CHAPTER_COVER,
          userId,
          entityId,
          altText: 'Something the picture shows',
          file: buildFile(buildJpeg(1280, 720)),
        }),
      ).resolves.toBeDefined();
    });

    it('refuses a crop of the wrong shape', async () => {
      await expect(
        service.accept({
          slot: StorytimeImageSlot.CHARACTER_PORTRAIT,
          userId,
          entityId,
          altText: 'Something the picture shows',
          file: buildFile(buildPng(600, 600)),
        }),
      ).rejects.toThrow('must be cropped to 2:3');
    });

    it('refuses an upload larger than the user is allowed', async () => {
      limitService.resolve.mockResolvedValue(1_048_576);

      await expect(
        service.accept({
          slot: StorytimeImageSlot.STORY_BANNER,
          userId,
          entityId,
          altText: 'Something the picture shows',
          file: buildFile(buildJpeg(2400, 480), 4_194_304),
        }),
      ).rejects.toThrow('4.0 MB. Storytime images must be 1.0 MB or smaller.');
    });

    it('resolves the size ceiling for the uploading user', async () => {
      await service.accept({
        slot: StorytimeImageSlot.STORY_BANNER,
        userId,
        entityId,
        altText: 'Something the picture shows',
        file: buildFile(buildJpeg(2400, 480)),
      });

      expect(limitService.resolve).toHaveBeenCalledWith(
        userId,
        STORYTIME_LIMITS.MAX_UPLOAD_BYTES.key,
        STORYTIME_LIMITS.MAX_UPLOAD_BYTES.defaultValue,
      );
    });

    it('refuses before registering anything', async () => {
      await expect(
        service.accept({
          slot: StorytimeImageSlot.STORY_BANNER,
          userId,
          entityId,
          altText: 'Something the picture shows',
          file: buildFile(Buffer.from('not an image')),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(ingress.accept).not.toHaveBeenCalled();
    });
  });

  describe('withdrawing a removed image', () => {
    it('withdraws it through the registry rather than deleting it', async () => {
      await service.withdraw(
        StorytimeImageSlot.ARC_PROFILE,
        entityId,
        'old-image',
      );

      expect(withdrawal.withdrawSlot).toHaveBeenCalledWith(
        FileAssetSubject.STORYTIME_ARC,
        entityId,
        FileAssetSlot.PROFILE,
        'old-image',
        'Removed by the owner',
      );
    });

    // The slot is emptied whether or not anything was in it, because a
    // placement can outlive the reference the work held.
    it('still settles the slot when there was no image', async () => {
      await service.withdraw(StorytimeImageSlot.ARC_PROFILE, entityId, null);

      expect(withdrawal.withdrawSlot).toHaveBeenCalledWith(
        FileAssetSubject.STORYTIME_ARC,
        entityId,
        FileAssetSlot.PROFILE,
        null,
        'Removed by the owner',
      );
    });

    it('treats an absent image and an undefined one alike', async () => {
      await service.withdraw(
        StorytimeImageSlot.SPOTLIGHT_OVERRIDE,
        entityId,
        undefined,
      );

      expect(withdrawal.withdrawSlot).toHaveBeenCalledWith(
        FileAssetSubject.STORYTIME_SPOTLIGHT,
        entityId,
        FileAssetSlot.OVERRIDE,
        null,
        'Removed by the owner',
      );
    });
  });
});
