import { BadRequestException, NotFoundException } from '@nestjs/common';

import { jest } from '@jest/globals';

import { AcceptedAsset } from 'src/file-assets/services/asset-ingress.service';

import { CUSTOM_TRACKING_FEATURE_FLAGS } from '../constants/custom-tracking-feature.constants';
import { CustomTrackingFeatureService } from '../custom-tracking-feature.service';
import { CustomTrackingImageShape } from '../enums/custom-tracking-image-shape.enum';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import { CustomTrackingImageService } from './custom-tracking-image.service';
import { CustomTrackingImagesController } from './custom-tracking-images.controller';

describe('CustomTrackingImagesController', () => {
  const userId = 'user-1';
  const scope = CustomTrackingTargetScope.ACCOUNT;

  const accepted: AcceptedAsset = {
    assetId: 'asset-1',
    status: 'SCANNING',
  };

  const file = { size: 1024, buffer: Buffer.alloc(0) } as Express.Multer.File;

  let controller: CustomTrackingImagesController;
  let accept: jest.Mock<() => Promise<AcceptedAsset>>;
  let findStored: jest.Mock<() => Promise<unknown>>;
  let remove: jest.Mock<() => Promise<void>>;
  let assertFlagEnabled: jest.Mock<() => Promise<void>>;

  beforeEach(() => {
    accept = jest
      .fn<() => Promise<AcceptedAsset>>()
      .mockResolvedValue(accepted);
    remove = jest.fn<() => Promise<void>>().mockResolvedValue();
    findStored = jest.fn<() => Promise<unknown>>().mockResolvedValue({
      cloudflareImageId: 'image-1',
      altText: 'The USS Ares at warp',
      shape: CustomTrackingImageShape.LANDSCAPE,
    });
    assertFlagEnabled = jest.fn<() => Promise<void>>().mockResolvedValue();

    controller = new CustomTrackingImagesController(
      {
        accept,
        remove,
        find: findStored,
      } as unknown as CustomTrackingImageService,
      { assertFlagEnabled } as unknown as CustomTrackingFeatureService,
    );
  });

  describe('accept', () => {
    it('passes the upload through with its description', async () => {
      await expect(
        controller.accept(
          userId,
          'field-1',
          scope,
          'account-1',
          { altText: 'The USS Ares at warp' },
          file,
        ),
      ).resolves.toEqual({ assetId: 'asset-1', status: 'SCANNING' });

      expect(accept).toHaveBeenCalledWith({
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
        controller.accept(
          userId,
          'field-1',
          scope,
          'account-1',
          { altText: 'Something' },
          undefined,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(accept).not.toHaveBeenCalled();
    });

    // The description is refused by the service, which owns that rule; the
    // controller only has to not lose it on the way.
    it('passes an absent description through as empty', async () => {
      await controller.accept(userId, 'field-1', scope, 'account-1', {}, file);

      expect(accept).toHaveBeenCalledWith(
        expect.objectContaining({ altText: '' }),
      );
    });

    it('reports pictures as absent when they are switched off', async () => {
      assertFlagEnabled.mockRejectedValue(new NotFoundException());

      await expect(
        controller.accept(
          userId,
          'field-1',
          scope,
          'account-1',
          { altText: 'Something' },
          file,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(accept).not.toHaveBeenCalled();
    });

    it('requires the pictures capability specifically', async () => {
      await controller.accept(
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

  describe('find', () => {
    it('reports the picture as the editor needs it', async () => {
      await expect(
        controller.find(userId, 'field-1', scope, 'account-1'),
      ).resolves.toEqual({
        imageId: 'image-1',
        altText: 'The USS Ares at warp',
        shape: CustomTrackingImageShape.LANDSCAPE,
      });
    });

    it('reports nothing when the record has no picture', async () => {
      findStored.mockResolvedValue(null);

      await expect(
        controller.find(userId, 'field-1', scope, 'account-1'),
      ).resolves.toBeNull();
    });

    it('reports pictures as absent when they are switched off', async () => {
      assertFlagEnabled.mockRejectedValue(new NotFoundException());

      await expect(
        controller.find(userId, 'field-1', scope, 'account-1'),
      ).rejects.toThrow(NotFoundException);
      expect(findStored).not.toHaveBeenCalled();
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
