import { ConfigService } from '@nestjs/config';

import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { QuarantineStorageService } from 'src/file-assets/services/quarantine-storage.service';

import {
  AccountClosureEvent,
  AccountClosureLedgerService,
} from './account-closure-ledger.service';

const USER_ID = '31000000-0000-4000-8000-0000000000c1';
const AT = '2026-09-30T12:00:00.000Z';

describe('AccountClosureLedgerService (FC-042)', () => {
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
  const ledger = new AccountClosureLedgerService(
    storage as unknown as QuarantineStorageService,
    { get: () => 'test' } as unknown as ConfigService,
  );
  const key = `test/account-closure-ledger/${AT}_${USER_ID}_CLOSED.json`;

  afterEach(() => {
    jest.useRealTimers();
  });

  it('records a closure with its ID and time alone, and says when', async () => {
    jest.useFakeTimers({ now: new Date(AT) });

    await expect(
      ledger.record(USER_ID, AccountClosureEvent.CLOSED),
    ).resolves.toEqual(new Date(AT));
    expect(storage.put).toHaveBeenCalledWith(key, expect.any(Buffer));
    expect(JSON.parse(String(objects.get(key)))).toEqual({
      userId: USER_ID,
      event: AccountClosureEvent.CLOSED,
      createdAt: AT,
    });
  });

  it('lists closures and reopenings from their keys, and nothing else', async () => {
    await ledger.write({
      userId: USER_ID,
      event: AccountClosureEvent.REOPENED,
      createdAt: '2026-09-30T13:00:00.000Z',
    });
    objects.set(
      `test/account-closure-ledger/${AT}_${USER_ID}_DISABLED.json`,
      Buffer.from('{}'),
    );

    expect((await ledger.listKeys()).map(each => each.kind)).toEqual([
      AccountClosureEvent.CLOSED,
      AccountClosureEvent.REOPENED,
    ]);
    expect(storage.read).not.toHaveBeenCalled();
  });
});
