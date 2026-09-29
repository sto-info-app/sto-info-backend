import { ConfigService } from '@nestjs/config';

import { describe, expect, it, jest } from '@jest/globals';

import { QuarantineStorageService } from 'src/file-assets/services/quarantine-storage.service';

import { ErasureLedgerService, ErasureMarker } from './erasure-ledger.service';

describe('ErasureLedgerService (FC-038)', () => {
  const objects = new Map<string, Buffer>();
  const storage = {
    put: jest.fn(async (key: string, body: Buffer) => {
      objects.set(key, body);

      return { objectKey: key, objectVersion: null };
    }),
    listKeys: jest.fn(async (prefix: string) =>
      [...objects.keys()].filter(key => key.startsWith(prefix)).reverse(),
    ),
    read: jest.fn(async (key: string) => objects.get(key) as Buffer),
  };
  const ledger = new ErasureLedgerService(
    storage as unknown as QuarantineStorageService,
    { get: () => 'test' } as unknown as ConfigService,
  );

  /**
   * A marker.
   *
   * @param n - Its number.
   * @returns It.
   */
  const markerOf = (n: number): ErasureMarker => ({
    id: `erasure-${n}`,
    pairHash: String(n).repeat(64),
    pseudonym: `@erased-${n}`,
    createdAt: `2026-09-2${n}T12:00:00.000Z`,
  });

  it('writes one object per erasure, and reads them back oldest first', async () => {
    await ledger.write(markerOf(2));
    await ledger.write(markerOf(1));
    objects.set('prod/erasure-ledger/other.json', Buffer.from('{}'));

    expect(storage.put).toHaveBeenCalledWith(
      'test/erasure-ledger/2026-09-22T12:00:00.000Z_erasure-2.json',
      expect.any(Buffer),
    );
    await expect(ledger.list()).resolves.toEqual([markerOf(1), markerOf(2)]);
  });

  it('keeps no name, handle or reason', async () => {
    await ledger.write(markerOf(3));

    expect(
      Object.keys(JSON.parse(String(objects.values().next().value))),
    ).toEqual(['id', 'pairHash', 'pseudonym', 'createdAt']);
  });
});
