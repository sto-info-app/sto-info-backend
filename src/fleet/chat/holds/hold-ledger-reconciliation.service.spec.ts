import { Logger } from '@nestjs/common';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { QueryFailedError } from 'typeorm';

import { LEDGER_CHUNK_SIZE, LedgerKey } from 'src/shared/ledger/ledger.utility';
import { UserEntity } from 'src/user/entities/user.entity';

import { InMemoryManager, Row } from '../../../../test/in-memory-manager';
import { ChatMessageReportEntity } from '../entities/chat-message-report.entity';
import {
  HOLD_REPLAYED_REASON,
  HoldLedgerReconciliationService,
} from './hold-ledger-reconciliation.service';
import { HoldLedgerService, HoldMarker } from './hold-ledger.service';
import { ModerationHoldActionEntity } from './moderation-hold-action.entity';
import { ModerationHoldEntity } from './moderation-hold.entity';
import {
  ModerationHoldActionKind,
  ModerationHoldKind,
} from './moderation-hold.enums';

const ADMIN_ID = '31000000-0000-4000-8000-0000000000a1';
const MEMBER_ID = '31000000-0000-4000-8000-0000000000c1';
const REPORT_ID = '31000000-0000-4000-8000-0000000000e1';
const HOLD_ID = '31000000-0000-4000-8000-0000000000b1';
const REVIEW_AT = '2027-03-29T12:00:00.000Z';

/**
 * An action ID that sorts by its number.
 *
 * @param n - The number.
 * @returns The ID.
 */
