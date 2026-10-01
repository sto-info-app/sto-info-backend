import { getQueueToken } from '@nestjs/bullmq';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';

import { Job, Queue } from 'bullmq';
import { DataSource } from 'typeorm';

import { SiteAdminActionKind } from 'src/audit/site-admin/site-admin-action.enum';
import { recordSiteAdminAction } from 'src/audit/site-admin/site-admin-action.utility';
import { FILE_ASSET_PUBLICATION_QUEUE } from 'src/file-assets/constants/file-asset-publication.constants';
import { FileAssetPlacementEntity } from 'src/file-assets/entities/file-asset-placement.entity';
import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetPlacementState } from 'src/file-assets/enums/file-asset-placement-state.enum';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import {
  FILE_SCAN_REQUEST_QUEUE,
  FILE_SCAN_VERDICT_QUEUE,
} from 'src/file-scanning/contract/file-scan-contract';
import { FileRescanEntity } from 'src/file-scanning/rescan/file-rescan.entity';
import { RescanState } from 'src/file-scanning/rescan/rescan.enums';
import { recordDiagnosticsRead } from 'src/file-scanning/services/diagnostics-read.utility';
import { ChatTranscriptEntity } from 'src/fleet/chat/entities/chat-transcript.entity';
import { ChatTranscriptStatus } from 'src/fleet/chat/enums/chat.enums';
import { CHAT_TRANSCRIPT_QUEUE } from 'src/fleet/chat/transcripts/chat-transcript.constants';
import { RosterProjectionEntity } from 'src/fleet/projection/entities/roster-projection.entity';
import {
  RedisTimeoutError,
  redisWithin,
} from 'src/shared/queue/redis-within.utility';

import {
  FAILED_JOB_PAGE_SIZE,
  FAILED_JOB_QUEUES,
  FAILED_JOB_RETRY_ALL_LIMIT,
  FailedJobQueue,
  NETWORK_FAILURE_CODES,
} from './failed-job.constants';
import {
  DiscardQueueResultDto,
  DiscardUnretryableResultDto,
  FailedJobDto,
  FailedJobPageDto,
  RetryAllQueueResultDto,
  RetryAllResultDto,
} from './failed-jobs.dto';

/** Why retrying a job would change nothing. */
interface RetryRefusal {
  /** `SETTLED` or `NO_SUBJECT`. */
  readonly code: 'SETTLED' | 'NO_SUBJECT';
  /** What the site admin is told. */
  readonly message: string;
}

/** What a job was for. */
interface JobSubject {
  readonly kind: string;
  readonly id: string;
}

/** A retry refused because the job names nothing to act on. */
const NO_SUBJECT: RetryRefusal = {
  code: 'NO_SUBJECT',
  message: 'That job names nothing to act on, so retrying it would do nothing.',
};

/** What a site admin is told while Redis does not answer. */
const UNREACHABLE = 'The job queues cannot be reached.';

/** The error class name a stack trace begins with. */
const ERROR_NAME = /^([A-Za-z_$][\w$]{0,59}):/;

/** A network error's code, anywhere in a failure reason. */
const NETWORK_CODE = new RegExp(`\\b(${NETWORK_FAILURE_CODES.join('|')})\\b`);

/** An HTTP status, as the Cloudflare and S3 clients word it. */
const HTTP_STATUS = /\bstatus(?: code)? (\d{3})\b/i;

/**
 * The failed jobs of every queue that keeps them, and a site admin's retry
 * of them (FC-042), on Scan Diagnostics.
 *
 * Steve's decision of 30 September 2026: an ADMIN "Retry" and "Retry all",
 * each with a reason in the site admin log. A retry is only sent when it can
 * change something. Every job here is read against the record it was for
 * when it runs, so a retried job whose record has since moved on — an
 * upload refused, published or swept, a transcript given up on, a roster
 * already replayed — would do nothing; such a retry is refused with the
 * reason, rather than sent round to no effect:
 *
 * - **`file-scan`**: an upload's request, while its asset is still
 *   `SCANNING` the same object; a rescan's, while the rescan is still
 *   `REQUESTED`. The worker is idempotent: a request whose attempt has
 *   finished repeats its verdict, and one whose retry budget is spent
 *   answers `RETRY_BUDGET_EXHAUSTED`, so a retry always ends in a verdict.
 * - **`file-scan-verdict`**: the same test, since a verdict only moves an
 *   asset that is still `SCANNING`, or a rescan that is still `REQUESTED`.
 * - **`file-asset-publication`**: while the asset is `CLEAN` or `AVAILABLE`
 *   and its placement still `PENDING` — or `HELD`, while `CLEAN`, which asks
 *   the owning feature again. While publication is paused, a retried job
 *   waits with the rest.
 * - **`chat-transcript`**: while the transcript is still `PENDING`; the
 *   sweep gives up on one after an hour.
 * - **`fleet-roster-replay`**: while the Fleet's projection is behind; the
 *   ten-minute sweep queues a fresh replay anyway.
 *
 * A retried job gets its attempts back. A site admin may also discard a
 * failed job — any one singly, or every one a retry cannot help at once —
 * which removes it from its queue, so that `FAILED_JOBS` can clear once
 * nothing is left worth retrying. Queues are found through the module
 * graph rather than registered again here, so this opens no connections of
 * its own. A job's data is never shown and its error's text never leaves
 * this process: only IDs and a reduced code.
 */
