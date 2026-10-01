import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { DataSource, IsNull, Repository } from 'typeorm';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { PublicationPauseService } from 'src/file-assets/publication/publication-pause.service';
import { OperationsAlertDto } from 'src/operations/alerts/operations-alert.dto';
import { OperationsAlertEntity } from 'src/operations/alerts/operations-alert.entity';
import { redisWithin } from 'src/shared/queue/redis-within.utility';

import { FILE_SCAN_REQUEST_QUEUE } from '../contract/file-scan-contract';
import {
  ScanAssetDetailDto,
  ScanAwaitingDto,
  ScanDiagnosticsDto,
  ScanEngineStatusDto,
  ScanQueueDto,
  ScanRejectionPageDto,
  ScanUsageWindowDto,
  ScanWorkerHeartbeatDto,
} from '../dto/scan-diagnostics.dto';
import { UNKNOWN_DEFINITION_EPOCH } from '../rescan/rescan.constants';
import { recordDiagnosticsRead } from './diagnostics-read.utility';
import {
  readWorkerHeartbeats,
  SCAN_WORKER_SCHEMA,
} from './worker-heartbeat.utility';

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
 * Its sources are each read on their own so that one being down does not
 * hide the others:
 *
 * - **Usage, engine status and the workers' heartbeats** come from three
 *   views the worker grants this application in its own schema. They carry
 *   totals, versions and states only, and this application has no read on
 *   the tables beneath them.
 * - **The queue** is the scan request queue's own job counts, which is where
 *   a backlog shows first.
 * - **Assets awaiting a verdict** come from the registry, which this
 *   application owns.
 * - **Open operations alerts** and **the publication pause** are this
 *   application's own (FC-042).
 *
 * Nothing here names an asset, a file, an owner or a signature. The worker's
 * views cannot, and the registry is only counted. Every read a site admin
 * makes is logged in the site admin log (FC-042).
 */
/** How many refused assets a page lists. */
export const SCAN_REJECTION_PAGE_SIZE = 25;

@Injectable()
export class ScanDiagnosticsService {
  private readonly _logger = new Logger(ScanDiagnosticsService.name);

  /**
   * Creates an instance of ScanDiagnosticsService.
   *
   * @param _dataSource - The database, for the worker's views, the open
   *   alerts and the site admin log.
   * @param _queue - The scan request queue.
   * @param _assets - The asset registry.
   * @param _publication - The publication pause (FC-042).
   */
  constructor(
    private readonly _dataSource: DataSource,
    @InjectQueue(FILE_SCAN_REQUEST_QUEUE) private readonly _queue: Queue,
    @InjectRepository(FileAssetEntity)
    private readonly _assets: Repository<FileAssetEntity>,
    private readonly _publication: PublicationPauseService,
  ) {}

  /**
   * One asset's scan outcome (FC-039), logged as read (FC-042).
   *
   * @param assetId - The asset.
   * @param adminUserId - The site admin reading it.
   * @returns What the scanner decided, and with what.
   * @throws NotFoundException when there is no such asset.
   */
  async asset(
    assetId: string,
    adminUserId: string,
  ): Promise<ScanAssetDetailDto> {
    const asset = await this._assets.findOne({ where: { id: assetId } });

    if (asset === null) {
      throw new NotFoundException('Not found');
    }

    await recordDiagnosticsRead(
      this._dataSource.manager,
      adminUserId,
      'ASSET',
      asset.id,
    );

    return detailOf(asset);
  }

