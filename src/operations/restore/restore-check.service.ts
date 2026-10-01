import { setTimeout as wait } from 'node:timers/promises';

import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { SiteAdminActionKind } from 'src/audit/site-admin/site-admin-action.enum';
import { recordSiteAdminAction } from 'src/audit/site-admin/site-admin-action.utility';
import { AssetDenyReconciliationService } from 'src/file-assets/ledger/asset-deny-reconciliation.service';
import { HoldLedgerReconciliationService } from 'src/fleet/chat/holds/hold-ledger-reconciliation.service';
import { RosterErasureService } from 'src/fleet/erasure/roster-erasure.service';
import {
  LedgerReconciliation,
  LedgerTimings,
  noTimings,
} from 'src/shared/ledger/ledger.utility';
import { AccountClosureReconciliationService } from 'src/user/closure/account-closure-reconciliation.service';

/**
 * The PostgreSQL advisory lock the restore check holds while it runs, so two
 * instances starting together do not reconcile at once: the second waits,
 * then finds nothing left to do.
 */
export const RESTORE_CHECK_LOCK = 1_797_200_000;

/** How long the first retry waits, in milliseconds; each doubles it. */
export const RESTORE_CHECK_FIRST_RETRY_MS = 1_000;

/** The longest a retry waits, in milliseconds. */
export const RESTORE_CHECK_MAX_RETRY_MS = 60_000;

/** What the restore check came to, ledger by ledger. */
export interface RestoreCheckOutcome {
  readonly erasures: LedgerReconciliation;
  readonly holds: LedgerReconciliation;
  readonly assets: LedgerReconciliation;
  readonly closures: LedgerReconciliation;
  /** How long each part took, over every ledger. */
  readonly timings: LedgerTimings;
}

/**
 * The restore check (FC-042): at every boot, before the API serves anything,
 * the ledgers kept outside the database — roster erasures, moderation hold
 * events, asset denies and account closures, in the private quarantine
 * bucket — are compared
 * with the database. Whatever the database lacks, as after a restore from an
 * older backup, is brought back; whatever the ledgers lack gets a marker.
 *
 * Steve's decisions of 30 September 2026:
 *
 * - **Before anything serves.** `main.ts` runs it after `NestFactory.create`
 *   and before `app.init()`: no route, socket, scheduled job or queue worker
 *   starts until it has finished, and `/health/ready` cannot answer before
 *   then either.
 * - **Fail closed.** A bucket or database that cannot be reached is tried
 *   again, with capped exponential backoff, for as long as it takes; the
 *   API never starts without the ledgers read.
 * - **One at a time.** A PostgreSQL advisory lock keeps two instances from
 *   reconciling at once.
 * - **Logged.** Every check logs one summary line with its timings, and one
 *   that brought anything back writes a `LEDGERS_RECONCILED` entry to the
 *   site admin log, with no actor.
 */
@Injectable()
export class RestoreCheckService {
  private readonly _logger = new Logger(RestoreCheckService.name);

