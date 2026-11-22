import { DataSource } from 'typeorm';

import { WORKER_LIVE_SECONDS } from 'src/operations/alerts/operations-alert.constants';

import {
  ScanWorkerHeartbeatDto,
  ScanWorkerState,
} from '../dto/scan-diagnostics.dto';

/**
 * The scan worker's schema.
 *
 * Named here rather than configured, because it is part of the contract with
 * the worker: the worker refuses to start with any other, and its migrations
 * name it in their SQL.
 */
export const SCAN_WORKER_SCHEMA = 'sto_info_worker';

/** Why the scan worker is taking no uploads, when it is not. */
export type WorkerBlockage = 'WORKER_SILENT' | 'WORKER_PAUSED';

/** A row of the worker's `worker_heartbeat_status` view, with its ages. */
interface WorkerHeartbeatRow {
  readonly workerId: string;
  readonly state: ScanWorkerState;
  readonly pauseReason: string | null;
  readonly definitionsVersion: string | null;
  readonly definitionsBuiltAt: Date | null;
  readonly jobsInHand: number;
  readonly startedAt: Date;
  readonly beatAt: Date;
  readonly pausedSince: Date | null;
  /** Seconds since `beatAt`, on the database's clock. */
  readonly secondsSinceBeat: number;
  /** Seconds since `pausedSince`, or null. */
  readonly secondsPaused: number | null;
  /** Seconds since `definitionsBuiltAt`, or null. */
  readonly secondsSinceDefinitions: number | null;
}

/** Seconds in a tenth of an hour, for signature age to one decimal. */
const TENTH_OF_AN_HOUR_S = 360;

/**
 * Reads the worker's heartbeat view (FC-042): every worker process that has
 * beaten in the last day, latest beat first.
 *
 * A plain function rather than a provider, because both Scan Diagnostics
 * and the asset registry's stale-upload sweep need it, and the registry's
 * module is the one the scanning module is built on. Every age is worked
 * out by the database, against its own clock, which is the clock the worker
 * wrote its timestamps on; this process's clock may differ from it.
 *
 * @param dataSource - The database.
 * @returns One entry for each process.
 * @throws Error when the view cannot be read — most likely because the
 *   worker's migrations have not run here.
 */
export async function readWorkerHeartbeats(
  dataSource: DataSource,
): Promise<ScanWorkerHeartbeatDto[]> {
  const rows: WorkerHeartbeatRow[] = await dataSource.query(
    `SELECT h."workerId", h."state", h."pauseReason", ` +
      `h."definitionsVersion", h."definitionsBuiltAt", h."jobsInHand", ` +
      `h."startedAt", h."beatAt", h."pausedSince", ` +
      `EXTRACT(EPOCH FROM now() - h."beatAt")::float8 AS "secondsSinceBeat", ` +
      `EXTRACT(EPOCH FROM now() - h."pausedSince")::float8 AS "secondsPaused", ` +
      `EXTRACT(EPOCH FROM now() - h."definitionsBuiltAt")::float8 AS "secondsSinceDefinitions" ` +
      `FROM "${SCAN_WORKER_SCHEMA}"."worker_heartbeat_status" h ` +
      `ORDER BY h."beatAt" DESC`,
  );

  return rows.map(row => ({
    workerId: row.workerId,
    state: row.state,
    pauseReason: row.pauseReason,
    definitionsVersion: row.definitionsVersion,
    definitionsBuiltAt: row.definitionsBuiltAt,
    signatureAgeHours:
      row.secondsSinceDefinitions === null
        ? null
        : Math.round(row.secondsSinceDefinitions / TENTH_OF_AN_HOUR_S) / 10,
    jobsInHand: row.jobsInHand,
    startedAt: row.startedAt,
    beatAt: row.beatAt,
    secondsSinceBeat: Math.max(0, Math.round(row.secondsSinceBeat)),
    live: row.secondsSinceBeat <= WORKER_LIVE_SECONDS,
    pausedSince: row.pausedSince,
    pausedMinutes:
      row.secondsPaused === null
        ? null
        : Math.max(0, Math.floor(row.secondsPaused / 60)),
  }));
}

/**
 * Whether the scan worker is taking uploads now, by the same definitions
 * as the `WORKER_SILENT` and `WORKER_PAUSED` alerts, without their grace
 * periods: silent when no worker has beaten lately or the heartbeat cannot
 * be read, paused when every live worker is paused.
 *
 * @param workers - The heartbeats, or null when they could not be read.
 * @returns Why it is taking none, or null when it is taking them.
 */
export function workerBlockage(
  workers: readonly ScanWorkerHeartbeatDto[] | null,
): WorkerBlockage | null {
  const live = (workers ?? []).filter(worker => worker.live);

  if (live.length === 0) {
    return 'WORKER_SILENT';
  }

  return live.every(worker => worker.state === 'PAUSED')
    ? 'WORKER_PAUSED'
    : null;
}
