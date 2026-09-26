import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';

import { FILE_SCAN_REQUEST_QUEUE } from '../contract/file-scan-contract';
import {
  ScanAwaitingDto,
  ScanDiagnosticsDto,
  ScanEngineStatusDto,
  ScanQueueDto,
  ScanUsageWindowDto,
} from '../dto/scan-diagnostics.dto';

/**
 * The scan worker's schema.
 *
 * Named here rather than configured, because it is part of the contract with
 * the worker: the worker refuses to start with any other, and its migrations
 * name it in their SQL.
 */
export const SCAN_WORKER_SCHEMA = 'sto_info_worker';

/** The asset states that are waiting on a verdict. */
const AWAITING_STATES = [
  FileAssetState.QUARANTINED,
  FileAssetState.SCANNING,
  FileAssetState.RETRY_PENDING,
] as const;

/** A row of the worker's `scan_usage` view. */
type ScanUsageRow = ScanUsageWindowDto & { readonly position: number };

/** A row of the worker's `scan_engine_status` view. */
interface ScanEngineStatusRow {
  readonly engine: string;
  readonly engineVersion: string | null;
  readonly signatureVersion: string | null;
  readonly definitionsBuiltAt: Date | null;
  readonly reportedAt: Date;
}

/** Milliseconds in a tenth of an hour, for signature age to one decimal. */
const TENTH_OF_AN_HOUR_MS = 360_000;

/**
 * Reads the figures the admin scan diagnostics page shows (FC-003).
 *
 * Four sources, each read on its own so that one being down does not hide
 * the others:
 *
 * - **Usage and engine status** come from two views the worker grants this
 *   application in its own schema. They carry totals only, and this
 *   application has no read on the table beneath them.
 * - **The queue** is the scan request queue's own job counts, which is where
 *   a backlog shows first.
 * - **Assets awaiting a verdict** come from the registry, which this
 *   application owns.
 *
 * Nothing here names an asset, a file, an owner or a signature. The worker's
 * views cannot, and the registry is only counted.
 */
@Injectable()
export class ScanDiagnosticsService {
  private readonly _logger = new Logger(ScanDiagnosticsService.name);

  /**
   * Creates an instance of ScanDiagnosticsService.
   *
   * @param _dataSource - The database, for the worker's views.
   * @param _queue - The scan request queue.
   * @param _assets - The asset registry.
   */
  constructor(
    private readonly _dataSource: DataSource,
    @InjectQueue(FILE_SCAN_REQUEST_QUEUE) private readonly _queue: Queue,
    @InjectRepository(FileAssetEntity)
    private readonly _assets: Repository<FileAssetEntity>,
  ) {}

  /**
   * Reads everything the page shows.
   *
   * @returns The diagnostics, with a null part for each source that could
   *   not be reached.
   */
  async read(): Promise<ScanDiagnosticsDto> {
    const generatedAt = new Date();
    const [usage, engine, queue, awaiting] = await Promise.all([
      this.readUsage(),
      this.readEngine(generatedAt),
      this.readQueue(),
      this.readAwaiting(),
    ]);

    return { generatedAt, usage, engine, queue, awaiting };
  }

  /**
   * Reads the worker's usage view.
   *
   * @returns One entry for each window, or null when the view cannot be
   *   read — most likely because the worker's migrations have not run here.
   */
  private async readUsage(): Promise<ScanUsageWindowDto[] | null> {
    try {
      const rows: ScanUsageRow[] = await this._dataSource.query(
        `SELECT * FROM "${SCAN_WORKER_SCHEMA}"."scan_usage" ORDER BY "position"`,
      );

      // The view orders by its own column, which the page has no use for.
      return rows.map(
        row =>
          Object.fromEntries(
            Object.entries(row).filter(([key]) => key !== 'position'),
          ) as ScanUsageWindowDto,
      );
    } catch (error) {
      this.warn('readUsage', error);

      return null;
    }
  }

  /**
   * Reads the worker's engine status view.
   *
   * @param now - The moment the signature age is measured to.
   * @returns What the latest attempt reported, or null when nothing has been
   *   scanned or the view cannot be read.
   */
  private async readEngine(now: Date): Promise<ScanEngineStatusDto | null> {
    let rows: ScanEngineStatusRow[];

    try {
      rows = await this._dataSource.query(
        `SELECT * FROM "${SCAN_WORKER_SCHEMA}"."scan_engine_status"`,
      );
    } catch (error) {
      this.warn('readEngine', error);

      return null;
    }

    if (rows.length === 0) {
      return null;
    }

    const [row] = rows;
    const builtAt = row.definitionsBuiltAt;

    return {
      ...row,
      signatureAgeHours:
        builtAt === null
          ? null
          : Math.round(
              (now.getTime() - builtAt.getTime()) / TENTH_OF_AN_HOUR_MS,
            ) / 10,
    };
  }

  /**
   * Reads the scan request queue's job counts.
   *
   * Prioritised jobs are waiting jobs as far as a reader is concerned, so the
   * two are one figure.
   *
   * @returns The counts, or null when Redis cannot be reached.
   */
  private async readQueue(): Promise<ScanQueueDto | null> {
    try {
      const counts = await this._queue.getJobCounts(
        'waiting',
        'prioritized',
        'delayed',
        'active',
        'failed',
      );

      return {
        waiting: (counts.waiting ?? 0) + (counts.prioritized ?? 0),
        delayed: counts.delayed ?? 0,
        active: counts.active ?? 0,
        failed: counts.failed ?? 0,
      };
    } catch (error) {
      this.warn('readQueue', error);

      return null;
    }
  }

  /**
   * Counts the registry's assets that are waiting on a verdict.
   *
   * @returns A count for each waiting state, zero when there are none.
   */
  private async readAwaiting(): Promise<ScanAwaitingDto> {
    const rows: { state: FileAssetState; count: number }[] = await this._assets
      .createQueryBuilder('asset')
      .select('asset.state', 'state')
      .addSelect('COUNT(*)::int', 'count')
      .where('asset.state IN (:...states)', { states: AWAITING_STATES })
      .groupBy('asset.state')
      .getRawMany();

    const count = (state: FileAssetState): number =>
      rows.find(row => row.state === state)?.count ?? 0;

    return {
      quarantined: count(FileAssetState.QUARANTINED),
      scanning: count(FileAssetState.SCANNING),
      retryPending: count(FileAssetState.RETRY_PENDING),
    };
  }

  /**
   * Logs a source that could not be read, without its message.
   *
   * A database error's message can quote the statement, and a Redis error's
   * can name the host. The class and the SQLSTATE are enough to act on.
   *
   * @param source - The method that failed.
   * @param error - What it threw.
   */
  private warn(source: string, error: unknown): void {
    const code = (error as { code?: unknown } | null)?.code;
    const name = error instanceof Error ? error.name : typeof error;

    this._logger.warn(
      `[${source}] Source unavailable - Error: ${name}` +
        (typeof code === 'string' ? `, Code: ${code}` : ''),
    );
  }
}
