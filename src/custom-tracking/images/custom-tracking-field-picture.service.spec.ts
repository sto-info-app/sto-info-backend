import { Logger } from '@nestjs/common';

import { DataSource, EntityManager, In } from 'typeorm';

import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { AssetWithdrawalService } from 'src/file-assets/services/asset-withdrawal.service';

import { CustomTrackingImageValueEntity } from '../entities/custom-tracking-image-value.entity';
import { CustomTrackingValueEntity } from '../entities/custom-tracking-value.entity';
import {
  CUSTOM_TRACKING_FIELD_DELETED_REASON,
  CustomTrackingFieldPicture,
  CustomTrackingFieldPictureService,
} from './custom-tracking-field-picture.service';

const PICTURE: CustomTrackingFieldPicture = {
  imageValueId: 'image-value-1',
  valueId: 'value-1',
  fieldId: 'field-1',
  targetId: 'account-1',
  imageId: 'image-1',
};

describe('CustomTrackingFieldPictureService', () => {
  let service: CustomTrackingFieldPictureService;
  let manager: { find: jest.Mock; delete: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let withdrawal: { withdrawSlot: jest.Mock };

  /**
   * Answers `find` with the values and pictures given.
   *
   * @param values - The answers to the Fields.
   * @param images - The pictures hanging from them.
   */
  const holding = (values: unknown[], images: unknown[]): void => {
    manager.find.mockImplementation((entity: unknown) =>
      Promise.resolve(entity === CustomTrackingValueEntity ? values : images),
    );
  };

  beforeEach(() => {
    manager = {
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    dataSource = {
      transaction: jest.fn((body: (m: EntityManager) => Promise<unknown>) =>
        body(manager as unknown as EntityManager),
      ),
    };
    withdrawal = {
      withdrawSlot: jest.fn().mockResolvedValue({ deleted: true }),
    };
    service = new CustomTrackingFieldPictureService(
      dataSource as unknown as DataSource,
      withdrawal as unknown as AssetWithdrawalService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('detach', () => {
    it('does nothing for no Fields', async () => {
      await expect(
        service.detach(manager as unknown as EntityManager, []),
      ).resolves.toEqual([]);

      expect(manager.find).not.toHaveBeenCalled();
    });

    it('does nothing when nothing answers the Fields', async () => {
      await expect(
        service.detach(manager as unknown as EntityManager, ['field-1']),
      ).resolves.toEqual([]);

      expect(manager.find).toHaveBeenCalledTimes(1);
      expect(manager.delete).not.toHaveBeenCalled();
    });

    it('does nothing when no answer is a picture', async () => {
      holding([{ id: 'value-1', fieldId: 'field-1', accountId: 'a-1' }], []);

      await expect(
        service.detach(manager as unknown as EntityManager, ['field-1']),
      ).resolves.toEqual([]);

      expect(manager.delete).not.toHaveBeenCalled();
    });

    // Answers already deleted count too: their picture is just as published.
    it('removes each picture answer, and the answer it hangs from', async () => {
      holding(
        [
          {
            id: 'value-1',
            fieldId: 'field-1',
            accountId: 'account-1',
            characterId: null,
          },
          {
            id: 'value-2',
            fieldId: 'field-1',
            accountId: null,
            characterId: 'character-1',
          },
        ],
        [
          {
            id: 'image-value-1',
            valueId: 'value-1',
            cloudflareImageId: 'image-1',
          },
          {
            id: 'image-value-2',
            valueId: 'value-2',
            cloudflareImageId: 'image-2',
          },
          // Not one of the answers read: not this deletion's to take.
          { id: 'image-value-3', valueId: 'value-9', cloudflareImageId: 'x' },
        ],
      );

      await expect(
        service.detach(manager as unknown as EntityManager, ['field-1']),
      ).resolves.toEqual([
        PICTURE,
        {
          imageValueId: 'image-value-2',
          valueId: 'value-2',
          fieldId: 'field-1',
          targetId: 'character-1',
          imageId: 'image-2',
        },
      ]);

      expect(manager.find).toHaveBeenCalledWith(CustomTrackingValueEntity, {
        where: { fieldId: In(['field-1']) },
        withDeleted: true,
        select: {
          id: true,
          fieldId: true,
          accountId: true,
          characterId: true,
        },
      });
      expect(manager.delete).toHaveBeenCalledWith(
        CustomTrackingImageValueEntity,
        { id: In(['image-value-1', 'image-value-2']) },
      );
      expect(manager.delete).toHaveBeenCalledWith(CustomTrackingValueEntity, {
        id: In(['value-1', 'value-2']),
      });
    });
  });

  describe('release', () => {
    it('removes the answer, then withdraws the picture', async () => {
      await service.release(PICTURE);

      expect(manager.delete).toHaveBeenCalledWith(
        CustomTrackingImageValueEntity,
        { id: In(['image-value-1']) },
      );
      expect(withdrawal.withdrawSlot).toHaveBeenCalledWith(
        FileAssetSubject.CUSTOM_TRACKING_VALUE,
        'field-1:account-1',
        FileAssetSlot.PICTURE,
        'image-1',
        'Its field was deleted',
      );
      expect(manager.delete.mock.invocationCallOrder[0]).toBeLessThan(
        withdrawal.withdrawSlot.mock.invocationCallOrder[0],
      );
    });

    it('lets a failed withdrawal through', async () => {
      withdrawal.withdrawSlot.mockRejectedValueOnce(new Error('registry down'));

      await expect(service.release(PICTURE)).rejects.toThrow('registry down');
    });
  });

  describe('withdrawEach', () => {
    it('withdraws each picture as its Field having been deleted', async () => {
      await expect(service.withdrawEach([PICTURE, PICTURE])).resolves.toBe(2);

      expect(withdrawal.withdrawSlot).toHaveBeenCalledWith(
        FileAssetSubject.CUSTOM_TRACKING_VALUE,
        'field-1:account-1',
        FileAssetSlot.PICTURE,
        'image-1',
        CUSTOM_TRACKING_FIELD_DELETED_REASON,
      );
    });

    // The deletion has already happened; the purge sweep finds what is owed.
    it('logs a picture it cannot withdraw and goes on to the next', async () => {
      const failed = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      withdrawal.withdrawSlot.mockRejectedValueOnce(new Error('registry down'));

      await expect(service.withdrawEach([PICTURE, PICTURE])).resolves.toBe(1);

      expect(failed).toHaveBeenCalledWith(
        '[withdrawEach] Not withdrawn - FieldId: field-1, TargetId: account-1, ImageId: image-1',
        expect.stringContaining('registry down'),
      );
    });

    it('logs a failure that is not an Error as it is', async () => {
      const failed = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      withdrawal.withdrawSlot.mockRejectedValueOnce('refused');

      await service.withdrawEach([PICTURE]);

      expect(failed).toHaveBeenCalledWith(expect.any(String), 'refused');
    });
  });
});
