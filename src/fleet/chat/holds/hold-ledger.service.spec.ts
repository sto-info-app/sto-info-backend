import { ConfigService } from '@nestjs/config';

import { describe, expect, it, jest } from '@jest/globals';

import { QuarantineStorageService } from 'src/file-assets/services/quarantine-storage.service';

import { HoldLedgerService, HoldMarker } from './hold-ledger.service';
import {
  ModerationHoldActionKind,
  ModerationHoldKind,
} from './moderation-hold.enums';

const ACTION_ID = '31000000-0000-4000-8000-000000000001';
const HOLD_ID = '31000000-0000-4000-8000-0000000000b1';

describe('HoldLedgerService (FC-042)', () => {
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
  const ledger = new HoldLedgerService(
    storage as unknown as QuarantineStorageService,
    { get: () => 'test' } as unknown as ConfigService,
  );
  const marker: HoldMarker = {
    actionId: ACTION_ID,
    holdId: HOLD_ID,
    kind: ModerationHoldActionKind.PLACED,
    holdKind: ModerationHoldKind.MEMBER_MESSAGES,
    chatReportId: null,
    subjectUserId: '31000000-0000-4000-8000-0000000000c1',
    ownerUserId: '31000000-0000-4000-8000-0000000000a1',
    reviewAt: '2027-03-29T12:00:00.000Z',
    createdAt: '2026-09-30T12:00:00.000Z',
  };
  const key = `test/hold-ledger/2026-09-30T12:00:00.000Z_${ACTION_ID}_PLACED.json`;

  it('writes one object per event, named by when, its ID and what, and reads it back', async () => {
    await ledger.write(marker);

    expect(storage.put).toHaveBeenCalledWith(key, expect.any(Buffer));
    await expect(ledger.listKeys()).resolves.toEqual([
      {
        key,
        createdAt: marker.createdAt,
        id: ACTION_ID,
        kind: ModerationHoldActionKind.PLACED,
      },
    ]);
    await expect(ledger.read(key)).resolves.toEqual(marker);
  });

  it('lists only the events it keeps', async () => {
    objects.set(
      `test/hold-ledger/2026-09-30T13:00:00.000Z_${ACTION_ID}_READ.json`,
      Buffer.from('{}'),
    );

    expect((await ledger.listKeys()).map(each => each.kind)).toEqual([
      ModerationHoldActionKind.PLACED,
    ]);
  });
});