  /**
   * Creates an instance of RestoreCheckService.
   *
   * @param _dataSource - The database.
   * @param _erasures - Checks the erasure ledger.
   * @param _holds - Checks the hold ledger.
   * @param _assets - Checks the asset-deny ledger.
   * @param _closures - Checks the account-closure ledger.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _erasures: RosterErasureService,
    private readonly _holds: HoldLedgerReconciliationService,
    private readonly _assets: AssetDenyReconciliationService,
    private readonly _closures: AccountClosureReconciliationService,
  ) {}

  /**
   * Runs the check until it succeeds, waiting longer after each failure.
   *
   * @returns What it came to.
   */
  async run(): Promise<RestoreCheckOutcome> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.attempt();
      } catch (error: unknown) {
        const delay = Math.min(
          RESTORE_CHECK_FIRST_RETRY_MS * 2 ** (attempt - 1),
          RESTORE_CHECK_MAX_RETRY_MS,
        );

        this._logger.error(
          `[run] Restore check failed; the API waits for it - ` +
            `Attempt: ${attempt}, RetryInMs: ${delay}, ` +
            `Reason: ${error instanceof Error ? error.message : 'unknown'}`,
        );
        await this.pause(delay);
      }
    }
  }

  /**
   * Waits before trying again.
   *
   * @param ms - How long.
   */
  protected async pause(ms: number): Promise<void> {
    await wait(ms);
  }

  /**
   * Runs the check once, holding the advisory lock.
   *
   * @returns What it came to.
   */
  private async attempt(): Promise<RestoreCheckOutcome> {
    const runner = this._dataSource.createQueryRunner();

    try {
      await runner.connect();
      await runner.query('SELECT pg_advisory_lock($1::bigint)', [
        RESTORE_CHECK_LOCK,
      ]);

      try {
        return await this.reconcile();
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1::bigint)', [
          RESTORE_CHECK_LOCK,
        ]);
      }
    } finally {
      await runner.release();
    }
  }

  /**
   * Checks each ledger, logs the summary and, when anything came back, says
   * so in the site admin log.
   *
   * @returns What it came to.
   */
  private async reconcile(): Promise<RestoreCheckOutcome> {
    const erasures = await this._erasures.reconcileLedger();
    const holds = await this._holds.reconcile();
    const assets = await this._assets.reconcile();
    const closures = await this._closures.reconcile();
    const timings = noTimings();

    for (const ledger of [erasures, holds, assets, closures]) {
      for (const phase of Object.keys(timings) as Array<keyof LedgerTimings>) {
        timings[phase] += ledger.timings[phase];
      }
    }

    this._logger.log(
      `[reconcile] Restore check finished - ` +
        `Erasures: ${summaryOf(erasures)}, Holds: ${summaryOf(holds)}, ` +
        `Assets: ${summaryOf(assets)}, Closures: ${summaryOf(closures)}, ` +
        `ListMs: ${Math.round(timings.list)}, ` +
        `CompareMs: ${Math.round(timings.compare)}, ` +
        `ReplayMs: ${Math.round(timings.replay)}, ` +
        `BackfillMs: ${Math.round(timings.backfill)}`,
    );

    if (
      erasures.replayed + holds.replayed + assets.replayed + closures.replayed >
      0
    ) {
      await recordSiteAdminAction(this._dataSource.manager, {
        action: SiteAdminActionKind.LEDGERS_RECONCILED,
        actorUserId: null,
        reason: reasonOf(
          erasures.replayed,
          holds.replayed,
          assets.replayed,
          closures.replayed,
        ),
        detail: {
          erasures: countsOf(erasures),
          holds: countsOf(holds),
          assets: countsOf(assets),
          closures: countsOf(closures),
        },
      });
    }

    return { erasures, holds, assets, closures, timings };
  }
}

/**
 * One ledger's counts, for the summary line.
 *
 * @param ledger - What checking it came to.
 * @returns Markers, replayed and backfilled, as `m/r/b`.
 */
function summaryOf(ledger: LedgerReconciliation): string {
  return `${ledger.markers}/${ledger.replayed}/${ledger.backfilled}`;
}

/**
 * One ledger's counts, for the site admin log.
 *
 * @param ledger - What checking it came to.
 * @returns Every count, and no timing.
 */
function countsOf(ledger: LedgerReconciliation): Record<string, number> {
  return {
    markers: ledger.markers,
    replayed: ledger.replayed,
    backfilled: ledger.backfilled,
    ...ledger.detail,
  };
}

/**
 * What the site admin log says was brought back.
 *
 * @param erasures - Erasures made again.
 * @param holds - Hold events made again.
 * @param assets - Uploads denied again.
 * @param closures - Accounts closed again.
 * @returns The reason.
 */
export function reasonOf(
  erasures: number,
  holds: number,
  assets: number,
  closures: number,
): string {
  const parts = [
    [erasures, 'erasure', 'erasures'],
    [holds, 'hold event', 'hold events'],
    [assets, 'denied upload', 'denied uploads'],
    [closures, 'account closure', 'account closures'],
  ]
    .filter(([count]) => (count as number) > 0)
    .map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);
  const listed =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

  return `The restore check brought back ${listed}.`;
}
