import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, LessThan } from 'typeorm';

import { RETENTION_RUN_KEEP_MONTHS } from '../constants/fleet-policy.constants';
import { purgeInBatches } from './purge-in-batches.utility';
import { RetentionJob } from './retention-job.enum';
import { RetentionRunEntity } from './retention-run.entity';

/** What one run of a retention job did. */
export interface RetentionOutcome {
  /** What it did, by kind. */
  readonly counts: Readonly<Record<string, number>>;
  /** False when it stopped at its limit, and the next run carries on. */
  readonly complete: boolean;
}

/** How much of a failure's message a run keeps. */
const ERROR_LENGTH = 500;

/**
 * Records each run of each Fleet retention job (FC-037).
 *
 * Steve's decision of 29 September 2026: a row per run, with what it did,
 * whether it got through everything due, and why it stopped when it failed.
 * No page shows them yet; FC-039's diagnostics may.
 *
 * Every job runs through {@link record}, which catches a failure — an
 * unhandled rejection inside a scheduled job takes the process down — and
 * records it, so the next run simply tries again.
 */
@Injectable()
export class RetentionRunService {
  private readonly _logger = new Logger(RetentionRunService.name);

  /**
   * Creates an instance of RetentionRunService.
   *
   * @param _dataSource - The database.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
  ) {}

  /**
   * Runs a job and records the run.
   *
   * @param job - Which job.
   * @param work - The job itself.
   * @returns What it did, or null when it failed.
   */
  async record(
    job: RetentionJob,
    work: () => Promise<RetentionOutcome>,
  ): Promise<RetentionOutcome | null> {
    const manager = this._dataSource.manager;
    let runId: string | null = null;

    try {
      runId = (
        await manager.save(RetentionRunEntity, { job, startedAt: new Date() })
      ).id;

      const outcome = await work();

      await manager.update(
        RetentionRunEntity,
        { id: runId },
        {
          finishedAt: new Date(),
          complete: outcome.complete,
          counts: { ...outcome.counts },
        },
      );
      this._logger.log(
        `[record] Retention run finished - Job: ${job}, ` +
          `Complete: ${outcome.complete}, Counts: ${JSON.stringify(outcome.counts)}`,
      );

      return outcome;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this._logger.error(
        `[record] Retention run failed - Job: ${job}`,
        error instanceof Error ? error.stack : message,
      );

      if (runId !== null) {
        await this.fail(runId, message);
      }

      return null;
    }
  }

  /**
   * Forgets runs older than a year.
   *
   * @returns What it did.
   */
  async prune(): Promise<RetentionOutcome> {
    const cutOff = new Date();

    cutOff.setUTCMonth(cutOff.getUTCMonth() - RETENTION_RUN_KEEP_MONTHS);

    const tally = await purgeInBatches(
      this._dataSource.manager,
      RetentionRunEntity,
      { startedAt: LessThan(cutOff) },
    );

    return { counts: { runs: tally.deleted }, complete: tally.complete };
  }

  /**
   * Records why a run stopped, reporting rather than throwing when even
   * that fails.
   *
   * @param runId - The run.
   * @param message - Why.
   */
  private async fail(runId: string, message: string): Promise<void> {
    try {
      await this._dataSource.manager.update(
        RetentionRunEntity,
        { id: runId },
        {
          finishedAt: new Date(),
          complete: false,
          error: message.slice(0, ERROR_LENGTH),
        },
      );
    } catch (error) {
      this._logger.error(
        `[fail] Retention run not recorded as failed - RunId: ${runId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
