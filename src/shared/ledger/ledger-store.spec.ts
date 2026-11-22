import { Logger } from '@nestjs/common';

import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { LedgerStorage, LedgerStore } from './ledger-store';

const ID = '31000000-0000-4000-8000-000000000001';
const OTHER = '31000000-0000-4000-8000-000000000002';

describe('LedgerStore (FC-042)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * A bucket that keeps what it is given, and lists it in its own order.
   *
   * @returns It, and what it holds.
   */
  const bucket = () => {
    const objects = new Map<string, Buffer>();
    const storage: LedgerStorage = {
      put: jest.fn(async (key: string, body: Buffer) => {
        objects.set(key, body);
      }),
      listKeys: jest.fn(async (prefix: string) =>
        [...objects.keys()].filter(key => key.startsWith(prefix)).reverse(),
      ),
      read: jest.fn(async (key: string) => objects.get(key) as Buffer),
    };

    return { storage, objects };
  };

  it('writes each marker under the environment and the ledger, and reads it back', async () => {
    const { storage, objects } = bucket();
    const store = new LedgerStore<{ n: number }>(storage, 'test', 'things', [
      'MADE',
    ]);

    await store.write('2026-09-30T12:00:00.000Z', ID, 'MADE', { n: 1 });

    const key = `test/things/2026-09-30T12:00:00.000Z_${ID}_MADE.json`;

    expect([...objects.keys()]).toEqual([key]);
    await expect(store.read(key)).resolves.toEqual({ n: 1 });
  });

  it('lists oldest first, leaving out, with a warning, what it did not write', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { storage, objects } = bucket();
    const store = new LedgerStore(storage, 'test', 'things', ['MADE']);

    await store.write('2026-09-30T12:00:00.000Z', ID, 'MADE', {});
    await store.write('2026-09-29T12:00:00.000Z', OTHER, 'MADE', {});
    objects.set(
      `test/things/2026-09-28T12:00:00.000Z_${ID}_LOST.json`,
      Buffer.from('{}'),
    );
    objects.set('test/things/notes.txt', Buffer.from(''));

    expect((await store.listKeys()).map(key => key.id)).toEqual([OTHER, ID]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('keeps a ledger of one thing to keys that record nothing', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { storage } = bucket();
    const store = new LedgerStore(storage, 'test', 'things', null);

    await store.write('2026-09-30T12:00:00.000Z', ID, undefined, {});
    await store.write('2026-09-29T12:00:00.000Z', OTHER, 'MADE', {});

    expect((await store.listKeys()).map(key => key.id)).toEqual([ID]);
  });
});
