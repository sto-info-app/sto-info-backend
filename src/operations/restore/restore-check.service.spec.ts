import { Logger } from '@nestjs/common';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { DataSource, EntityManager } from 'typeorm';

import { SiteAdminActionEntity } from 'src/audit/site-admin/site-admin-action.entity';
import { SiteAdminActionKind } from 'src/audit/site-admin/site-admin-action.enum';
import { AssetDenyReconciliationService } from 'src/file-assets/ledger/asset-deny-reconciliation.service';
import { HoldLedgerReconciliationService } from 'src/fleet/chat/holds/hold-ledger-reconciliation.service';
import { RosterErasureService } from 'src/fleet/erasure/roster-erasure.service';
import {
  FleetRetentionScheduler,
  RetentionCatchUp,
} from 'src/fleet/retention/fleet-retention.scheduler';
import { LedgerReconciliation } from 'src/shared/ledger/ledger.utility';
import { AccountClosureReconciliationService } from 'src/user/closure/account-closure-reconciliation.service';

import {
  reasonOf,
  RESTORE_CHECK_FIRST_RETRY_MS,
  RESTORE_CHECK_LOCK,
  RESTORE_CHECK_MAX_RETRY_MS,
  RestoreCheckService,
} from './restore-check.service';

/**
 * What checking one ledger came to.
 *
 * @param replayed - How many records came back.
 * @param extra - What else differs.
 * @returns It.
 */
const checked = (
  replayed = 0,
  extra: Partial<LedgerReconciliation> = {},
): LedgerReconciliation => ({
  markers: 4,
  replayed,
  backfilled: 1,
  detail: {},
  timings: { list: 1, compare: 2, replay: 3, backfill: 4 },
  ...extra,
});

/** The restore check, with its waits recorded instead of waited. */
class Recorded extends RestoreCheckService {
  readonly waits: number[] = [];

  /**
   * Records a wait.
   *
   * @param ms - How long.
   */
  protected override async pause(ms: number): Promise<void> {
    this.waits.push(ms);
  }
}

