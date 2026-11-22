import { InternalServerErrorException, Logger } from '@nestjs/common';

import { jest } from '@jest/globals';

import { ScanRequestProducerService } from 'src/file-scanning/services/scan-request-producer.service';

import { FileAssetAudience } from '../enums/file-asset-audience.enum';
import { FileAssetKind } from '../enums/file-asset-kind.enum';
import { FileAssetPlacementState } from '../enums/file-asset-placement-state.enum';
import { FileAssetSlot } from '../enums/file-asset-slot.enum';
import { FileAssetState } from '../enums/file-asset-state.enum';
import { FileAssetSubject } from '../enums/file-asset-subject.enum';
import {
  AssetIngressRequest,
  AssetIngressService,
} from './asset-ingress.service';
import { AssetPublisherRegistry } from './asset-publisher.registry';
import { FileAssetPlacementService } from './file-asset-placement.service';
import { FileAssetService } from './file-asset.service';
import { QuarantineStorageService } from './quarantine-storage.service';

/** One upload, as a caller describes it. */
const request = (
  overrides: Partial<AssetIngressRequest> = {},
): AssetIngressRequest => ({
  kind: FileAssetKind.STORYTIME_IMAGE,
  audience: FileAssetAudience.PUBLIC,
  subject: FileAssetSubject.STORYTIME_STORY,
  subjectId: 'story-1',
  slot: FileAssetSlot.BANNER,
  ownerUserId: 'user-1',
  bytes: Buffer.from('a picture'),
  declaredContentType: 'image/jpeg',
  detectedContentType: 'image/jpeg',
  originalFilename: 'banner.jpg',
  entityTag: 'storytime-story-banner',
  entityId: 'story-1',
  feature: { altText: 'A ship' },
  ...overrides,
});