@Injectable()
export class FailedJobsService {
  private readonly _logger = new Logger(FailedJobsService.name);

  /**
   * Creates an instance of FailedJobsService.
   *
   * @param _dataSource - The database, for what each job was for and the
   *   site admin log.
   * @param _modules - Where each queue is found.
   */
  constructor(
    @InjectDataSource() private readonly _dataSource: DataSource,
    private readonly _modules: ModuleRef,
  ) {}

  /**
   * How many failed jobs each queue holds.
   *
   * Every queue is asked at once, and each is given
   * {@link REDIS_TIMEOUT_MS} to answer, so a Redis that is down costs one
   * wait rather than one per queue (FC-042).
   *
   * @param queues - Which queues.
   * @returns A count for each, or null for one Redis did not answer for.
   */
  async counts(
    queues: readonly FailedJobQueue[] = FAILED_JOB_QUEUES,
  ): Promise<Record<string, number | null>> {
    const answers = await Promise.all(
      queues.map(async name => {
        try {
          return await redisWithin(() => this.queueOf(name).getFailedCount());
        } catch (error) {
          this.warn('counts', error);

          return null;
        }
      }),
    );

    return Object.fromEntries(queues.map((name, n) => [name, answers[n]]));
  }

  /**
   * A page of failed jobs. A page after the first, or of one queue, is
   * logged as read; the first page of every queue is read with the
   * diagnostics, whose entry covers it.
   *
   * Queue by queue in a fixed order, newest failure first within each, so a
   * page is two ranges at most and nothing is loaded that is not shown.
   *
   * @param queue - One queue only, or every one.
   * @param page - Which page, from 1.
   * @param adminUserId - The site admin reading them.
   * @returns The page.
   * @throws ServiceUnavailableException when no queue asked for answers, or
   *   Redis stops answering part way: an empty list would read as "nothing
   *   has failed".
   */
  async list(
    queue: FailedJobQueue | undefined,
    page: number,
    adminUserId: string,
  ): Promise<FailedJobPageDto> {
    const names = queue === undefined ? FAILED_JOB_QUEUES : [queue];
    const counts = await this.counts(names);

    if (Object.values(counts).every(count => count === null)) {
      throw new ServiceUnavailableException(UNREACHABLE);
    }

    const items: FailedJobDto[] = [];
    let skip = (page - 1) * FAILED_JOB_PAGE_SIZE;

    for (const name of names) {
      const count = counts[name] ?? 0;

      if (skip >= count) {
        skip -= count;
        continue;
      }

      const take = Math.min(FAILED_JOB_PAGE_SIZE - items.length, count - skip);
      const jobs = await this.reach(() =>
        this.queueOf(name).getFailed(skip, skip + take - 1),
      );

      skip = 0;

      for (const job of jobs) {
        items.push(await this.describe(name, job));
      }

      if (items.length >= FAILED_JOB_PAGE_SIZE) {
        break;
      }
    }

    // One entry per page view: Scan Diagnostics reads the first page of
    // every queue with the diagnostics whenever it opens, and that read is
    // logged there. A later page, or one queue chosen, is a read of its own.
    if (page > 1 || queue !== undefined) {
      await recordDiagnosticsRead(
        this._dataSource.manager,
        adminUserId,
        'FAILED_JOBS',
        null,
        queue === undefined ? { page } : { page, queue },
      );
    }

    return {
      items,
      total: Object.values(counts).reduce<number>(
        (sum, count) => sum + (count ?? 0),
        0,
      ),
      page,
      pageSize: FAILED_JOB_PAGE_SIZE,
      counts,
    };
  }

