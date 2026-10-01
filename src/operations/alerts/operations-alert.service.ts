import { getQueueToken } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { DataSource, IsNull } from 'typeorm';

import { CRON_TIMEZONE } from 'src/cron/constants/cron.constants';
import { FILE_ASSET_PUBLICATION_QUEUE } from 'src/file-assets/constants/file-asset-publication.constants';
import { PublicationPauseService } from 'src/file-assets/publication/publication-pause.service';
import { readOwedPurges } from 'src/file-assets/services/owed-purge-sweep.service';
import { FILE_SCAN_REQUEST_QUEUE } from 'src/file-scanning/contract/file-scan-contract';
import { ScanDiagnosticsService } from 'src/file-scanning/services/scan-diagnostics.service';
import { NotificationSeverity } from 'src/notification/enums/notification-severity.enum';
import { NotificationTarget } from 'src/notification/enums/notification-target.enum';
import { NotificationService } from 'src/notification/notification.service';
import { redisWithin } from 'src/shared/queue/redis-within.utility';
import { UserEntity } from 'src/user/entities/user.entity';
import { UserRole } from 'src/user/enums/user-role.enum';

import { FailedJobsService } from '../failed-jobs/failed-jobs.service';
import {
  OPERATIONS_ALERT_LOCK,
  PRIORITISED_SAMPLE,
  PUBLICATION_PAUSED_LONG_MINUTES,
  PUBLICATION_QUEUE_LAG_MINUTES,
  PURGE_OWED_HOURS,
  QUEUE_PROBE_TIMEOUT_MS,
  QUEUES_UNREACHABLE_MINUTES,
  SCAN_DIAGNOSTICS_LINK,
  SCAN_QUEUE_LAG_MINUTES,
  SIGNATURES_STALE_HOURS,
  WORKER_PAUSED_MINUTES,
} from './operations-alert.constants';
import { OperationsAlertEntity } from './operations-alert.entity';
import { OperationsAlertKind } from './operations-alert.enum';

/**
 * What one check found: the problem is there, with its counts; it is not;
 * or null, when the check could not tell, which leaves the alert as it was.
 */
export type OperationsFinding =
  | { readonly open: true; readonly detail: Record<string, number> }
  | { readonly open: false }
  | null;

/** A notice's words. */
interface Notice {
  readonly title: string;
  readonly body: string;
}

/** What every site admin is told when each problem opens and clears. */
export const OPERATIONS_ALERT_NOTICES: Readonly<
  Record<OperationsAlertKind, { opened: Notice; cleared: Notice }>