const actionId = (n: number): string =>
  `31000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('HoldLedgerReconciliationService (FC-042)', () => {
  let db: InMemoryManager;
  let markers: HoldMarker[];
  let ledger: {
    listKeys: jest.Mock<() => Promise<LedgerKey[]>>;
    read: jest.Mock<(key: string) => Promise<HoldMarker>>;
    write: jest.Mock<(marker: HoldMarker) => Promise<void>>;
  };
  let service: HoldLedgerReconciliationService;

  /**
   * The key a marker is listed under.
   *
   * @param marker - The marker.
   * @returns Its key.
   */
  const keyOf = (marker: HoldMarker): LedgerKey => ({
    key: `test/hold-ledger/${marker.createdAt}_${marker.actionId}_${marker.kind}.json`,
    createdAt: marker.createdAt,
    id: marker.actionId,
    kind: marker.kind,
  });

  /**
   * An event, as the ledger keeps it.
   *
   * @param n - Its number, which orders it.
   * @param kind - What.
   * @param overrides - What differs.
   * @returns It.
   */
  const event = (
    n: number,
    kind: ModerationHoldActionKind,
    overrides: Partial<HoldMarker> = {},
  ): HoldMarker => ({
    actionId: actionId(n),
    holdId: HOLD_ID,
    kind,
    holdKind: ModerationHoldKind.MEMBER_MESSAGES,
    chatReportId: null,
    subjectUserId: MEMBER_ID,
    ownerUserId: ADMIN_ID,
    reviewAt: REVIEW_AT,
    createdAt: `2026-09-${String(10 + n).padStart(2, '0')}T12:00:00.000Z`,
    ...overrides,
  });

  /**
   * A hold, as the database has it.
   *
   * @param overrides - What differs.
   * @returns It.
   */
  const hold = (overrides: Row = {}): Row => ({
    id: HOLD_ID,
    kind: ModerationHoldKind.MEMBER_MESSAGES,
    chatReportId: null,
    subjectUserId: MEMBER_ID,
    reason: 'Harassment case',
    ownerUserId: ADMIN_ID,
    reviewAt: new Date('2027-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    releasedAt: null,
    releasedByUserId: null,
    releaseReason: null,
    ...overrides,
  });

  beforeEach(() => {
    db = new InMemoryManager().seed(UserEntity, [
      { id: ADMIN_ID },
      { id: MEMBER_ID },
    ]);
    markers = [];
    ledger = {
      listKeys: jest.fn(async () => markers.map(keyOf)),
      read: jest.fn(
        async (key: string) =>
          markers.find(marker => keyOf(marker).key === key) as HoldMarker,
      ),
      write: jest.fn(async () => undefined),
    };
    service = new HoldLedgerReconciliationService(
      db.asDataSource(),
      ledger as unknown as HoldLedgerService,
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const actions = (): Row[] => db.rows<Row>(ModerationHoldActionEntity);

  describe('bringing back what the database lacks', () => {
    it('places, extends and releases a hold again, oldest first, under the events’ own IDs, with no actor', async () => {
      markers = [
        event(1, ModerationHoldActionKind.PLACED),
        event(2, ModerationHoldActionKind.EXTENDED, {
          reviewAt: '2027-04-01T12:00:00.000Z',
        }),
        event(3, ModerationHoldActionKind.RELEASED, {
          reviewAt: '2027-04-01T12:00:00.000Z',
        }),
      ];

      const outcome = await service.reconcile();

      expect(outcome).toEqual({
        markers: 3,
        replayed: 3,
        backfilled: 0,
        detail: {
          replayed: 3,
          alreadyHeld: 0,
          nothingToHold: 0,
          notInForce: 0,
        },
        timings: {
          list: expect.any(Number),
          compare: expect.any(Number),
          replay: expect.any(Number),
          backfill: expect.any(Number),
        },
      });
      expect(db.rows(ModerationHoldEntity)).toEqual([
        expect.objectContaining({
          id: HOLD_ID,
          kind: ModerationHoldKind.MEMBER_MESSAGES,
          subjectUserId: MEMBER_ID,
          ownerUserId: ADMIN_ID,
          reason: HOLD_REPLAYED_REASON,
          reviewAt: new Date('2027-04-01T12:00:00.000Z'),
          createdAt: new Date('2026-09-11T12:00:00.000Z'),
          releasedAt: new Date('2026-09-13T12:00:00.000Z'),
          releasedByUserId: null,
          releaseReason: HOLD_REPLAYED_REASON,
        }),
      ]);
      expect(actions()).toEqual([
        expect.objectContaining({
          id: actionId(1),
          action: ModerationHoldActionKind.PLACED,
          actorUserId: null,
          reason: HOLD_REPLAYED_REASON,
          detail: { reviewAt: REVIEW_AT, automatic: true, replayed: true },
          createdAt: new Date('2026-09-11T12:00:00.000Z'),
        }),
        expect.objectContaining({
          id: actionId(2),
          action: ModerationHoldActionKind.EXTENDED,
          detail: {
            from: REVIEW_AT,
            to: '2027-04-01T12:00:00.000Z',
            automatic: true,
            replayed: true,
          },
        }),
        expect.objectContaining({
          id: actionId(3),
          action: ModerationHoldActionKind.RELEASED,
          detail: { automatic: true, replayed: true },
        }),
      ]);
      expect(ledger.write).not.toHaveBeenCalled();
    });

    it('holds a report’s evidence again, with no owner once theirs has gone', async () => {
      db.seed(ChatMessageReportEntity, [{ id: REPORT_ID }]);
      markers = [
        event(1, ModerationHoldActionKind.PLACED, {
          holdKind: ModerationHoldKind.CHAT_REPORT,
          chatReportId: REPORT_ID,
          subjectUserId: null,
          ownerUserId: '31000000-0000-4000-8000-0000000000a9',
        }),
      ];

      await expect(service.reconcile()).resolves.toMatchObject({
        replayed: 1,
      });
      expect(db.rows(ModerationHoldEntity)).toEqual([
        expect.objectContaining({
          chatReportId: REPORT_ID,
          subjectUserId: null,
          ownerUserId: null,
        }),
      ]);
    });

    it('reads only what the database lacks', async () => {
      db.seed(ModerationHoldEntity, [hold()]);
      db.seed(ModerationHoldActionEntity, [
        {
          id: actionId(1),
          holdId: HOLD_ID,
          action: ModerationHoldActionKind.PLACED,
          detail: { reviewAt: REVIEW_AT },
          createdAt: new Date('2026-09-11T12:00:00.000Z'),
        },
      ]);
      markers = [
        event(1, ModerationHoldActionKind.PLACED),
        event(2, ModerationHoldActionKind.RELEASED),
      ];

      await expect(service.reconcile()).resolves.toMatchObject({
        markers: 2,
        replayed: 1,
      });
      expect(ledger.read.mock.calls.map(([key]) => key)).toEqual([
        keyOf(markers[1]).key,
      ]);
    });

    it.each([
      ['a member whose account has gone', { subjectUserId: 'gone' }],
      ['a member never named', { subjectUserId: null }],
      [
        'a report since purged',
        {
          holdKind: ModerationHoldKind.CHAT_REPORT,
          chatReportId: REPORT_ID,
          subjectUserId: null,
        },
      ],
    ])('counts nothing left to hold for %s', async (_what, overrides) => {
      markers = [event(1, ModerationHoldActionKind.PLACED, overrides)];

      await expect(service.reconcile()).resolves.toMatchObject({
        replayed: 0,
        detail: { nothingToHold: 1 },
      });
      expect(db.rows(ModerationHoldEntity)).toEqual([]);
    });

    it('counts a hold the database still has, or one already in force on the same thing, as held', async () => {
      db.seed(ModerationHoldEntity, [hold()]);
      markers = [event(1, ModerationHoldActionKind.PLACED)];

      await expect(service.reconcile()).resolves.toMatchObject({
        detail: { alreadyHeld: 1 },
      });

      db.rows(ModerationHoldEntity).length = 0;
      db.insert = jest.fn(() =>
        Promise.reject(
          Object.assign(
            new QueryFailedError('INSERT', [], new Error('duplicate')),
            { driverError: { code: '23505' } },
          ),
        ),
      ) as never;

      await expect(service.reconcile()).resolves.toMatchObject({
        detail: { alreadyHeld: 1 },
      });
    });

    it('passes any other failure on, for the check to try again', async () => {
      markers = [event(1, ModerationHoldActionKind.PLACED)];
      db.insert = jest.fn(() =>
        Promise.reject(new QueryFailedError('INSERT', [], new Error('down'))),
      ) as never;

      await expect(service.reconcile()).rejects.toThrow(QueryFailedError);
    });

    it.each([
      ModerationHoldActionKind.EXTENDED,
      ModerationHoldActionKind.RELEASED,
    ])('leaves a hold no longer in force when it was %s', async kind => {
      db.seed(ModerationHoldEntity, [
        hold({
          releasedAt: new Date(),
          releaseReason: 'Case closed',
        }),
      ]);
      markers = [event(1, kind)];

      await expect(service.reconcile()).resolves.toMatchObject({
        replayed: 0,
        detail: { notInForce: 1 },
      });
      expect(actions()).toEqual([]);
    });
  });

  describe('completing the ledger', () => {
    it('writes a marker for every placing, extension and release it lacks, and for no reading', async () => {
      db.seed(ModerationHoldEntity, [hold()]);
      db.seed(ModerationHoldActionEntity, [
        {
          id: actionId(1),
          holdId: HOLD_ID,
          action: ModerationHoldActionKind.PLACED,
          detail: { reviewAt: REVIEW_AT },
          createdAt: new Date('2026-09-11T12:00:00.000Z'),
        },
        {
          id: actionId(2),
          holdId: HOLD_ID,
          action: ModerationHoldActionKind.EXTENDED,
          detail: { from: REVIEW_AT, to: '2027-04-01T12:00:00.000Z' },
          createdAt: new Date('2026-09-12T12:00:00.000Z'),
        },
        {
          id: actionId(3),
          holdId: HOLD_ID,
          action: ModerationHoldActionKind.READ,
          detail: { messages: 3 },
          createdAt: new Date('2026-09-13T12:00:00.000Z'),
        },
        {
          id: actionId(4),
          holdId: HOLD_ID,
          action: ModerationHoldActionKind.RELEASED,
          detail: null,
          createdAt: new Date('2026-09-14T12:00:00.000Z'),
        },
      ]);

      await expect(service.reconcile()).resolves.toMatchObject({
        markers: 0,
        replayed: 0,
        backfilled: 3,
      });
      expect(
        ledger.write.mock.calls
          .map(([marker]) => marker)
          .sort((a, b) => a.actionId.localeCompare(b.actionId)),
      ).toEqual([
        event(1, ModerationHoldActionKind.PLACED),
        event(2, ModerationHoldActionKind.EXTENDED, {
          reviewAt: '2027-04-01T12:00:00.000Z',
        }),
        event(4, ModerationHoldActionKind.RELEASED, {
          reviewAt: '2027-01-01T00:00:00.000Z',
        }),
      ]);
    });

    it('reads the log a chunk at a time', async () => {
      db.seed(ModerationHoldEntity, [hold()]);
      db.seed(
        ModerationHoldActionEntity,
        Array.from({ length: LEDGER_CHUNK_SIZE + 1 }, (_, n) => ({
          id: actionId(n + 1),
          holdId: HOLD_ID,
          action: ModerationHoldActionKind.EXTENDED,
          detail: { to: REVIEW_AT },
          createdAt: new Date('2026-09-11T12:00:00.000Z'),
        })),
      );

      await expect(service.reconcile()).resolves.toMatchObject({
        backfilled: LEDGER_CHUNK_SIZE + 1,
      });
    });

    it('does nothing when both agree', async () => {
      await expect(service.reconcile()).resolves.toMatchObject({
        markers: 0,
        replayed: 0,
        backfilled: 0,
      });
      expect(ledger.read).not.toHaveBeenCalled();
    });
  });
});
