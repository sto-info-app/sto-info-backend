import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager, IsNull, Not } from 'typeorm';

import { CRON_TIMEZONE } from 'src/cron/constants/cron.constants';

import { FileAssetEntity } from '../entities/file-asset.entity';
import { AssetWithdrawalService } from './asset-withdrawal.service';

/** The most owed purges one run settles. */
export const OWED_PURGE_BATCH = 50;

/** The PostgreSQL advisory lock one run holds. */
export const OWED_PURGE_SWEEP_LOCK = 1_797_600_000;

/** What is outstanding, for the alert and for Scan Diagnostics. */
export interface OwedPurges {
  /** Withdrawn pictures whose public copy has not yet been deleted. */
  readonly owed: number;
  /** How many of those have been owed longer than the threshold asked. */
  readonly overdue: number;
  /** Whole hours the oldest has been owed, or null when none is. */
  readonly oldestHours: number | null;
}

/** What one run did. */
export interface OwedPurgeSweepReport {
  /** Purges now confirmed. */
  readonly purged: number;
  /** Purges Cloudflare still would not settle. */
  readonly failed: number;
}

/**
 * Counts the purges still owed, against the database's own clock.
 *
 * @param manager - The database.
 * @param overdueHours - How long one may be owed before it counts as
 *   overdue.
 * @returns What is outstanding.
 */
export async function readOwedPurges(
  manager: EntityManager,
  overdueHours: number,
): Promise<OwedPurges> {
  // One row whatever the table holds: an aggregate with no GROUP BY. With
  // nothing owed, min() is null and so is the age built on it.
  return (await manager
    .createQueryBuilder(FileAssetEntity, 'asset')
    .select('COUNT(*)::int', 'owed')
    .addSelect(
      `COUNT(*) FILTER (WHERE asset."purgeRequiredAt" < now() - make_interval(hours => :overdueHours))::int`,
      'overdue',
    )
    .addSelect(
      `floor(extract(epoch FROM now() - min(asset."purgeRequiredAt")) / 3600)::int`,
      'oldestHours',
    )
    .where('asset."purgeRequiredAt" IS NOT NULL')
    .andWhere('asset."purgedAt" IS NULL')
    .setParameters({ overdueHours })
    .getRawOne()) as OwedPurges;
}

/**
 * Settles the purges withdrawals left owed (FC-043).
 *
 * Withdrawing a published picture revokes its row first and deletes it from
 * Cloudflare second (ADR-0016); a delete that fails leaves the purge owed,
 * and until now nothing ever tried again, so a withdrawn picture could stay
 * reachable at its old address for good. Every hour this asks Cloudflare
 * again for each, oldest first, {@link OWED_PURGE_BATCH} at a time, and an
 * object Cloudflare no longer has counts as gone.
 *
 * What it cannot settle stays owed and is tried again next hour; once one
 * has been owed for a day the operations alerts tell every site admin
 * (`PURGE_OWED`), and Scan Diagnostics shows how many and how old.
 *
 * Runs do not overlap: in this process by a flag, and across instances by a
 * PostgreSQL advisory lock, as the other operations sweeps do.
 */
@Injectable()
export class OwedPurgeSweepService {
  private readonly _logger = new Logger(OwedPurgeSweepService.name);

  /** Whether a run is going in this process. */
  private _running = false;

  /**
   * Creates an instance of OwedPurgeSweepService.
   *
   * @param _dataSource - The database, for the registry and the lock.
   * @param _withdrawal - Deletes the object and confirms the purge.
   */
  constructor(
    @InjectDataSource() private readonly _dataSource: DataSource,
    private readonly _withdrawal: AssetWithdrawalService,
  ) {}

  /**
   * Settles what it can. Every hour.
   *
   * Errors are caught, because an unhandled rejection inside a scheduled
   * job takes the process down; the next run tries again.
   *
   * @returns What it did, or null when the run was skipped or failed.
   */
  @Cron(CronExpression.EVERY_HOUR, { timeZone: CRON_TIMEZONE })
  async tick(): Promise<OwedPurgeSweepReport | null> {
    if (this._running) {
      this._logger.warn('[tick] Previous run still going; skipped');

      return null;
    }

    this._running = true;

    try {
      return await this.runLocked();
    } catch (error) {
      this._logger.error(
        `[tick] Owed purge run failed - Error: ` +
          (error instanceof Error ? error.name : typeof error),
      );

      return null;
    } finally {
      this._running = false;
    }
  }

  /**
   * Runs while holding the advisory lock, if no other instance holds it.
   *
   * @returns What it did, or null when another instance is running.
   */
  private async runLocked(): Promise<OwedPurgeSweepReport | null> {
    const runner = this._dataSource.createQueryRunner();

    try {
      await runner.connect();

      const [{ locked }] = (await runner.query(
        'SELECT pg_try_advisory_lock($1::bigint) AS "locked"',
        [OWED_PURGE_SWEEP_LOCK],
      )) as Array<{ locked: boolean }>;

      if (!locked) {
        return null;
      }

      try {
        return await this.sweep();
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1::bigint)', [
          OWED_PURGE_SWEEP_LOCK,
        ]);
      }
    } finally {
      await runner.release();
    }
  }

  /**
   * Asks Cloudflare again about the oldest owed purges.
   *
   * @returns What it did.
   */
  async sweep(): Promise<OwedPurgeSweepReport> {
    const owed = await this._dataSource.manager.find(FileAssetEntity, {
      where: { purgeRequiredAt: Not(IsNull()), purgedAt: IsNull() },
      order: { purgeRequiredAt: 'ASC', id: 'ASC' },
      take: OWED_PURGE_BATCH,
    });
    let purged = 0;

    for (const asset of owed) {
      if (await this._withdrawal.settleOwedPurge(asset)) {
        purged += 1;
      }
    }

    const report = { purged, failed: owed.length - purged };

    if (owed.length > 0) {
      this._logger.log(
        `[sweep] Owed purges retried - Purged: ${report.purged}, Failed: ${report.failed}`,
      );
    }

    return report;
  }
}