> = {
  [OperationsAlertKind.SCAN_QUEUE_LAG]: {
    opened: {
      title: 'Uploads are waiting to be scanned',
      body:
        `An upload has waited more than ${SCAN_QUEUE_LAG_MINUTES} minutes ` +
        'to be scanned. Look at Scan Diagnostics.',
    },
    cleared: {
      title: 'Uploads are being scanned again',
      body: `No upload has waited more than ${SCAN_QUEUE_LAG_MINUTES} minutes to be scanned.`,
    },
  },
  [OperationsAlertKind.PUBLICATION_QUEUE_LAG]: {
    opened: {
      title: 'Uploads are waiting to be published',
      body:
        `A scanned upload has waited more than ` +
        `${PUBLICATION_QUEUE_LAG_MINUTES} minutes to be published. Look at ` +
        'Scan Diagnostics.',
    },
    cleared: {
      title: 'Uploads are being published again',
      body: `No scanned upload has waited more than ${PUBLICATION_QUEUE_LAG_MINUTES} minutes to be published.`,
    },
  },
  [OperationsAlertKind.WORKER_SILENT]: {
    opened: {
      title: 'The scan worker is silent',
      body:
        'No scan worker has reported in the last two minutes, so uploads ' +
        'are not being scanned. Look at Scan Diagnostics.',
    },
    cleared: {
      title: 'The scan worker is reporting again',
      body: 'A scan worker has reported in the last two minutes.',
    },
  },
  [OperationsAlertKind.WORKER_PAUSED]: {
    opened: {
      title: 'The scan worker is paused',
      body:
        `Every scan worker has been paused for more than ` +
        `${WORKER_PAUSED_MINUTES} minutes, so uploads are waiting. Look at ` +
        'Scan Diagnostics for the reason.',
    },
    cleared: {
      title: 'The scan worker is scanning again',
      body: 'At least one scan worker is taking uploads again.',
    },
  },
  [OperationsAlertKind.SIGNATURES_STALE]: {
    opened: {
      title: 'Virus signatures are out of date',
      body:
        `The newest virus signatures the scan worker holds are more than ` +
        `${SIGNATURES_STALE_HOURS} hours old; it stops scanning at 48. ` +
        'Look at Scan Diagnostics.',
    },
    cleared: {
      title: 'Virus signatures are up to date',
      body: `The scan worker holds virus signatures less than ${SIGNATURES_STALE_HOURS} hours old.`,
    },
  },
  [OperationsAlertKind.FAILED_JOBS]: {
    opened: {
      title: 'Background jobs have failed',
      body:
        'One or more background jobs have run out of attempts. Look at ' +
        'Scan Diagnostics to retry them.',
    },
    cleared: {
      title: 'No background jobs have failed',
      body: 'There are no failed background jobs left.',
    },
  },
  [OperationsAlertKind.QUEUES_UNREACHABLE]: {
    opened: {
      title: 'The job queues cannot be reached',
      body:
        `Redis has not answered for more than ` +
        `${QUEUES_UNREACHABLE_MINUTES} minutes, so uploads are not being ` +
        'scanned or published and background jobs are not running. Look at ' +
        'Scan Diagnostics.',
    },
    cleared: {
      title: 'The job queues are reachable again',
      body: 'Redis is answering again, and the queues are moving.',
    },
  },
  [OperationsAlertKind.PURGE_OWED]: {
    opened: {
      title: 'Withdrawn pictures are still online',
      body:
        `A withdrawn picture's public copy has not been deleted for more ` +
        `than ${PURGE_OWED_HOURS} hours, so it can still be reached at its ` +
        'old address. The site retries every hour; look at Scan Diagnostics.',
    },
    cleared: {
      title: 'Withdrawn pictures have been deleted',
      body: `No withdrawn picture has waited more than ${PURGE_OWED_HOURS} hours to be deleted.`,
    },
  },
  [OperationsAlertKind.PUBLICATION_PAUSED_LONG]: {
    opened: {
      title: 'Publication is still paused',
      body:
        `Publication has been paused for more than an hour: uploads are ` +
        'being scanned but not published. Resume it from the Admin page ' +
        'when it is safe to.',
    },
    cleared: {
      title: 'Publication is no longer paused',
      body: 'Publication has been resumed, and held uploads are publishing.',
    },
  },
};

/** Milliseconds in a minute. */
const MINUTE_MS = 60_000;

