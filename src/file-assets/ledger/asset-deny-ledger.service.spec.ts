import { ConfigService } from '@nestjs/config';

import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { FileAssetEntity } from '../entities/file-asset.entity';
import { FileAssetState } from '../enums/file-asset-state.enum';
import { FileAssetStorage } from '../enums/file-asset-storage.enum';
import { QuarantineStorageService } from '../services/quarantine-storage.service';
import { AssetDenyLedgerService } from './asset-deny-ledger.service';

const ASSET_ID = '31000000-0000-4000-8000-000000000001';
const AT = '2026-09-30T12:00:00.000Z';

describe('AssetDenyLedgerService (FC-042)', () => {
  const objects = new Map<string, Buffer>();
  const storage = {
    put: jest.fn(async (key: string, body: Buffer) => {
      objects.set(key, body);

      return { objectKey: key, objectVersion: null };
    }),
    listKeys: jest.fn(async (prefix: string) =>
      [...objects.keys()].filter(key => key.startsWith(prefix)),
    ),
    read: jest.fn(async (key: string) => objects.get(key) as Buffer),
  };
  const ledger = new AssetDenyLedgerService(
    storage as unknown as QuarantineStorageService,
    { get: () => 'test' } as unknown as ConfigService,
  );
  const key = `test/asset-deny-ledger/${AT}_${ASSET_ID}_REVOKED.json`;

  afterEach(() => {
    jest.useRealTimers();
  });

  it('records a deny as the asset stood, keeping no reason, name or owner', async () => {
    jest.useFakeTimers({ now: new Date(AT) });

    await ledger.record(
      {
        id: ASSET_ID,
        state: FileAssetState.AVAILABLE,
        storage: FileAssetStorage.PUBLIC_IMAGES,
        deliveryReference: 'cf-image-1',
        ownerUserId: 'owner-1',
        revocationReason: 'Private',
        originalFilename: 'me.png',
      } as FileAssetEntity,
      FileAssetState.REVOKED,
    );

    expect(storage.put).toHaveBeenCalledWith(key, expect.any(Buffer));
    expect(JSON.parse(String(objects.get(key)))).toEqual({
      assetId: ASSET_ID,
      state: FileAssetState.REVOKED,
      deliveryReference: 'cf-image-1',
      storage: FileAssetStorage.PUBLIC_IMAGES,
      createdAt: AT,
    });
  });

  it('lists only denied states, from their keys, and reads a marker back', async () => {
    objects.set(
      `test/asset-deny-ledger/${AT}_${ASSET_ID}_AVAILABLE.json`,
      Buffer.from('{}'),
    );

    await expect(ledger.listKeys()).resolves.toEqual([
      {
        key,
        createdAt: AT,
        id: ASSET_ID,
        kind: FileAssetState.REVOKED,
      },
    ]);
    await expect(ledger.read(key)).resolves.toEqual(
      expect.objectContaining({ assetId: ASSET_ID }),
    );
  });

  it('writes a marker again with when its object was deleted', async () => {
    const marker = await ledger.read(key);

    await ledger.write({ ...marker, purgedAt: '2026-10-01T00:00:00.000Z' });

    await expect(ledger.read(key)).resolves.toEqual({
      ...marker,
      purgedAt: '2026-10-01T00:00:00.000Z',
    });
  });
});