  /**
   * Retries one failed job, logged with the site admin's reason.
   *
   * @param queue - Its queue.
   * @param jobId - The job.
   * @param adminUserId - The site admin.
   * @param reason - Why.
   * @throws NotFoundException when the queue holds no such job.
   * @throws ConflictException when it has not failed, a retry would change
   *   nothing, or it was retried by somebody else first.
   * @throws ServiceUnavailableException when Redis cannot be reached.
   */
  async retry(
    queue: FailedJobQueue,
    jobId: string,
    adminUserId: string,
    reason: string,
  ): Promise<void> {
    const job = await this.failedJob(queue, jobId, 'retry');
    const refusal = await this.refusalOf(queue, job);

    if (refusal !== null) {
      throw new ConflictException(refusal.message);
    }

    const attemptsMade = job.attemptsMade;

    if (!(await this.send(job))) {
      throw new ConflictException(
        'That job could not be retried; somebody may have retried it already.',
      );
    }

    await recordSiteAdminAction(this._dataSource.manager, {
      action: SiteAdminActionKind.SCAN_JOB_RETRIED,
      actorUserId: adminUserId,
      subject: { kind: queue, id: jobId },
      reason,
      detail: { attemptsMade },
    });

    this._logger.log(
      `[retry] Failed job retried - Queue: ${queue}, JobId: ${jobId}, ` +
        `AdminId: ${adminUserId}`,
    );
  }

  /**
   * Removes one failed job from its queue, logged with the site admin's
   * reason. Any failed job may be discarded, whether or not a retry could
   * help it: the site admin has decided it is not worth sending round.
   *
   * @param queue - Its queue.
   * @param jobId - The job.
   * @param adminUserId - The site admin.
   * @param reason - Why.
   * @throws NotFoundException when the queue holds no such job.
   * @throws ConflictException when it has not failed, or was retried or
   *   discarded by somebody else first.
   * @throws ServiceUnavailableException when Redis cannot be reached.
   */
  async discard(
    queue: FailedJobQueue,
    jobId: string,
    adminUserId: string,
    reason: string,
  ): Promise<void> {
    const job = await this.failedJob(queue, jobId, 'discard');
    const refusal = await this.refusalOf(queue, job);

    if (!(await this.drop(job))) {
      throw new ConflictException(
        'That job could not be discarded; somebody may have retried or ' +
          'discarded it already.',
      );
    }

    await recordSiteAdminAction(this._dataSource.manager, {
      action: SiteAdminActionKind.SCAN_JOB_DISCARDED,
      actorUserId: adminUserId,
      subject: { kind: queue, id: jobId },
      reason,
      detail: {
        attemptsMade: job.attemptsMade,
        retryable: refusal === null,
      },
    });

    this._logger.log(
      `[discard] Failed job discarded - Queue: ${queue}, JobId: ${jobId}, ` +
        `AdminId: ${adminUserId}`,
    );
  }

  /**
   * Retries every failed job a retry can help, in one queue or all of
   * them, up to {@link FAILED_JOB_RETRY_ALL_LIMIT}; logged once, with the
   * counts.
   *
   * @param queue - One queue only, or every one.
   * @param adminUserId - The site admin.
   * @param reason - Why.
   * @returns What was retried and what was left alone.
   * @throws ServiceUnavailableException when Redis cannot be reached.
   */
  async retryAll(
    queue: FailedJobQueue | undefined,
    adminUserId: string,
    reason: string,
  ): Promise<RetryAllResultDto> {
    const swept = await this.sweep(
      queue,
      async (name, job) =>
        (await this.refusalOf(name, job)) === null && (await this.send(job)),
    );
    const byQueue: Record<string, RetryAllQueueResultDto> = {};

    for (const [name, counts] of Object.entries(swept.byQueue)) {
      byQueue[name] = { retried: counts.acted, skipped: counts.left };
    }

    const retried = swept.acted;
    const skipped = swept.left;

    await recordSiteAdminAction(this._dataSource.manager, {
      action: SiteAdminActionKind.SCAN_JOB_RETRIED,
      actorUserId: adminUserId,
      subject: { kind: queue ?? 'ALL', id: 'ALL' },
      reason,
      detail: {
        retried,
        skipped,
        byQueue,
        ...(swept.interrupted ? { interrupted: true } : {}),
      },
    });
    this.throwIfInterrupted(swept.interrupted);

    this._logger.log(
      `[retryAll] Failed jobs retried - Queue: ${queue ?? 'ALL'}, ` +
        `Retried: ${retried}, Skipped: ${skipped}, AdminId: ${adminUserId}`,
    );

    return { retried, skipped, remaining: swept.remaining, byQueue };
  }