/**
 * The operations alerts (FC-042): every minute, checks the file pipeline
 * for the problems Steve chose to be told about, and tells every site admin
 * in-app — once when a problem opens, once when it clears, and nothing in
 * between.
 *
 * - **Scan backlog.** The oldest waiting scan request is older than
 *   {@link SCAN_QUEUE_LAG_MINUTES} minutes; and the same for publication,
 *   except while publication is paused.
 * - **The worker.** No worker has beaten in two minutes, or its heartbeat
 *   cannot be read; every live worker has been paused for more than
 *   {@link WORKER_PAUSED_MINUTES} minutes; or the newest signatures a live
 *   worker holds are more than {@link SIGNATURES_STALE_HOURS} hours old.
 * - **Failed jobs**, in any queue that keeps them.
 * - **Publication paused** for more than an hour.
 * - **A withdrawn picture still online**: its public copy owed a purge for
 *   more than {@link PURGE_OWED_HOURS} hours (FC-043). The database alone
 *   says so, so this one is judged whatever Redis is doing.
 * - **Redis unreachable** for {@link QUEUES_UNREACHABLE_MINUTES} minutes
 *   running, measured across runs from the first that could not reach it.
 *   Notifications are database rows, so this one is told without Redis.
 *   While Redis cannot be reached the checks that need it are not run, and
 *   their alerts stay as they were.
 *
 * Each problem is an `operations_alert` row, open until the problem goes;
 * a partial unique index keeps one of each kind open, so a second instance
 * cannot open and announce it again. A check that cannot tell — Redis down,
 * say — leaves its alert as it was rather than guessing.
 *
 * Each run also brings the publication queue into line with the pause
 * switch, since Redis can be lost and the database is the authority. Runs
 * never overlap: one still going when the next is due is skipped, and a
 * PostgreSQL advisory lock keeps two instances from running at once.
 */
@Injectable()
export class OperationsAlertService {
  private readonly _logger = new Logger(OperationsAlertService.name);

  /** Whether a run is going in this process. */
  private _running = false;

  /**
   * When this process's runs first found Redis unreachable, in this spell;
   * null while it answers. Kept in memory: a restart in the middle of an
   * outage starts the two minutes again, which only delays the alert.
   */
  private _unreachableSince: number | null = null;

  /**
   * Creates an instance of OperationsAlertService.
   *
   * @param _dataSource - The database, for the alerts and the lock.
   * @param _diagnostics - Reads the workers' heartbeats.
   * @param _publication - The publication pause.
   * @param _failedJobs - Counts the failed jobs.
   * @param _notifications - Tells the site admins.
   * @param _modules - Where the scan and publication queues are found.
   */
  constructor(
    @InjectDataSource() private readonly _dataSource: DataSource,
    private readonly _diagnostics: ScanDiagnosticsService,
    private readonly _publication: PublicationPauseService,
    private readonly _failedJobs: FailedJobsService,
    private readonly _notifications: NotificationService,
    private readonly _modules: ModuleRef,
  ) {}

  /**
   * Runs the checks. Every minute.
   *
   * Errors are caught, because an unhandled rejection inside a scheduled
   * job takes the process down; the next run tries again.
   *
   * @returns True when the checks ran, false when they were skipped or
   *   failed.
   */
  @Cron(CronExpression.EVERY_MINUTE, { timeZone: CRON_TIMEZONE })
  async tick(): Promise<boolean> {
    if (this._running) {
      this._logger.warn('[tick] Previous run still going; skipped');

      return false;
    }

    this._running = true;

    try {
      return await this.runLocked();
    } catch (error) {
      this._logger.error(
        `[tick] Operations alert run failed - Error: ` +
          (error instanceof Error ? error.name : typeof error),
      );

      return false;
    } finally {
      this._running = false;
    }
  }

