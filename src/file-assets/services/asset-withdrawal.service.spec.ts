import { Logger } from '@nestjs/common';

import { jest } from '@jest/globals';

import { ImageUploadsService } from 'src/shared/utilities/image-uploads.service';

import { FileAssetEntity } from '../entities/file-asset.entity';
import { FileAssetPlacementState } from '../enums/file-asset-placement-state.enum';
import { FileAssetSlot } from '../enums/file-asset-slot.enum';
import { FileAssetState } from '../enums/file-asset-state.enum';
import { FileAssetSubject } from '../enums/file-asset-subject.enum';
import { AssetWithdrawalService } from './asset-withdrawal.service';
import { FileAssetPlacementService } from './file-asset-placement.service';
import { FileAssetService } from './file-asset.service';

/**
 * Builds an asset row.
 *
 * @param overrides - Whatever the case is actually about.
 * @returns The asset.
 */
const asset = (overrides: Partial<FileAssetEntity> = {}): FileAssetEntity =>
  ({
    id: 'asset-1',
    state: FileAssetState.AVAILABLE,
    deliveryReference: 'image-1',
    purgeRequiredAt: null,
    ...overrides,
  }) as FileAssetEntity;

describe('AssetWithdrawalService', () => {
  let findByDeliveryReference: jest.Mock<(...args: any[]) => Promise<any>>;
  let findById: jest.Mock<(...args: any[]) => Promise<any>>;
  let revoke: jest.Mock<(...args: any[]) => Promise<any>>;
  let confirmPurged: jest.Mock<(...args: any[]) => Promise<any>>;
  let findActiveForSlot: jest.Mock<(...args: any[]) => Promise<any>>;
  let settle: jest.Mock<(...args: any[]) => Promise<any>>;
  let deleteImageFromCloudflareImages: jest.Mock<
    (...args: any[]) => Promise<any>
  >;
  let service: AssetWithdrawalService;

  beforeEach(() => {
    findByDeliveryReference = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue(asset());
    findById = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue(asset({ purgeRequiredAt: new Date() }));
    revoke = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({});
    confirmPurged = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue({});
    findActiveForSlot = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue(null);
    settle = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({});
    deleteImageFromCloudflareImages = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue('image-1');

    service = new AssetWithdrawalService(
      {
        findByDeliveryReference,
        findById,
        revoke,
        confirmPurged,
      } as unknown as FileAssetService,
      {
        findActiveForSlot,
        settle,
      } as unknown as FileAssetPlacementService,
      { deleteImageFromCloudflareImages } as unknown as ImageUploadsService,
    );

    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('withdrawByReference', () => {
    // The database write comes first, the delete second and the purge
    // record last — ADR-0016.
    it('revokes the row, deletes the object and records the purge', async () => {
      await expect(
        service.withdrawByReference('image-1', 'Replaced'),
      ).resolves.toEqual({ deleted: true, revoked: true });

      expect(revoke).toHaveBeenCalledWith('asset-1', 'Replaced');
      expect(deleteImageFromCloudflareImages).toHaveBeenCalledWith('image-1');
      expect(confirmPurged).toHaveBeenCalledWith('asset-1');
    });

    // The estate is served from UNVERIFIED, so deleting a picture uploaded
    // years ago withdraws its asset exactly as a new one would.
    it('withdraws a legacy asset too', async () => {
      findByDeliveryReference.mockResolvedValue(
        asset({ state: FileAssetState.UNVERIFIED }),
      );

      await expect(
        service.withdrawByReference('image-1', 'Removed'),
      ).resolves.toEqual({ deleted: true, revoked: true });
    });

    // A second withdrawal would rewrite when the first one happened.
    it('leaves an asset that was already withdrawn alone', async () => {
      findByDeliveryReference.mockResolvedValue(
        asset({ state: FileAssetState.REVOKED }),
      );

      await expect(
        service.withdrawByReference('image-1', 'Removed'),
      ).resolves.toEqual({ deleted: true, revoked: false });
      expect(revoke).not.toHaveBeenCalled();
    });

    it('still deletes an image the registry never saw', async () => {
      findByDeliveryReference.mockResolvedValue(null);

      await expect(
        service.withdrawByReference('image-1', 'Removed'),
      ).resolves.toEqual({ deleted: true, revoked: false });
      expect(deleteImageFromCloudflareImages).toHaveBeenCalledWith('image-1');
    });

    // The interval between a revocation and a purge is the window in which
    // the criterion is not yet true, and it has to be visible rather than
    // assumed.
    it.each([
      ['an error', new Error('no')],
      ['something that is not an error', 'no'],
    ])(
      'leaves the purge outstanding when Cloudflare refuses with %s',
      async (_name, failure) => {
        deleteImageFromCloudflareImages.mockRejectedValue(failure);

        await expect(
          service.withdrawByReference('image-1', 'Removed'),
        ).resolves.toEqual({ deleted: false, revoked: true });
        expect(confirmPurged).not.toHaveBeenCalled();
      },
    );

    it('confirms no purge for an asset that never owed one', async () => {
      findById.mockResolvedValue(asset({ purgeRequiredAt: null }));

      await service.withdrawByReference('image-1', 'Removed');

      expect(confirmPurged).not.toHaveBeenCalled();
    });

    it('copes with an asset that has gone between the two reads', async () => {
      findById.mockResolvedValue(null);

      await expect(
        service.withdrawByReference('image-1', 'Removed'),
      ).resolves.toEqual({ deleted: true, revoked: true });
      expect(confirmPurged).not.toHaveBeenCalled();
    });
  });

  describe('withdrawSlot', () => {
    it('settles the placement and withdraws the picture', async () => {
      const placement = { id: 'placement-1' };

      findActiveForSlot.mockResolvedValue(placement);

      await expect(
        service.withdrawSlot(
          FileAssetSubject.STORYTIME_STORY,
          'story-1',
          FileAssetSlot.BANNER,
          'image-1',
          'Removed by the owner',
        ),
      ).resolves.toEqual({ deleted: true, revoked: true });

      expect(settle).toHaveBeenCalledWith(
        placement,
        FileAssetPlacementState.WITHDRAWN,
      );
    });

    // A slot can hold a placement the record's own column never carried,
    // and emptying it is still right.
    it('settles the placement even when nothing was published', async () => {
      findActiveForSlot.mockResolvedValue({ id: 'placement-1' });

      await expect(
        service.withdrawSlot(
          FileAssetSubject.USER_PROFILE,
          'user-1',
          FileAssetSlot.PICTURE,
          null,
          'Removed by the owner',
        ),
      ).resolves.toEqual({ deleted: false, revoked: false });

      expect(settle).toHaveBeenCalled();
      expect(deleteImageFromCloudflareImages).not.toHaveBeenCalled();
    });

    it('withdraws a picture whose slot has no placement', async () => {
      await expect(
        service.withdrawSlot(
          FileAssetSubject.USER_PROFILE,
          'user-1',
          FileAssetSlot.PICTURE,
          'image-1',
          'Removed by the owner',
        ),
      ).resolves.toEqual({ deleted: true, revoked: true });

      expect(settle).not.toHaveBeenCalled();
    });
  });
});