  /**
   * Removes every failed job a retry cannot help, in one queue or all of
   * them, up to {@link FAILED_JOB_RETRY_ALL_LIMIT}; logged once, with the
   * counts. A job a retry could still help is kept.
   *
   * @param queue - One queue only, or every one.
   * @param adminUserId - The site admin.
   * @param reason - Why.
   * @returns What was discarded and what was kept.
   * @throws ServiceUnavailableException when Redis cannot be reached.
   */
  async discardUnretryable(
    queue: FailedJobQueue | undefined,
    adminUserId: string,
    reason: string,
  ): Promise<DiscardUnretryableResultDto> {
    const swept = await this.sweep(
      queue,
      async (name, job) =>
        (await this.refusalOf(name, job)) !== null && (await this.drop(job)),
    );
    const byQueue: Record<string, DiscardQueueResultDto> = {};

    for (const [name, counts] of Object.entries(swept.byQueue)) {
      byQueue[name] = { discarded: counts.acted, kept: counts.left };
    }

    const discarded = swept.acted;
    const kept = swept.left;

    await recordSiteAdminAction(this._dataSource.manager, {
      action: SiteAdminActionKind.SCAN_JOB_DISCARDED,
      actorUserId: adminUserId,
      subject: { kind: queue ?? 'ALL', id: 'ALL' },
      reason,
      detail: {
        discarded,
        kept,
        byQueue,
        ...(swept.interrupted ? { interrupted: true } : {}),
      },
    });
    this.throwIfInterrupted(swept.interrupted);

    this._logger.log(
      `[discardUnretryable] Failed jobs discarded - Queue: ` +
        `${queue ?? 'ALL'}, Discarded: ${discarded}, Kept: ${kept}, ` +
        `AdminId: ${adminUserId}`,
    );

    return { discarded, kept, remaining: swept.remaining, byQueue };
  }

  /**
   * Finds a failed job for a site admin to act on.
   *
   * @param queue - Its queue.
   * @param jobId - The job.
   * @param verb - What is to be done to it, for the message.
   * @returns The job.
   * @throws NotFoundException when the queue holds no such job.
   * @throws ConflictException when it has not failed.
   * @throws ServiceUnavailableException when Redis cannot be reached.
   */
  private async failedJob(
    queue: FailedJobQueue,
    jobId: string,
    verb: 'retry' | 'discard',
  ): Promise<Job> {
    const job = await this.reach(() => this.queueOf(queue).getJob(jobId));

    if (job === undefined) {
      throw new NotFoundException('There is no such job.');
    }

    const state = await this.reach(() => job.getState());

    if (state !== 'failed') {
      throw new ConflictException(
        `That job has not failed; it is ${state}, so there is nothing to ${verb}.`,
      );
    }

    return job;
  }

