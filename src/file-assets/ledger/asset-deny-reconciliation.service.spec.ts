import { Logger } from '@nestjs/common';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { AxiosError, AxiosResponse } from 'axios';
import { Repository } from 'typeorm';

import { LEDGER_CHUNK_SIZE, LedgerKey } from 'src/shared/ledger/ledger.utility';
import { ImageUploadsService } from 'src/shared/utilities/image-uploads.service';

import { InMemoryManager, Row } from '../../../test/in-memory-manager';
import { FileAssetPlacementEntity } from '../entities/file-asset-placement.entity';
import { FileAssetEntity } from '../entities/file-asset.entity';
import { FileAssetPlacementState } from '../enums/file-asset-placement-state.enum';
import { FileAssetState } from '../enums/file-asset-state.enum';
import { FileAssetStorage } from '../enums/file-asset-storage.enum';
import { AssetWithdrawalService } from '../services/asset-withdrawal.service';
import { FileAssetPlacementService } from '../services/file-asset-placement.service';
import { FileAssetService } from '../services/file-asset.service';
import {
  AssetDenyLedgerService,
  AssetDenyMarker,
} from './asset-deny-ledger.service';
import {
  ASSET_DENY_REPLAYED_CODE,
  ASSET_DENY_REPLAYED_REASON,
  AssetDenyReconciliationService,
} from './asset-deny-reconciliation.service';

/**
 * An asset ID that sorts by its number.
 *
 * @param n - The number.
 * @returns The ID.
 */