  /**
   * Runs the checks while holding the advisory lock, if no other instance
   * holds it.
   *
   * @returns True when the checks ran.
   */
  private async runLocked(): Promise<boolean> {
    const runner = this._dataSource.createQueryRunner();

    try {
      await runner.connect();

      const [{ locked }] = (await runner.query(
        'SELECT pg_try_advisory_lock($1::bigint) AS "locked"',
        [OPERATIONS_ALERT_LOCK],
      )) as Array<{ locked: boolean }>;

      if (!locked) {
        return false;
      }

      try {
        const reachable = await this.probeQueues();
        const paused = reachable
          ? await this._publication.apply('alerts')
          : null;

        for (const [kind, finding] of await this.evaluate(paused, reachable)) {
          await this.settle(kind, finding);
        }

        return true;
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1::bigint)', [
          OPERATIONS_ALERT_LOCK,
        ]);
      }
    } finally {
      await runner.release();
    }
  }

  /**
   * Runs every check.
   *
   * @param paused - Whether publication is paused, or null when unknown.
   * @param reachable - Whether Redis answered this run. When it did not,
   *   the checks that need it are not run.
   * @returns What each found.
   */
  async evaluate(
    paused: boolean | null,
    reachable = true,
  ): Promise<Array<[OperationsAlertKind, OperationsFinding]>> {
    const now = Date.now();
    const workers = await this.checked('workers', () => this.checkWorkers());

    return [
      [
        OperationsAlertKind.SCAN_QUEUE_LAG,
        reachable
          ? await this.checked('scanQueue', () =>
              this.checkQueueLag(
                FILE_SCAN_REQUEST_QUEUE,
                SCAN_QUEUE_LAG_MINUTES,
                now,
              ),
            )
          : null,
      ],
      [
        OperationsAlertKind.PUBLICATION_QUEUE_LAG,
        !reachable || paused === null
          ? null
          : paused
            ? { open: false }
            : await this.checked('publicationQueue', () =>
                this.checkQueueLag(
                  FILE_ASSET_PUBLICATION_QUEUE,
                  PUBLICATION_QUEUE_LAG_MINUTES,
                  now,
                ),
              ),
      ],
      [OperationsAlertKind.WORKER_SILENT, workers?.silent ?? null],
      [OperationsAlertKind.WORKER_PAUSED, workers?.paused ?? null],
      [OperationsAlertKind.SIGNATURES_STALE, workers?.stale ?? null],
      [
        OperationsAlertKind.FAILED_JOBS,
        reachable
          ? await this.checked('failedJobs', () => this.checkFailedJobs())
          : null,
      ],
      [
        OperationsAlertKind.PUBLICATION_PAUSED_LONG,
        await this.checked('publicationPause', () =>
          this.checkPauseLength(now),
        ),
      ],
      [
        OperationsAlertKind.QUEUES_UNREACHABLE,
        this.checkReachability(reachable, now),
      ],
      [
        OperationsAlertKind.PURGE_OWED,
        await this.checked('owedPurges', () => this.checkOwedPurges()),
      ],
    ];
  }

  /**
   * Asks Redis to answer, through the scan queue's connection, giving up
   * after {@link QUEUE_PROBE_TIMEOUT_MS}: a client with nothing to talk to
   * holds commands rather than failing them.
   *
   * @returns Whether it answered in time.
   */
  private async probeQueues(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    // Any small command will do; this one reads a single hash field.
    const answered = this.queueOf(FILE_SCAN_REQUEST_QUEUE)
      .isPaused()
      .then(
        () => true,
        (error: unknown) => {
          this._logger.warn(
            `[probeQueues] Redis did not answer - Error: ` +
              (error instanceof Error ? error.name : typeof error),
          );

          return false;
        },
      );
    const timedOut = new Promise<boolean>(resolve => {
      timer = setTimeout(() => {
        this._logger.warn('[probeQueues] Redis did not answer in time');
        resolve(false);
      }, QUEUE_PROBE_TIMEOUT_MS);
    });

    try {
      return await Promise.race([answered, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Judges how long Redis has gone unanswering, across runs.
   *
   * @param reachable - Whether it answered this run.
   * @param now - The moment of the run.
   * @returns Clear when it answered; open once it has not for long enough;
   *   otherwise null, leaving the alert as it was.
   */
  private checkReachability(
    reachable: boolean,
    now: number,
  ): OperationsFinding {
    if (reachable) {
      this._unreachableSince = null;

      return { open: false };
    }

    this._unreachableSince ??= now;

    const minutesUnreachable = Math.floor(
      (now - this._unreachableSince) / MINUTE_MS,
    );

    return minutesUnreachable >= QUEUES_UNREACHABLE_MINUTES
      ? { open: true, detail: { minutesUnreachable } }
      : null;
  }

  /**
   * Finds a queue this application registers, without registering it again.
   *
   * @param name - The queue.
   * @returns It.
   */
  private queueOf(name: string): Queue {
    return this._modules.get<Queue>(getQueueToken(name), { strict: false });
  }

  /**
   * Runs one check, turning a failure into "could not tell".
   *
   * @param check - The check's name, for the log.
   * @param run - The check.
   * @returns What it found, or null when it failed.
   */
  private async checked<T>(
    check: string,
    run: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await run();
    } catch (error) {
      this._logger.warn(
        `[evaluate] Check could not tell - Check: ${check}, Error: ` +
          (error instanceof Error ? error.name : typeof error),
      );

      return null;
    }
  }

  /**
   * How long the oldest waiting job on a queue has waited, from when it was
   * queued: the oldest of the plain waiting list, which is its tail, and of
   * a bounded sample of the prioritised set, which only rescans use.
   *
   * @param name - The queue.
   * @param thresholdMinutes - How long it may wait.
   * @param now - The moment of the run.
   * @returns Whether it has waited too long, and how long.
   */
  private async checkQueueLag(
    name: string,
    thresholdMinutes: number,
    now: number,
  ): Promise<OperationsFinding> {
    const queue = this.queueOf(name);
    const [tail, prioritised] = await redisWithin(() =>
      Promise.all([
        queue.getWaiting(-1, -1),
        queue.getPrioritized(0, PRIORITISED_SAMPLE - 1),
      ]),
    );
    const queuedAt = [...tail, ...prioritised].map(job => job.timestamp);

    if (queuedAt.length === 0) {
      return { open: false };
    }

    const oldestMinutes = Math.floor((now - Math.min(...queuedAt)) / MINUTE_MS);

    return oldestMinutes > thresholdMinutes
      ? { open: true, detail: { oldestMinutes } }
      : { open: false };
  }

  /**
   * Judges the workers' heartbeats: silent, all paused too long, or holding
   * old signatures. A view that cannot be read counts as silent, and says
   * nothing of the other two.
   *
   * @returns What each of the three found.
   */
  private async checkWorkers(): Promise<{
    silent: OperationsFinding;
    paused: OperationsFinding;
    stale: OperationsFinding;
  }> {
    const workers = await this._diagnostics.readHeartbeats();

    if (workers === null) {
      return { silent: { open: true, detail: {} }, paused: null, stale: null };
    }

    const live = workers.filter(worker => worker.live);

    if (live.length === 0) {
      const quietest = workers.map(worker => worker.secondsSinceBeat);

      return {
        silent: {
          open: true,
          detail:
            quietest.length === 0
              ? { liveWorkers: 0 }
              : {
                  liveWorkers: 0,
                  minutesSinceBeat: Math.floor(Math.min(...quietest) / 60),
                },
        },
        paused: null,
        stale: null,
      };
    }

    const pausedMinutes = live.map(worker =>
      worker.state === 'PAUSED' ? (worker.pausedMinutes ?? 0) : -1,
    );
    const shortestPause = Math.min(...pausedMinutes);
    const ages = live
      .map(worker => worker.signatureAgeHours)
      .filter((age): age is number => age !== null);
    const newest = ages.length === 0 ? null : Math.min(...ages);

    return {
      silent: { open: false },
      paused:
        shortestPause >= WORKER_PAUSED_MINUTES
          ? {
              open: true,
              detail: {
                pausedWorkers: live.length,
                pausedMinutes: shortestPause,
              },
            }
          : { open: false },
      stale:
        newest !== null && newest > SIGNATURES_STALE_HOURS
          ? { open: true, detail: { signatureAgeHours: newest } }
          : { open: false },
    };
  }

  /**
   * Counts the failed jobs. One queue that cannot be counted leaves the
   * answer open unless another already has a failure.
   *
   * @returns Whether any job has failed, and how many.
   */
  private async checkFailedJobs(): Promise<OperationsFinding> {
    const counts = Object.values(await this._failedJobs.counts());
    const failed = counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);

    if (failed > 0) {
      return { open: true, detail: { failed } };
    }

    return counts.includes(null) ? null : { open: false };
  }

  /**
   * Judges how long publication has been paused. A pause whose start cannot
   * be read is judged long: only a fault leaves it so.
   *
   * @param now - The moment of the run.
   * @returns Whether it has been paused too long, and how long.
   */
  private async checkPauseLength(now: number): Promise<OperationsFinding> {
    const state = await this._publication.state();

    if (!state.paused) {
      return { open: false };
    }

    if (state.pausedAt === null) {
      return { open: true, detail: {} };
    }

    const pausedMinutes = Math.floor(
      (now - state.pausedAt.getTime()) / MINUTE_MS,
    );

    return pausedMinutes > PUBLICATION_PAUSED_LONG_MINUTES
      ? { open: true, detail: { pausedMinutes } }
      : { open: false };
  }

  /**
   * Judges the purges withdrawals left owed (FC-043).
   *
   * @returns Whether any has been owed too long, how many and how old.
   */
  private async checkOwedPurges(): Promise<OperationsFinding> {
    const { overdue, oldestHours } = await readOwedPurges(
      this._dataSource.manager,
      PURGE_OWED_HOURS,
    );

    return overdue > 0
      ? { open: true, detail: { overdue, oldestHours: oldestHours! } }
      : { open: false };
  }

  /**
   * Opens, touches or clears one alert, and tells the site admins when it
   * opens or clears.
   *
   * @param kind - The problem.
   * @param finding - What its check found.
   */
  private async settle(
    kind: OperationsAlertKind,
    finding: OperationsFinding,
  ): Promise<void> {
    if (finding === null) {
      return;
    }

    const alerts = this._dataSource
      .getRepository(OperationsAlertEntity)
      .createQueryBuilder();

    if (!finding.open) {
      const cleared = await alerts
        .update(OperationsAlertEntity)
        .set({ clearedAt: () => 'now()' })
        .where({ kind, clearedAt: IsNull() })
        .execute();

      if (cleared.affected) {
        this._logger.log(`[settle] Operations alert cleared - Kind: ${kind}`);
        await this.tell(kind, 'cleared');
      }

      return;
    }

    const opened = await alerts
      .insert()
      .into(OperationsAlertEntity)
      .values({ kind, detail: finding.detail })
      .orIgnore()
      .returning(['id'])
      .execute();

    if ((opened.raw as unknown[]).length > 0) {
      this._logger.warn(`[settle] Operations alert opened - Kind: ${kind}`);
      await this.tell(kind, 'opened');

      return;
    }

    await this._dataSource
      .getRepository(OperationsAlertEntity)
      .createQueryBuilder()
      .update(OperationsAlertEntity)
      .set({ lastSeenAt: () => 'now()', detail: finding.detail })
      .where({ kind, clearedAt: IsNull() })
      .execute();
  }

  /**
   * Tells every site admin in-app, reporting rather than throwing when one
   * notice cannot be written: the alert row records the problem either way.
   *
   * @param kind - The problem.
   * @param change - Whether it opened or cleared.
   */
  private async tell(
    kind: OperationsAlertKind,
    change: 'opened' | 'cleared',
  ): Promise<void> {
    const notice = OPERATIONS_ALERT_NOTICES[kind][change];
    const admins = await this._dataSource.manager.find(UserEntity, {
      where: { role: UserRole.ADMIN, disabledAt: IsNull() },
      select: { id: true },
    });

    for (const admin of admins) {
      try {
        await this._notifications.createNotification({
          target: NotificationTarget.USER,
          userId: admin.id,
          severity:
            change === 'opened'
              ? NotificationSeverity.WARNING
              : NotificationSeverity.INFO,
          title: notice.title,
          body: notice.body,
          linkUrl: SCAN_DIAGNOSTICS_LINK,
        });
      } catch {
        this._logger.warn(`[tell] Notice not sent - UserId: ${admin.id}`);
      }
    }
  }
}