  /**
   * Looks at up to {@link FAILED_JOB_RETRY_ALL_LIMIT} failed jobs, in one
   * queue or all of them, and acts on each the caller chooses.
   *
   * Redis that stops answering part way stops the sweep: what was done is
   * returned, marked interrupted, for the caller to log before saying so.
   * One that does not answer at all, before anything was done, is a 503.
   *
   * @param queue - One queue only, or every one.
   * @param act - Acts on one job, answering whether it did.
   * @returns How many were acted on and left, overall and queue by queue,
   *   how many failed jobs remain (or null when a queue cannot be counted),
   *   and whether Redis stopped answering part way.
   * @throws ServiceUnavailableException when Redis cannot be reached at all.
   */
  private async sweep(
    queue: FailedJobQueue | undefined,
    act: (queue: FailedJobQueue, job: Job) => Promise<boolean>,
  ): Promise<{
    acted: number;
    left: number;
    remaining: number | null;
    byQueue: Record<string, { acted: number; left: number }>;
    interrupted: boolean;
  }> {
    const names = queue === undefined ? FAILED_JOB_QUEUES : [queue];
    const byQueue: Record<string, { acted: number; left: number }> = {};
    let examined = 0;
    let interrupted = false;

    for (const name of names) {
      const result = { acted: 0, left: 0 };

      byQueue[name] = result;

      if (interrupted || examined >= FAILED_JOB_RETRY_ALL_LIMIT) {
        continue;
      }

      try {
        const jobs = await this.reach(() =>
          this.queueOf(name).getFailed(
            0,
            FAILED_JOB_RETRY_ALL_LIMIT - examined - 1,
          ),
        );

        examined += jobs.length;

        for (const job of jobs) {
          result[(await act(name, job)) ? 'acted' : 'left'] += 1;
        }
      } catch (error) {
        if (!(error instanceof ServiceUnavailableException)) {
          throw error;
        }

        interrupted = true;
      }
    }

    const results = Object.values(byQueue);
    const acted = results.reduce((sum, result) => sum + result.acted, 0);
    const left = results.reduce((sum, result) => sum + result.left, 0);

    if (interrupted && acted + left === 0) {
      throw new ServiceUnavailableException(UNREACHABLE);
    }

    const after = Object.values(await this.counts(names));

    return {
      acted,
      left,
      remaining: after.includes(null)
        ? null
        : after.reduce<number>((sum, count) => sum + (count as number), 0),
      byQueue,
      interrupted,
    };
  }

  /**
   * Says Redis stopped answering part way through a sweep, once what was
   * done has been logged.
   *
   * @param interrupted - Whether it did.
   * @throws ServiceUnavailableException when it did.
   */
  private throwIfInterrupted(interrupted: boolean): void {
    if (interrupted) {
      throw new ServiceUnavailableException(
        'The job queues stopped answering part way; what was done has been ' +
          'logged in the Security Log.',
      );
    }
  }

  /**
   * Describes one failed job, and whether retrying it could help.
   *
   * @param queue - Its queue.
   * @param job - The job.
   * @returns What the page shows.
   */
  private async describe(
    queue: FailedJobQueue,
    job: Job,
  ): Promise<FailedJobDto> {
    const subject = subjectOf(queue, job);
    const refusal = await this.refusalOf(queue, job);

    return {
      queue,
      jobId: String(job.id),
      name: job.name,
      attemptsMade: job.attemptsMade,
      failedAt: job.finishedOn === undefined ? null : new Date(job.finishedOn),
      subjectKind: subject?.kind ?? null,
      subjectId: subject?.id ?? null,
      reason: failureCodeOf(job),
      retryable: refusal === null,
      notRetryableBecause: refusal?.code ?? null,
    };
  }

  /**
   * Why retrying a job would change nothing, judged against the record it
   * was for as that record stands now.
   *
   * @param queue - Its queue.
   * @param job - The job.
   * @returns Why not, or null when a retry can help.
   */
  private async refusalOf(
    queue: FailedJobQueue,
    job: Job,
  ): Promise<RetryRefusal | null> {
    switch (queue) {
      case FILE_SCAN_REQUEST_QUEUE:
        return this.scanRefusal(job);
      case FILE_SCAN_VERDICT_QUEUE:
        return this.verdictRefusal(job);
      case FILE_ASSET_PUBLICATION_QUEUE:
        return this.publicationRefusal(job);
      case CHAT_TRANSCRIPT_QUEUE:
        return this.transcriptRefusal(job);
      default:
        return this.replayRefusal(job);
    }
  }

  /**
   * A scan request can help while its upload is still being scanned, or
   * its rescan still waits for a verdict.
   *
   * @param job - The job.
   * @returns Why not, or null.
   */
  private async scanRefusal(job: Job): Promise<RetryRefusal | null> {
    const jobId = String(job.id);

    if (jobId.startsWith('rescan_')) {
      const rescan = await this._dataSource.manager.findOne(FileRescanEntity, {
        where: { id: jobId.slice('rescan_'.length) },
      });

      return rescanRefusal(rescan);
    }

    return this.uploadRefusal(job);
  }

  /**
   * A verdict can help while the rescan it answers still waits, or the
   * upload it answers is still being scanned.
   *
   * @param job - The job.
   * @returns Why not, or null.
   */
  private async verdictRefusal(job: Job): Promise<RetryRefusal | null> {
    const assetId = textIn(job.data, 'assetId');
    const objectKey = textIn(job.data, 'objectKey');

    if (assetId === null || objectKey === null) {
      return NO_SUBJECT;
    }

    const rescan = await this._dataSource.manager.findOne(FileRescanEntity, {
      where: { assetId, stagingKey: objectKey },
    });

    return rescan === null ? this.uploadRefusal(job) : rescanRefusal(rescan);
  }