describe('AssetIngressService', () => {
  /** The SHA-256 of the bytes every case uploads. */
  const SHA256 =
    '92b2fa58028958317e408bd84ecfa70f5ee35b121991dbc232c49d166353708b';

  let register: jest.Mock<(...args: any[]) => Promise<any>>;
  let recordStored: jest.Mock<(...args: any[]) => Promise<any>>;
  let findById: jest.Mock<(...args: any[]) => Promise<any>>;
  let discard: jest.Mock<(...args: any[]) => Promise<any>>;
  let placePending: jest.Mock<(...args: any[]) => Promise<any>>;
  let put: jest.Mock<(...args: any[]) => Promise<any>>;
  let remove: jest.Mock<(...args: any[]) => Promise<any>>;
  let requestScan: jest.Mock<(...args: any[]) => Promise<any>>;
  let require_: jest.Mock;
  let service: AssetIngressService;

  beforeEach(() => {
    register = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue({ id: 'asset-1' });
    recordStored = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue({ id: 'asset-1', state: FileAssetState.QUARANTINED });
    findById = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue({ id: 'asset-0', objectKey: 'test/assets/asset-0' });
    discard = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({});
    placePending = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue({
        placement: { id: 'placement-1' },
        superseded: null,
      });
    put = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({
      objectKey: 'test/assets/asset-1',
      objectVersion: null,
    });
    remove = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue(undefined);
    requestScan = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue({
        asset: { id: 'asset-1', state: FileAssetState.SCANNING },
        traceId: 'trace-1',
      });
    require_ = jest.fn();

    service = new AssetIngressService(
      {
        register,
        recordStored,
        findById,
        discard,
      } as unknown as FileAssetService,
      { placePending } as unknown as FileAssetPlacementService,
      { require: require_ } as unknown as AssetPublisherRegistry,
      {
        buildObjectKey: (assetId: string) => `test/assets/${assetId}`,
        put,
        remove,
      } as unknown as QuarantineStorageService,
      { requestScan } as unknown as ScanRequestProducerService,
    );

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers, quarantines, claims the slot and asks for a scan', async () => {
    await expect(service.accept(request())).resolves.toEqual({
      assetId: 'asset-1',
      status: 'SCANNING',
    });

    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: FileAssetKind.STORYTIME_IMAGE,
        audience: FileAssetAudience.PUBLIC,
        ownerUserId: 'user-1',
        declaredContentType: 'image/jpeg',
        originalFilename: 'banner.jpg',
      }),
    );
    expect(put).toHaveBeenCalledWith(
      'test/assets/asset-1',
      Buffer.from('a picture'),
    );
    expect(requestScan).toHaveBeenCalled();
  });

  // The row comes before the bytes: an object in the bucket with no row is
  // the one thing no inventory and no rescan campaign can reach.
  it('writes the row before the bytes', async () => {
    const order: string[] = [];

    register.mockImplementation(() => {
      order.push('register');

      return Promise.resolve({ id: 'asset-1' });
    });
    put.mockImplementation(() => {
      order.push('put');

      return Promise.resolve({
        objectKey: 'test/assets/asset-1',
        objectVersion: null,
      });
    });

    await service.accept(request());

    expect(order).toEqual(['register', 'put']);
  });

  it('binds the verdict to the bytes by hashing them', async () => {
    await service.accept(request());

    expect(recordStored).toHaveBeenCalledWith(
      'asset-1',
      expect.objectContaining({
        sha256: SHA256,
        byteSize: 9,
        detectedContentType: 'image/jpeg',
      }),
    );
  });

  it('keeps what the publisher will need', async () => {
    await service.accept(request());

    expect(placePending).toHaveBeenCalledWith({
      assetId: 'asset-1',
      subject: FileAssetSubject.STORYTIME_STORY,
      subjectId: 'story-1',
      slot: FileAssetSlot.BANNER,
      detail: {
        entityTag: 'storytime-story-banner',
        entityId: 'story-1',
        feature: { altText: 'A ship' },
      },
    });
  });

  it('keeps nothing for a feature that asked for nothing', async () => {
    await service.accept(request({ feature: undefined }));

    expect(placePending).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ feature: null }),
      }),
    );
  });

  // A subject with no publisher is a wiring mistake, and an upload is a
  // better place to discover one than an asset stuck at CLEAN an hour
  // later.
  it('refuses an upload nothing could ever publish', async () => {
    require_.mockImplementation(() => {
      throw new InternalServerErrorException('No publisher is registered');
    });

    await expect(service.accept(request())).rejects.toThrow(
      InternalServerErrorException,
    );
    expect(register).not.toHaveBeenCalled();
  });

  describe('when a newer upload overtakes an older one', () => {
    beforeEach(() => {
      placePending.mockResolvedValue({
        placement: { id: 'placement-2' },
        superseded: {
          id: 'placement-1',
          assetId: 'asset-0',
          state: FileAssetPlacementState.SUPERSEDED,
        },
      });
    });

    it('drops the older upload’s bytes and abandons its asset', async () => {
      await service.accept(request());

      expect(remove).toHaveBeenCalledWith('test/assets/asset-0');
      expect(discard).toHaveBeenCalledWith(
        'asset-0',
        'Superseded by a later upload',
      );
    });

    it('has nothing to drop when the older asset has gone', async () => {
      findById.mockResolvedValue(null);

      await service.accept(request());

      expect(remove).not.toHaveBeenCalled();
      expect(discard).not.toHaveBeenCalled();
    });

    it('has nothing to drop when the older asset never stored anything', async () => {
      findById.mockResolvedValue({ id: 'asset-0', objectKey: null });

      await service.accept(request());

      expect(remove).not.toHaveBeenCalled();
      expect(discard).toHaveBeenCalled();
    });

    // Refusing somebody's portrait because a previous attempt could not be
    // tidied away would be absurd.
    it.each([
      ['an error', new Error('the bucket said no')],
      ['something that is not an error', 'the bucket said no'],
    ])(
      'accepts the new upload when tidying up fails with %s',
      async (_name, failure) => {
        remove.mockRejectedValue(failure);

        await expect(service.accept(request())).resolves.toEqual({
          assetId: 'asset-1',
          status: 'SCANNING',
        });
      },
    );
  });
});
