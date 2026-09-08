import { BadRequestException, NotFoundException } from '@nestjs/common';

import { jest } from '@jest/globals';

import { CUSTOM_TRACKING_FEATURE_FLAGS } from '../constants/custom-tracking-feature.constants';
import { CustomTrackingFeatureService } from '../custom-tracking-feature.service';
import { CustomTrackingImageValueEntity } from '../entities/custom-tracking-image-value.entity';
import { CustomTrackingImageShape } from '../enums/custom-tracking-image-shape.enum';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import { CustomTrackingImageService } from './custom-tracking-image.service';
import { CustomTrackingImagesController } from './custom-tracking-images.controller';

describe('CustomTrackingImagesController', () => {
  const userId = 'user-1';
  const scope = CustomTrackingTargetScope.ACCOUNT;

  const stored = {
    cloudflareImageId: 'image-1',
    altText: 'The USS Ares at warp',
    shape: CustomTrackingImageShape.LANDSCAPE,
  } as CustomTrackingImageValueEntity;

  const file = { size: 1024, buffer: Buffer.alloc(0) } as Express.Multer.File;

  let controller: CustomTrackingImagesController;
  let store: jest.Mock<() => Promise<CustomTrackingImageValueEntity>>;
  let remove: jest.Mock<() => Promise<void>>;
  let assertFlagEnabled: jest.Mock<() => Promise<void>>;

  beforeEach(() => {
    store = jest
      .fn<() => Promise<CustomTrackingImageValueEntity>>()
      .mockResolvedValue(stored);
    remove = jest.fn<() => Promise<void>>().mockResolvedValue();
    assertFlagEnabled = jest.fn<() => Promise<void>>().mockResolvedValue();

    controller = new CustomTrackingImagesController(
      { store, remove } as unknown as CustomTrackingImageService,
      { assertFlagEnabled } as unknown as CustomTrackingFeatureService,
    );
  });

  describe('store', () => {
    it('passes the upload through with its description', async () => {
      await expect(
        controller.store(
          userId,
          'field-1',
          scope,
          'account-1',
          { altText: 'The USS Ares at warp' },
          file,
        ),
      ).resolves.toEqual({
        imageId: 'image-1',
        altText: 'The USS Ares at warp',
        shape: CustomTrackingImageShape.LANDSCAPE,
      });

      expect(store).toHaveBeenCalledWith({
        userId,
        fieldId: 'field-1',
        scope,
        targetId: 'account-1',
        altText: 'The USS Ares at warp',
        file,
      });
    });

    // Multer leaves the file undefined when the part is missing or the filter
    // rejected it, and nothing below should have to guess at that.
    it('refuses a request that carried no file', async () => {
      await expect(
        controller.store(
          userId,
          'field-1',
          scope,
          'account-1',
          { altText: 'Something' },
          undefined,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(store).not.toHaveBeenCalled();
    });

    // The description is refused by the service, which owns that rule; the
    // controller only has to not lose it on the way.
    it('passes an absent description through as empty', async () => {
      await controller.store(userId, 'field-1', scope, 'account-1', {}, file);

      expect(store).toHaveBeenCalledWith(
        expect.objectContaining({ altText: '' }),
      );
    });

    it('reports pictures as absent when they are switched off', async () => {
      assertFlagEnabled.mockRejectedValue(new NotFoundException());

      await expect(
        controller.store(
          userId,
          'field-1',
          scope,
          'account-1',
          { altText: 'Something' },
          file,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(store).not.toHaveBeenCalled();
    });

    it('requires the pictures capability specifically', async () => {
      await controller.store(
        userId,
        'field-1',
        scope,
        'account-1',
        { altText: 'Something' },
        file,
      );

      expect(assertFlagEnabled).toHaveBeenCalledWith(
        CUSTOM_TRACKING_FEATURE_FLAGS.IMAGES_ENABLED,
      );
    });
  });

  describe('remove', () => {
    it('removes the picture for that field and record', async () => {
      await expect(
        controller.remove(userId, 'field-1', scope, 'account-1'),
      ).resolves.toBeUndefined();

      expect(remove).toHaveBeenCalledWith(
        userId,
        'field-1',
        scope,
        'account-1',
      );
    });

    it('reports pictures as absent when they are switched off', async () => {
      assertFlagEnabled.mockRejectedValue(new NotFoundException());

      await expect(
        controller.remove(userId, 'field-1', scope, 'account-1'),
      ).rejects.toThrow(NotFoundException);
      expect(remove).not.toHaveBeenCalled();
    });
  });
});
