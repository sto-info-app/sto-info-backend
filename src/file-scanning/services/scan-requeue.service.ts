import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { DataSource, In, IsNull, Not, Raw } from 'typeorm';

import { CRON_TIMEZONE } from 'src/cron/constants/cron.constants';
import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { redisWithin } from 'src/shared/queue/redis-within.utility';

import {
  FILE_SCAN_REQUEST_QUEUE,
  FILE_SCAN_VERDICT_QUEUE,
} from '../contract/file-scan-contract';
import {
  scanJobIdOf,
  ScanRequestProducerService,
} from './scan-request-producer.service';

/**
 * How long an upload waits for a scan with no request on the queue before
 * it is queued again, in minutes. Far longer than the moment between storing
 * the bytes and queueing the request.
 */
export const SCAN_REQUEUE_AFTER_MINUTES = 2;

/** The most uploads one run looks at. */
export const SCAN_REQUEUE_BATCH = 50;

/**
 * How many failed verdicts are read to find the uploads the failed-jobs flow
 * owns. A failed set that long is itself an alert.
 */
export const FAILED_VERDICT_SAMPLE = 500;

/** The PostgreSQL advisory lock one re-queue run holds. */
export const SCAN_REQUEUE_LOCK = 1_797_500_001;

/** The registry states meaning "bytes in quarantine, no verdict yet". */
const AWAITING_SCAN: readonly FileAssetState[] = [
  FileAssetState.QUARANTINED,
  FileAssetState.SCANNING,
  FileAssetState.RETRY_PENDING,
];

/**
 * Queues again the uploads whose scan request never reached the queue, or
 * was lost from it (FC-042).
 *
 * Steve's decision of 1 October 2026: an upload made while Redis is down is
 * accepted and queued later. Every minute, once Redis answers, this finds
 * stored uploads still awaiting a scan — `QUARANTINED`, `SCANNING` or
 * `RETRY_PENDING` for more than {@link SCAN_REQUEUE_AFTER_MINUTES} minutes —
 * whose request is not on the `file-scan` queue under its deterministic
 * identifier, and sends it again, {@link SCAN_REQUEUE_BATCH} at a time.
 *
 * - **Present in any state counts.** Waiting, prioritised, delayed, active,
 *   or kept after failing: a failed request is the failed-jobs flow's, and
 *   so is an upload whose verdict is in the verdict queue's failed set.
 * - **The state decides how.** An upload in `QUARANTINED` or
 *   `RETRY_PENDING` is requested as a new upload is; one still in
 *   `SCANNING` — its job lost with Redis's data, or never sent — has its
 *   request sent again and its state left alone.
 * - **The worker's side is safe.** A request for an attempt the worker has
 *   already finished repeats that verdict; one whose attempt was being held
 *   when the job was lost waits for the lease to lapse and takes it over.
 * - **Only when Redis answers**, each question given
 *   {@link REDIS_TIMEOUT_MS}; a run that loses Redis part way stops, and the
 *   next carries on.
 * - **Runs do not overlap**: in this process by a flag, and across instances
 *   by a PostgreSQL advisory lock, as the operations alerts do.
 */
@Injectable()
export class ScanRequeueService {
  private readonly _logger = new Logger(ScanRequeueService.name);

  /** Whether a run is going in this process. */
  private _running = false;

  /**
   * Creates an instance of ScanRequeueService.
   *
   * @param _dataSource - The database, for the registry and the lock.
   * @param _requests - The scan request queue.
   * @param _verdicts - The verdict queue, for its failed set.
   * @param _producer - What queues a scan request.
   */
  constructor(
    @InjectDataSource() private readonly _dataSource: DataSource,
    @InjectQueue(FILE_SCAN_REQUEST_QUEUE) private readonly _requests: Queue,
    @InjectQueue(FILE_SCAN_VERDICT_QUEUE) private readonly _verdicts: Queue,
    private readonly _producer: ScanRequestProducerService,
  ) {}