  /**
   * An upload's scan request or verdict can help while the asset is still
   * `SCANNING` the object the job names.
   *
   * @param job - The job.
   * @returns Why not, or null.
   */
  private async uploadRefusal(job: Job): Promise<RetryRefusal | null> {
    const assetId = textIn(job.data, 'assetId');

    if (assetId === null) {
      return NO_SUBJECT;
    }

    const asset = await this._dataSource.manager.findOne(FileAssetEntity, {
      where: { id: assetId },
    });

    if (
      asset?.state === FileAssetState.SCANNING &&
      asset.objectKey === textIn(job.data, 'objectKey')
    ) {
      return null;
    }

    return {
      code: 'SETTLED',
      message:
        `That upload is no longer waiting for a scan (it is ` +
        `${asset?.state ?? 'gone'}), so retrying would change nothing.`,
    };
  }

  /**
   * A publication can help while the asset is cleared and its placement is
   * still waiting for it.
   *
   * @param job - The job.
   * @returns Why not, or null.
   */
  private async publicationRefusal(job: Job): Promise<RetryRefusal | null> {
    const assetId = textIn(job.data, 'assetId');

    if (assetId === null) {
      return NO_SUBJECT;
    }

    const manager = this._dataSource.manager;
    const asset = await manager.findOne(FileAssetEntity, {
      where: { id: assetId },
    });
    const placement = await manager.findOne(FileAssetPlacementEntity, {
      where: { assetId },
    });
    const clean = asset?.state === FileAssetState.CLEAN;
    const published = asset?.state === FileAssetState.AVAILABLE;

    if (
      (clean || published) &&
      (placement?.state === FileAssetPlacementState.PENDING ||
        (clean && placement?.state === FileAssetPlacementState.HELD))
    ) {
      return null;
    }

    return {
      code: 'SETTLED',
      message:
        `That upload is no longer waiting to be published (it is ` +
        `${asset?.state ?? 'gone'}), so retrying would change nothing.`,
    };
  }

  /**
   * A transcript can help while it is still waiting to be written.
   *
   * @param job - The job.
   * @returns Why not, or null.
   */
  private async transcriptRefusal(job: Job): Promise<RetryRefusal | null> {
    const transcriptId = textIn(job.data, 'transcriptId');

    if (transcriptId === null) {
      return NO_SUBJECT;
    }

    const transcript = await this._dataSource.manager.findOne(
      ChatTranscriptEntity,
      { where: { id: transcriptId } },
    );

    return transcript?.status === ChatTranscriptStatus.PENDING
      ? null
      : {
          code: 'SETTLED',
          message:
            'That transcript is no longer waiting to be written; whoever ' +
            'asked for it can ask again.',
        };
  }

  /**
   * A replay can help while the Fleet's roster is behind its evidence.
   *
   * @param job - The job.
   * @returns Why not, or null.
   */
  private async replayRefusal(job: Job): Promise<RetryRefusal | null> {
    const fleetId = textIn(job.data, 'fleetId');

    if (fleetId === null) {
      return NO_SUBJECT;
    }

    const projection = await this._dataSource.manager.findOne(
      RosterProjectionEntity,
      { where: { fleetId } },
    );

    return projection !== null && projection.built < projection.requested
      ? null
      : {
          code: 'SETTLED',
          message:
            'That Fleet’s roster is already up to date, so a replay would ' +
            'change nothing.',
        };
  }

  /**
   * Sends a failed job round again with its attempts back.
   *
   * @param job - The job.
   * @returns False when it could not be: it was no longer failed, or was
   *   held by somebody else's retry.
   * @throws ServiceUnavailableException when Redis does not answer in time.
   */
  private async send(job: Job): Promise<boolean> {
    return this.command('send', () =>
      job.retry('failed', {
        resetAttemptsMade: true,
        resetAttemptsStarted: true,
      }),
    );
  }

  /**
   * Removes a failed job from its queue.
   *
   * @param job - The job.
   * @returns False when it could not be: it was no longer there, or was
   *   held by somebody else's retry.
   * @throws ServiceUnavailableException when Redis does not answer in time.
   */
  private async drop(job: Job): Promise<boolean> {
    return this.command('drop', () => job.remove());
  }