  /**
   * The assets a scanner or policy refused, newest verdict first (FC-039).
   * A page after the first is logged as read (FC-042); the first is read
   * with the diagnostics, whose entry covers it.
   *
   * @param page - Which page, from 1.
   * @param adminUserId - The site admin reading them.
   * @returns The page.
   */
  async rejections(
    page: number,
    adminUserId: string,
  ): Promise<ScanRejectionPageDto> {
    const [assets, total] = await this._assets.findAndCount({
      where: { state: FileAssetState.REJECTED },
      order: { lastVerdictAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * SCAN_REJECTION_PAGE_SIZE,
      take: SCAN_REJECTION_PAGE_SIZE,
    });

    // One entry per page view: the page reads the first page of refusals
    // with the diagnostics whenever it opens, and that read is logged by
    // `read()`. Only a later page, which a site admin turns to, is logged
    // on its own.
    if (page > 1) {
      await recordDiagnosticsRead(
        this._dataSource.manager,
        adminUserId,
        'REJECTIONS',
        null,
        { page },
      );
    }

    return {
      items: assets.map(detailOf),
      total,
      page,
      pageSize: SCAN_REJECTION_PAGE_SIZE,
    };
  }

  /**
   * The signature version the worker last reported: its definition epoch,
   * which a rescan is deduplicated against (FC-041).
   *
   * @returns The epoch, or the worker's own "unknown" when it cannot be read.
   */
  async currentDefinitionEpoch(): Promise<string> {
    const engine = await this.readEngine(new Date());

    return engine?.signatureVersion ?? UNKNOWN_DEFINITION_EPOCH;
  }

  /**
   * Reads everything the page shows, logged as read (FC-042).
   *
   * @param adminUserId - The site admin reading it.
   * @returns The diagnostics, with a null part for each source that could
   *   not be reached.
   */
  async read(adminUserId: string): Promise<ScanDiagnosticsDto> {
    const generatedAt = new Date();
    const [usage, engine, queue, awaiting, workers, alerts, publication] =
      await Promise.all([
        this.readUsage(),
        this.readEngine(generatedAt),
        this.readQueue(),
        this.readAwaiting(),
        this.readHeartbeats(),
        this.readAlerts(),
        this._publication.read(),
      ]);

    await recordDiagnosticsRead(
      this._dataSource.manager,
      adminUserId,
      'DIAGNOSTICS',
    );

    return {
      generatedAt,
      usage,
      engine,
      queue,
      awaiting,
      workers,
      alerts,
      publication,
    };
  }

  /**
   * Reads the worker's heartbeat view (FC-042): every worker process that
   * has beaten in the last day, latest beat first.
   *
   * Every age is worked out by the database, against its own clock, which
   * is the clock the worker wrote its timestamps on; this process's clock
   * may differ from it.
   *
   * @returns One entry for each process, or null when the view cannot be
   *   read — most likely because the worker's migrations have not run here.
   */
  async readHeartbeats(): Promise<ScanWorkerHeartbeatDto[] | null> {
    try {
      return await readWorkerHeartbeats(this._dataSource);
    } catch (error) {
      this.warn('readHeartbeats', error);

      return null;
    }
  }

  /**
   * Reads the operations alerts that are open now (FC-042).
   *
   * @returns Them, oldest first.
   */
  private async readAlerts(): Promise<OperationsAlertDto[]> {
    const open = await this._dataSource
      .getRepository(OperationsAlertEntity)
      .find({ where: { clearedAt: IsNull() }, order: { openedAt: 'ASC' } });

    return open.map(alert => ({
      kind: alert.kind,
      openedAt: alert.openedAt,
      lastSeenAt: alert.lastSeenAt,
      detail: { ...alert.detail },
    }));
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
   * @returns The counts, or null when Redis cannot be reached or does not
   *   answer within {@link REDIS_TIMEOUT_MS} (FC-042).
   */
  private async readQueue(): Promise<ScanQueueDto | null> {
    try {
      const counts = await redisWithin(() =>
        this._queue.getJobCounts(
          'waiting',
          'prioritized',
          'delayed',
          'active',
          'failed',
        ),
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

/**
 * An asset's scan outcome, and nothing else about it.
 *
 * @param asset - The asset.
 * @returns Its outcome.
 */
function detailOf(asset: FileAssetEntity): ScanAssetDetailDto {
  return {
    id: asset.id,
    kind: asset.kind,
    state: asset.state,
    rejectionCode: asset.rejectionCode,
    scanEngine: asset.scanEngine,
    scanEngineVersion: asset.scanEngineVersion,
    scanSignatureVersion: asset.scanSignatureVersion,
    policyVersion: asset.policyVersion,
    createdAt: asset.createdAt,
    lastVerdictAt: asset.lastVerdictAt,
  };
}