  /**
   * Queues again what has lost its request. Every minute.
   *
   * Errors are caught, because an unhandled rejection inside a scheduled
   * job takes the process down; the next run tries again.
   *
   * @returns How many were queued again, or null when the run was skipped,
   *   could not reach Redis, or failed.
   */
  @Cron(CronExpression.EVERY_MINUTE, { timeZone: CRON_TIMEZONE })
  async tick(): Promise<number | null> {
    if (this._running) {
      this._logger.warn('[tick] Previous run still going; skipped');

      return null;
    }

    this._running = true;

    try {
      return await this.runLocked();
    } catch (error) {
      this._logger.error(
        `[tick] Scan re-queue run failed - Error: ` +
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
   * @returns How many were queued again, or null when another instance is
   *   running or Redis did not answer.
   */
  private async runLocked(): Promise<number | null> {
    const runner = this._dataSource.createQueryRunner();

    try {
      await runner.connect();

      const [{ locked }] = (await runner.query(
        'SELECT pg_try_advisory_lock($1::bigint) AS "locked"',
        [SCAN_REQUEUE_LOCK],
      )) as Array<{ locked: boolean }>;

      if (!locked) {
        return null;
      }

      try {
        return await this.requeue();
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1::bigint)', [
          SCAN_REQUEUE_LOCK,
        ]);
      }
    } finally {
      await runner.release();
    }
  }

  /**
   * Finds the uploads that have lost their request and queues them again.
   *
   * @returns How many were queued again, or null when Redis did not answer
   *   before anything was queued.
   */
  async requeue(): Promise<number | null> {
    const waiting = await this._dataSource.manager.find(FileAssetEntity, {
      where: {
        state: In([...AWAITING_SCAN]),
        objectKey: Not(IsNull()),
        sha256: Not(IsNull()),
        declaredContentType: Not(IsNull()),
        updatedAt: Raw(
          column =>
            `${column} < now() - interval '${SCAN_REQUEUE_AFTER_MINUTES} minutes'`,
        ),
      },
      order: { updatedAt: 'ASC', id: 'ASC' },
      take: SCAN_REQUEUE_BATCH,
    });

    if (waiting.length === 0) {
      return 0;
    }

    let failedVerdicts: Set<string>;

    try {
      failedVerdicts = await this.failedVerdictAssets();
    } catch (error) {
      this.warn('requeue', error);

      return null;
    }

    let requeued = 0;

    for (const asset of waiting) {
      try {
        if (!(await this.requeueOne(asset, failedVerdicts))) {
          continue;
        }

        requeued += 1;
      } catch (error) {
        this.warn('requeue', error);

        break;
      }
    }

    if (requeued > 0) {
      this._logger.warn(
        `[requeue] Scan requests queued again - Count: ${requeued}, ` +
          `Checked: ${waiting.length}`,
      );
    }

    return requeued;
  }

  /**
   * Queues one upload again, unless its request is on the queue or its
   * verdict is waiting for a site admin.
   *
   * @param asset - The upload.
   * @param failedVerdicts - The uploads whose verdict is in the failed set.
   * @returns True when it was queued again.
   * @throws Error when Redis does not take it, which stops the run.
   */
  private async requeueOne(
    asset: FileAssetEntity,
    failedVerdicts: ReadonlySet<string>,
  ): Promise<boolean> {
    if (failedVerdicts.has(asset.id)) {
      return false;
    }

    const job = await redisWithin(() =>
      this._requests.getJob(scanJobIdOf(asset)),
    );

    if (job !== undefined) {
      return false;
    }

    if (asset.state === FileAssetState.SCANNING) {
      await this._producer.resend(asset);

      return true;
    }

    const requested = await this._producer.requestScan(asset);

    if (!requested.queued) {
      throw new Error('The queue did not take the request');
    }

    return true;
  }

  /**
   * The uploads whose verdict is in the verdict queue's failed set, which
   * the failed-jobs flow owns.
   *
   * @returns Their asset IDs.
   */
  private async failedVerdictAssets(): Promise<Set<string>> {
    const failed = await redisWithin(() =>
      this._verdicts.getFailed(0, FAILED_VERDICT_SAMPLE - 1),
    );

    return new Set(
      failed
        .map(job => (job.data as { assetId?: unknown } | null)?.assetId)
        .filter((id): id is string => typeof id === 'string'),
    );
  }

  /**
   * Logs a source that could not be reached, without its message.
   *
   * @param source - The method that failed.
   * @param error - What it threw.
   */
  private warn(source: string, error: unknown): void {
    this._logger.warn(
      `[${source}] Scan requests not queued again; the next run tries - ` +
        `Error: ${error instanceof Error ? error.name : typeof error}`,
    );
  }
}