  /**
   * Runs one command against a job, telling a refusal (somebody got there
   * first) from a Redis that does not answer.
   *
   * @param source - The method, for the log.
   * @param run - The command.
   * @returns True when it ran; false when BullMQ refused it.
   * @throws ServiceUnavailableException when Redis does not answer in time.
   */
  private async command(
    source: string,
    run: () => Promise<void>,
  ): Promise<boolean> {
    try {
      await redisWithin(run);

      return true;
    } catch (error) {
      this.warn(source, error);

      if (error instanceof RedisTimeoutError) {
        throw new ServiceUnavailableException(UNREACHABLE);
      }

      return false;
    }
  }

  /**
   * Finds a queue this application registers, without registering it again.
   *
   * @param name - The queue.
   * @returns It.
   */
  private queueOf(name: FailedJobQueue): Queue {
    return this._modules.get<Queue>(getQueueToken(name), { strict: false });
  }

  /**
   * Asks Redis for something, giving it {@link REDIS_TIMEOUT_MS}, and
   * turning a failure or a silence into a 503.
   *
   * @param ask - The question.
   * @returns The answer.
   * @throws ServiceUnavailableException when Redis cannot be reached.
   */
  private async reach<T>(ask: () => Promise<T>): Promise<T> {
    try {
      return await redisWithin(ask);
    } catch (error) {
      this.warn('reach', error);

      throw new ServiceUnavailableException(UNREACHABLE);
    }
  }

  /**
   * Logs a failure without its message, which can name a host.
   *
   * @param source - The method that failed.
   * @param error - What it threw.
   */
  private warn(source: string, error: unknown): void {
    this._logger.warn(
      `[${source}] Queue unavailable - Error: ` +
        (error instanceof Error ? error.name : typeof error),
    );
  }
}

/**
 * Reads one text field out of a job's data.
 *
 * @param data - The data.
 * @param field - The field.
 * @returns Its value, or null when it is missing or not text.
 */
function textIn(data: unknown, field: string): string | null {
  const value =
    typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>)[field]
      : undefined;

  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Whether a rescan still waits for a verdict.
 *
 * @param rescan - The rescan, or null when there is none.
 * @returns Why a retry would not help, or null.
 */
function rescanRefusal(rescan: FileRescanEntity | null): RetryRefusal | null {
  return rescan?.state === RescanState.REQUESTED
    ? null
    : {
        code: 'SETTLED',
        message:
          'That rescan is no longer waiting for a verdict, so retrying ' +
          'would change nothing; a later campaign can rescan the picture.',
      };
}

/**
 * What a job was for: an internal ID, and what kind of record it names.
 *
 * @param queue - Its queue.
 * @param job - The job.
 * @returns Its subject, or null when its data names none.
 */
function subjectOf(queue: FailedJobQueue, job: Job): JobSubject | null {
  const [kind, field] =
    queue === CHAT_TRANSCRIPT_QUEUE
      ? ['CHAT_TRANSCRIPT', 'transcriptId']
      : queue === FILE_SCAN_REQUEST_QUEUE ||
          queue === FILE_SCAN_VERDICT_QUEUE ||
          queue === FILE_ASSET_PUBLICATION_QUEUE
        ? ['FILE_ASSET', 'assetId']
        : ['FLEET', 'fleetId'];
  const id = textIn(job.data, field);

  return id === null ? null : { kind, id };
}

/**
 * Reduces why a job failed to a code, since the text of an error can quote a
 * statement's values, a file's name or a host: a network error's code, an
 * HTTP status, a time-out or a stall, or else the name of the error class
 * that was thrown.
 *
 * @param job - The job.
 * @returns The code.
 */
export function failureCodeOf(job: Job): string {
  const reason = job.failedReason ?? '';

  if (/stalled/i.test(reason)) {
    return 'STALLED';
  }

  const network = NETWORK_CODE.exec(reason);

  if (network !== null) {
    return network[1];
  }

  const status = HTTP_STATUS.exec(reason);

  if (status !== null) {
    return `HTTP_${status[1]}`;
  }

  if (/time(?:d)? ?out/i.test(reason)) {
    return 'TIMEOUT';
  }

  const traces = job.stacktrace ?? [];
  const top = traces[traces.length - 1]?.split('\n')[0] ?? '';

  return ERROR_NAME.exec(top)?.[1] ?? 'UNKNOWN';
}