const assetId = (n: number): string =>
  `31000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('AssetDenyReconciliationService (FC-042)', () => {
  let db: InMemoryManager;
  let markers: AssetDenyMarker[];
  let ledger: {
    listKeys: jest.Mock<() => Promise<LedgerKey[]>>;
    read: jest.Mock<(key: string) => Promise<AssetDenyMarker>>;
    write: jest.Mock<(marker: AssetDenyMarker) => Promise<void>>;
  };
  let fileAssets: {
    reject: jest.Mock<(id: string, code: string) => Promise<unknown>>;
    revoke: jest.Mock<(id: string, reason: string) => Promise<unknown>>;
    discard: jest.Mock<(id: string, reason: string) => Promise<unknown>>;
  };
  let placements: {
    findByAssetId: jest.Mock<(id: string) => Promise<Row | null>>;
    settle: jest.Mock<(placement: Row, state: string) => Promise<unknown>>;
  };
  let withdrawal: {
    withdrawByReference: jest.Mock<
      (reference: string, reason: string) => Promise<unknown>
    >;
  };
  let images: {
    ready: jest.Mock<() => Promise<void>>;
    deleteR2Object: jest.Mock<(key: string) => Promise<void>>;
    deleteImageFromCloudflareImages: jest.Mock<(id: string) => Promise<string>>;
  };
  let service: AssetDenyReconciliationService;

  /**
   * The key a marker is listed under.
   *
   * @param marker - The marker.
   * @returns Its key.
   */
  const keyOf = (marker: AssetDenyMarker): LedgerKey => ({
    key: `test/asset-deny-ledger/${marker.createdAt}_${marker.assetId}_${marker.state}.json`,
    createdAt: marker.createdAt,
    id: marker.assetId,
    kind: marker.state,
  });

  /**
   * A deny, as the ledger keeps it.
   *
   * @param n - The asset's number.
   * @param state - The denied state.
   * @param overrides - What differs.
   * @returns It.
   */
  const deny = (
    n: number,
    state: FileAssetState,
    overrides: Partial<AssetDenyMarker> = {},
  ): AssetDenyMarker => ({
    assetId: assetId(n),
    state,
    deliveryReference: null,
    storage: FileAssetStorage.QUARANTINE,
    createdAt: '2026-09-20T12:00:00.000Z',
    ...overrides,
  });

  /**
   * An asset, as the database has it.
   *
   * @param n - Its number.
   * @param state - Its state.
   * @param overrides - What differs.
   * @returns It.
   */
  const asset = (
    n: number,
    state: FileAssetState,
    overrides: Row = {},
  ): Row => ({
    id: assetId(n),
    state,
    storage: FileAssetStorage.QUARANTINE,
    deliveryReference: null,
    withdrawnAt: null,
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  });

  beforeEach(() => {
    db = new InMemoryManager();
    markers = [];
    ledger = {
      listKeys: jest.fn(async () => markers.map(keyOf)),
      read: jest.fn(
        async (key: string) =>
          markers.find(marker => keyOf(marker).key === key) as AssetDenyMarker,
      ),
      write: jest.fn(async () => undefined),
    };
    fileAssets = {
      reject: jest.fn(async () => ({})),
      revoke: jest.fn(async () => ({})),
      discard: jest.fn(async () => ({})),
    };
    placements = {
      findByAssetId: jest.fn(async (id: string) =>
        db.findOne(FileAssetPlacementEntity, { where: { assetId: id } }),
      ),
      settle: jest.fn(async (placement: Row, state: string) => {
        placement.state = state;

        return placement;
      }),
    };
    withdrawal = { withdrawByReference: jest.fn(async () => ({})) };
    images = {
      ready: jest.fn(async () => undefined),
      deleteR2Object: jest.fn(async () => undefined),
      deleteImageFromCloudflareImages: jest.fn(async (id: string) => id),
    };
    service = new AssetDenyReconciliationService(
      {
        find: (options: object) => db.find(FileAssetEntity, options),
      } as unknown as Repository<FileAssetEntity>,
      ledger as unknown as AssetDenyLedgerService,
      fileAssets as unknown as FileAssetService,
      placements as unknown as FileAssetPlacementService,
      withdrawal as unknown as AssetWithdrawalService,
      images as unknown as ImageUploadsService,
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('a deny the database lacks', () => {
    it('withdraws a picture still served, emptying its slot and deleting it again', async () => {
      db.seed(FileAssetEntity, [
        asset(1, FileAssetState.AVAILABLE, {
          storage: FileAssetStorage.PUBLIC_IMAGES,
          deliveryReference: 'cf-image-1',
        }),
      ]);
      db.seed(FileAssetPlacementEntity, [
        { id: 'placement-1', assetId: assetId(1), state: 'ACTIVE' },
      ]);
      markers = [deny(1, FileAssetState.REVOKED)];

      const outcome = await service.reconcile();

      expect(outcome).toEqual({
        markers: 1,
        replayed: 1,
        backfilled: 0,
        detail: {
          withdrawn: 1,
          denied: 0,
          purged: 0,
          alreadyPurged: 0,
          nothingDelivered: 0,
          purgeFailed: 0,
        },
        timings: {
          list: expect.any(Number),
          compare: expect.any(Number),
          replay: expect.any(Number),
          backfill: expect.any(Number),
        },
      });
      expect(images.ready).toHaveBeenCalled();
      expect(placements.settle).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'placement-1' }),
        FileAssetPlacementState.WITHDRAWN,
      );
      expect(withdrawal.withdrawByReference).toHaveBeenCalledWith(
        'cf-image-1',
        ASSET_DENY_REPLAYED_REASON,
      );
      // The body of a marker whose asset the database has is never read.
      expect(ledger.read).not.toHaveBeenCalled();
    });

    it('revokes a privately delivered one, which has nothing at Cloudflare', async () => {
      db.seed(FileAssetEntity, [asset(1, FileAssetState.UNVERIFIED)]);
      db.seed(FileAssetPlacementEntity, [
        { id: 'placement-1', assetId: assetId(1), state: 'WITHDRAWN' },
      ]);
      markers = [deny(1, FileAssetState.DELETED)];

      await expect(service.reconcile()).resolves.toMatchObject({
        replayed: 1,
        detail: { withdrawn: 1 },
      });
      expect(fileAssets.revoke).toHaveBeenCalledWith(
        assetId(1),
        ASSET_DENY_REPLAYED_REASON,
      );
      expect(placements.settle).not.toHaveBeenCalled();
      expect(withdrawal.withdrawByReference).not.toHaveBeenCalled();
    });

    it('refuses again one not yet served that was refused, emptying its slot', async () => {
      db.seed(FileAssetEntity, [asset(1, FileAssetState.SCANNING)]);
      db.seed(FileAssetPlacementEntity, [
        { id: 'placement-1', assetId: assetId(1), state: 'PENDING' },
      ]);
      markers = [deny(1, FileAssetState.REJECTED)];

      await expect(service.reconcile()).resolves.toMatchObject({
        detail: { denied: 1 },
      });
      expect(fileAssets.reject).toHaveBeenCalledWith(
        assetId(1),
        ASSET_DENY_REPLAYED_CODE,
      );
      expect(placements.settle).toHaveBeenCalled();
    });

    it('fails closed to deleted for one not yet served that was withdrawn later', async () => {
      db.seed(FileAssetEntity, [asset(1, FileAssetState.CLEAN)]);
      // Two markers for one asset: the latest decides.
      markers = [
        deny(1, FileAssetState.REJECTED, {
          createdAt: '2026-09-10T12:00:00.000Z',
        }),
        deny(1, FileAssetState.REVOKED),
      ];

      await expect(service.reconcile()).resolves.toMatchObject({
        markers: 2,
        detail: { denied: 1 },
      });
      expect(fileAssets.discard).toHaveBeenCalledWith(
        assetId(1),
        ASSET_DENY_REPLAYED_REASON,
      );
      expect(fileAssets.reject).not.toHaveBeenCalled();
    });

    it('leaves one already denied, fetching no secrets', async () => {
      db.seed(FileAssetEntity, [
        asset(1, FileAssetState.REVOKED, {
          withdrawnAt: new Date('2026-09-20T12:00:00.000Z'),
        }),
      ]);
      markers = [deny(1, FileAssetState.REVOKED)];

      await expect(service.reconcile()).resolves.toMatchObject({
        markers: 1,
        replayed: 0,
        backfilled: 0,
      });
      expect(images.ready).not.toHaveBeenCalled();
    });
  });

  describe('an asset the database never had', () => {
    it.each([
      [
        'a Cloudflare image',
        FileAssetStorage.PUBLIC_IMAGES,
        'deleteImageFromCloudflareImages',
      ],
      [
        'a legacy R2 object',
        FileAssetStorage.LEGACY_PUBLIC_R2,
        'deleteR2Object',
      ],
    ] as const)(
      'deletes %s it named, and notes when',
      async (_what, storage, call) => {
        markers = [
          deny(1, FileAssetState.REVOKED, {
            storage,
            deliveryReference: 'reference-1',
          }),
        ];

        await expect(service.reconcile()).resolves.toMatchObject({
          replayed: 1,
          detail: { purged: 1 },
        });
        expect(images[call]).toHaveBeenCalledWith('reference-1');
        expect(ledger.write).toHaveBeenCalledWith({
          ...markers[0],
          purgedAt: expect.any(String),
        });
      },
    );

    it('counts an object already gone as deleted', async () => {
      images.deleteImageFromCloudflareImages.mockRejectedValue(
        new AxiosError('Not found', '404', undefined, undefined, {
          status: 404,
        } as AxiosResponse),
      );
      markers = [
        deny(1, FileAssetState.REVOKED, {
          storage: FileAssetStorage.PUBLIC_IMAGES,
          deliveryReference: 'cf-image-1',
        }),
      ];

      await expect(service.reconcile()).resolves.toMatchObject({
        detail: { purged: 1 },
      });
    });

    it.each([
      [
        'Cloudflare cannot be reached',
        new AxiosError('Server error', '500', undefined, undefined, {
          status: 500,
        } as AxiosResponse),
      ],
      ['the delete fails otherwise', new Error('Socket hang up')],
      ['something odd is thrown', 'odd'],
    ])(
      'reports rather than throws when %s, for the next boot to try again',
      async (_what, error) => {
        images.deleteImageFromCloudflareImages.mockRejectedValue(error);
        markers = [
          deny(1, FileAssetState.REVOKED, {
            storage: FileAssetStorage.PUBLIC_IMAGES,
            deliveryReference: 'cf-image-1',
          }),
        ];

        await expect(service.reconcile()).resolves.toMatchObject({
          replayed: 0,
          detail: { purgeFailed: 1 },
        });
        expect(ledger.write).not.toHaveBeenCalled();
      },
    );

    it('deletes nothing that was never delivered, or already deleted', async () => {
      markers = [
        deny(1, FileAssetState.DELETED),
        deny(2, FileAssetState.REVOKED, {
          deliveryReference: 'cf-image-2',
          purgedAt: '2026-09-21T00:00:00.000Z',
        }),
      ];

      await expect(service.reconcile()).resolves.toMatchObject({
        replayed: 0,
        detail: { nothingDelivered: 1, alreadyPurged: 1 },
      });
      expect(images.deleteImageFromCloudflareImages).not.toHaveBeenCalled();
    });
  });

  describe('completing the ledger', () => {
    it('writes a marker for every denied asset it lacks, a chunk of the database at a time', async () => {
      db.seed(
        FileAssetEntity,
        Array.from({ length: LEDGER_CHUNK_SIZE + 1 }, (_, n) =>
          asset(n + 1, FileAssetState.DELETED),
        ),
      );
      db.seed(FileAssetEntity, [
        asset(LEDGER_CHUNK_SIZE + 2, FileAssetState.REJECTED, {
          storage: FileAssetStorage.NONE,
          deliveryReference: 'cf-image',
          withdrawnAt: new Date('2026-09-02T00:00:00.000Z'),
        }),
        asset(LEDGER_CHUNK_SIZE + 3, FileAssetState.AVAILABLE),
      ]);
      markers = [deny(1, FileAssetState.DELETED)];

      await expect(service.reconcile()).resolves.toMatchObject({
        markers: 1,
        replayed: 0,
        backfilled: LEDGER_CHUNK_SIZE + 1,
      });
      expect(ledger.write).toHaveBeenCalledWith({
        assetId: assetId(2),
        state: FileAssetState.DELETED,
        deliveryReference: null,
        storage: FileAssetStorage.QUARANTINE,
        createdAt: '2026-09-01T00:00:00.000Z',
      });
      expect(ledger.write).toHaveBeenCalledWith({
        assetId: assetId(LEDGER_CHUNK_SIZE + 2),
        state: FileAssetState.REJECTED,
        deliveryReference: 'cf-image',
        storage: FileAssetStorage.NONE,
        createdAt: '2026-09-02T00:00:00.000Z',
      });
    });

    it('asks after many markers’ assets a chunk at a time', async () => {
      markers = Array.from({ length: LEDGER_CHUNK_SIZE + 1 }, (_, n) =>
        deny(n + 1, FileAssetState.DELETED),
      );

      await expect(service.reconcile()).resolves.toMatchObject({
        markers: LEDGER_CHUNK_SIZE + 1,
        detail: { nothingDelivered: LEDGER_CHUNK_SIZE + 1 },
      });
    });
  });
});