describe('RestoreCheckService (FC-042, FC-043)', () => {
  let runner: {
    connect: jest.Mock<() => Promise<void>>;
    query: jest.Mock<(sql: string, parameters: unknown[]) => Promise<unknown>>;
    release: jest.Mock<() => Promise<void>>;
  };
  let insert: jest.Mock<(...args: unknown[]) => Promise<void>>;
  let erasures: {
    reconcileLedger: jest.Mock<() => Promise<LedgerReconciliation>>;
  };
  let holds: { reconcile: jest.Mock<() => Promise<LedgerReconciliation>> };
  let assets: { reconcile: jest.Mock<() => Promise<LedgerReconciliation>> };
  let closures: { reconcile: jest.Mock<() => Promise<LedgerReconciliation>> };
  let retention: { catchUp: jest.Mock<() => Promise<RetentionCatchUp>> };
  let service: Recorded;
  let log: jest.SpiedFunction<Logger['log']>;
  let error: jest.SpiedFunction<Logger['error']>;

  beforeEach(() => {
    runner = {
      connect: jest.fn(async () => undefined),
      query: jest.fn(async () => [{}]),
      release: jest.fn(async () => undefined),
    };
    insert = jest.fn(async () => undefined);
    erasures = { reconcileLedger: jest.fn(async () => checked()) };
    holds = { reconcile: jest.fn(async () => checked()) };
    assets = { reconcile: jest.fn(async () => checked()) };
    closures = { reconcile: jest.fn(async () => checked()) };
    retention = {
      catchUp: jest.fn(async () => ({
        CHAT_MESSAGES: { messages: 0 },
        ROSTER_SOURCES: { sources: 0, assets: 0 },
      })),
    };
    jest
      .spyOn(performance, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(130);
    service = new Recorded(
      {
        createQueryRunner: () => runner,
        manager: { insert } as unknown as EntityManager,
      } as unknown as DataSource,
      erasures as unknown as RosterErasureService,
      holds as unknown as HoldLedgerReconciliationService,
      assets as unknown as AssetDenyReconciliationService,
      closures as unknown as AccountClosureReconciliationService,
      retention as unknown as FleetRetentionScheduler,
    );
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('checks every ledger under the advisory lock, and logs one summary line with the timings', async () => {
    const outcome = await service.run();

    expect(runner.query.mock.calls).toEqual([
      ['SELECT pg_advisory_lock($1::bigint)', [RESTORE_CHECK_LOCK]],
      ['SELECT pg_advisory_unlock($1::bigint)', [RESTORE_CHECK_LOCK]],
    ]);
    expect(runner.query.mock.invocationCallOrder[0]).toBeLessThan(
      erasures.reconcileLedger.mock.invocationCallOrder[0],
    );
    expect(closures.reconcile.mock.invocationCallOrder[0]).toBeLessThan(
      runner.query.mock.invocationCallOrder[1],
    );
    expect(runner.release).toHaveBeenCalled();
    expect(outcome.timings).toEqual({
      list: 4,
      compare: 8,
      replay: 12,
      backfill: 16,
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      '[reconcile] Restore check finished - Erasures: 4/0/1, Holds: 4/0/1, ' +
        'Assets: 4/0/1, Closures: 4/0/1, ListMs: 4, CompareMs: 8, ' +
        'ReplayMs: 12, BackfillMs: 16, RetentionMs: 30, Forgotten: nothing',
    );
    // Nothing came back, so the site admin log is left alone.
    expect(insert).not.toHaveBeenCalled();
  });

  it('says in the site admin log, with no actor, what it brought back', async () => {
    erasures.reconcileLedger.mockResolvedValue(
      checked(2, { detail: { alreadyErased: 0 } }),
    );
    holds.reconcile.mockResolvedValue(checked(1));
    assets.reconcile.mockResolvedValue(checked(3, { detail: { purged: 1 } }));
    closures.reconcile.mockResolvedValue(checked(1, { detail: { gone: 0 } }));

    await service.run();

    expect(insert).toHaveBeenCalledWith(
      SiteAdminActionEntity,
      expect.objectContaining({
        action: SiteAdminActionKind.LEDGERS_RECONCILED,
        actorUserId: null,
        targetUserId: null,
        reason:
          'The restore check brought back 2 erasures, 1 hold event, 3 ' +
          'denied uploads and 1 account closure.',
        detail: {
          erasures: {
            markers: 4,
            replayed: 2,
            backfilled: 1,
            alreadyErased: 0,
          },
          holds: { markers: 4, replayed: 1, backfilled: 1 },
          assets: { markers: 4, replayed: 3, backfilled: 1, purged: 1 },
          closures: { markers: 4, replayed: 1, backfilled: 1, gone: 0 },
        },
      }),
    );
  });

  it('waits and tries again, longer each time up to a limit, and never goes on without the ledgers', async () => {
    const failures = 9;

    for (let n = 0; n < failures; n++) {
      holds.reconcile.mockRejectedValueOnce(new Error('Bucket unreachable'));
    }

    await service.run();

    expect(service.waits).toEqual([
      RESTORE_CHECK_FIRST_RETRY_MS,
      2_000,
      4_000,
      8_000,
      16_000,
      32_000,
      RESTORE_CHECK_MAX_RETRY_MS,
      RESTORE_CHECK_MAX_RETRY_MS,
      RESTORE_CHECK_MAX_RETRY_MS,
    ]);
    expect(error).toHaveBeenCalledTimes(failures);
    expect(error).toHaveBeenCalledWith(
      '[run] Restore check failed; the API waits for it - Attempt: 1, ' +
        'RetryInMs: 1000, Reason: Bucket unreachable',
    );
    // The lock is let go of after every failure, and the connection too.
    expect(runner.release).toHaveBeenCalledTimes(failures + 1);
    expect(
      runner.query.mock.calls.filter(([sql]) => sql.includes('unlock')),
    ).toHaveLength(failures + 1);
  });

  it('tries again when the database cannot be reached at all', async () => {
    runner.connect
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockRejectedValueOnce('odd');

    await service.run();

    expect(service.waits).toEqual([1_000, 2_000]);
    expect(error).toHaveBeenLastCalledWith(
      expect.stringContaining('Reason: unknown'),
    );
    expect(erasures.reconcileLedger).toHaveBeenCalledTimes(1);
  });

  it('really waits between attempts', async () => {
    const real = new RestoreCheckService(
      {} as DataSource,
      erasures as unknown as RosterErasureService,
      holds as unknown as HoldLedgerReconciliationService,
      assets as unknown as AssetDenyReconciliationService,
      closures as unknown as AccountClosureReconciliationService,
      retention as unknown as FleetRetentionScheduler,
    );
    const started = Date.now();

    await (real as unknown as { pause(ms: number): Promise<void> }).pause(20);

    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });

  // FC-043: what a restore brought back that retention had already
  // forgotten is forgotten again before anything serves.
  describe('retention', () => {
    it('is caught up after every ledger, holds included, and inside the lock', async () => {
      const outcome = await service.run();

      expect(retention.catchUp).toHaveBeenCalledTimes(1);
      expect(holds.reconcile.mock.invocationCallOrder[0]).toBeLessThan(
        retention.catchUp.mock.invocationCallOrder[0],
      );
      expect(closures.reconcile.mock.invocationCallOrder[0]).toBeLessThan(
        retention.catchUp.mock.invocationCallOrder[0],
      );
      expect(retention.catchUp.mock.invocationCallOrder[0]).toBeLessThan(
        runner.query.mock.invocationCallOrder[1],
      );
      expect(outcome.retention).toEqual({
        CHAT_MESSAGES: { messages: 0 },
        ROSTER_SOURCES: { sources: 0, assets: 0 },
      });
    });

    it('says what it forgot again, job by job', async () => {
      retention.catchUp.mockResolvedValue({
        CHAT_MESSAGES: { messages: 120 },
        ROSTER_SOURCES: { sources: 2, assets: 0 },
        ACTIVITY: { activity: 0 },
      });

      await service.run();

      expect(log).toHaveBeenCalledWith(
        expect.stringContaining(
          'Forgotten: CHAT_MESSAGES messages=120; ROSTER_SOURCES sources=2',
        ),
      );
      // Forgetting again is routine; only what came back is logged there.
      expect(insert).not.toHaveBeenCalled();
    });

    it('fails the check, which waits and tries again, when a job fails', async () => {
      retention.catchUp
        .mockRejectedValueOnce(new Error('Retention job CHAT_MESSAGES failed'))
        .mockResolvedValueOnce({});

      await service.run();

      expect(service.waits).toEqual([RESTORE_CHECK_FIRST_RETRY_MS]);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('Reason: Retention job CHAT_MESSAGES failed'),
      );
      expect(runner.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_unlock($1::bigint)',
        [RESTORE_CHECK_LOCK],
      );
    });
  });

  describe('reasonOf', () => {
    it.each([
      [1, 0, 0, 0, 'The restore check brought back 1 erasure.'],
      [0, 2, 0, 0, 'The restore check brought back 2 hold events.'],
      [0, 0, 1, 0, 'The restore check brought back 1 denied upload.'],
      [0, 0, 0, 2, 'The restore check brought back 2 account closures.'],
      [
        0,
        1,
        4,
        0,
        'The restore check brought back 1 hold event and 4 denied uploads.',
      ],
    ])(
      'says %i, %i, %i and %i as %s',
      (erased, held, denied, closed, expected) => {
        expect(reasonOf(erased, held, denied, closed)).toBe(expected);
      },
    );
  });
});
