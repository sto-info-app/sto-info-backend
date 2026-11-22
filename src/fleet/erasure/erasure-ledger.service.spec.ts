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
    id: `31000000-0000-4000-8000-00000000000${n}`,
    pairHash: String(n).repeat(64),
    pseudonym: `@erased-${n}`,
    createdAt: `2026-09-2${n}T12:00:00.000Z`,
  });

  it('writes one object per erasure, and lists them oldest first from their keys alone', async () => {
    await ledger.write(markerOf(2));
    await ledger.write(markerOf(1));
    objects.set('prod/erasure-ledger/other.json', Buffer.from('{}'));
    storage.read.mockClear();

    expect(storage.put).toHaveBeenCalledWith(
      `test/erasure-ledger/2026-09-22T12:00:00.000Z_${markerOf(2).id}.json`,
      expect.any(Buffer),
    );
    await expect(ledger.listKeys()).resolves.toEqual(
      [markerOf(1), markerOf(2)].map(marker => ({
        key: `test/erasure-ledger/${marker.createdAt}_${marker.id}.json`,
        createdAt: marker.createdAt,
        id: marker.id,
        kind: null,
      })),
    );
    // FC-042: the boot check compares keys; it reads no body to do so.
    expect(storage.read).not.toHaveBeenCalled();
  });

  it('reads one marker back, keeping no name, handle or reason', async () => {
    await ledger.write(markerOf(3));

    const [key] = (await ledger.listKeys()).filter(
      each => each.id === markerOf(3).id,
    );

    await expect(ledger.read(key.key)).resolves.toEqual(markerOf(3));
    expect(Object.keys(JSON.parse(String(objects.get(key.key))))).toEqual([
      'id',
      'pairHash',
      'pseudonym',
      'createdAt',
    ]);
  });
});
