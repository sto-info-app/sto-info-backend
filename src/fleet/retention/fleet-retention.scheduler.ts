import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { CRON_TIMEZONE } from 'src/cron/constants/cron.constants';

import { ActivityFeedService } from '../activity/services/activity-feed.service';
import { ModerationHoldService } from '../chat/holds/moderation-hold.service';
import { ChatReportService } from '../chat/reporting/chat-report.service';
import { ChatMessageService } from '../chat/services/chat-message.service';
import { ChatTranscriptService } from '../chat/transcripts/chat-transcript.service';
import { RosterSourceRetentionService } from '../imports/services/roster-source-retention.service';
import { ScopeNewsService } from '../news/services/scope-news.service';
import { CharacterFleetMembershipService } from '../services/character-fleet-membership.service';
import { RetentionJob } from './retention-job.enum';
import { RetentionOutcome, RetentionRunService } from './retention-run.service';

/**
 * The most rounds the restore check gives one job, as a guard against a job
 * that never says it is complete: at 40 batches of 500 a round, 20 million
 * rows.
 */
export const CATCH_UP_MAX_ROUNDS = 1_000;

/** What catching up came to: by job, what each forgot, by kind. */
export type RetentionCatchUp = Readonly<
  Record<string, Readonly<Record<string, number>>>
>;

/**
 * When each of the Fleet's retention jobs runs, all UTC (FC-037).
 *
 * Each job is its owning service's, bounded to a number of batches per run,
 * and recorded here through {@link RetentionRunService}; whatever a run
 * leaves is still due, so the next carries on. None of them asks whether
 * the Fleet feature is on: retention is owed whether or not anybody can see
 * the feature, and FleetFeatureService says jobs like these must never ask.
 */
@Injectable()
export class FleetRetentionScheduler {
  /**
   * Creates an instance of FleetRetentionScheduler.
   *
   * @param _runs - Records each run.
   * @param _sources - Expires sanitised roster files.
   * @param _news - Forgets deleted scoped news posts.
   * @param _memberships - Forgets retracted Character Fleet memberships.
   * @param _messages - Forgets old chat messages.
   * @param _reports - Forgets old closed chat reports.
   * @param _transcripts - Deletes expired transcripts.
   * @param _activity - Forgets old activity.
   * @param _holds - Reviews holds past their date.
   */
  constructor(
    private readonly _runs: RetentionRunService,
    private readonly _sources: RosterSourceRetentionService,
    private readonly _news: ScopeNewsService,
    private readonly _memberships: CharacterFleetMembershipService,
    private readonly _messages: ChatMessageService,
    private readonly _reports: ChatReportService,
    private readonly _transcripts: ChatTranscriptService,
    private readonly _activity: ActivityFeedService,
    private readonly _holds: ModerationHoldService,
  ) {}

  /**
   * Expires sanitised roster files 180 days after upload. Daily.
   *
   * @returns What the run did, or null when it failed.
   */
  @Cron('11 4 * * *', { timeZone: CRON_TIMEZONE })
  rosterSources(): Promise<RetentionOutcome | null> {
    return this._runs.record(RetentionJob.ROSTER_SOURCES, () =>
      this._sources.expire(),
    );
  }

  /**
   * Forgets scoped news posts deleted 30 days ago. Daily.
   *
   * @returns What the run did, or null when it failed.
   */
  @Cron('5 4 * * *', { timeZone: CRON_TIMEZONE })
  newsPosts(): Promise<RetentionOutcome | null> {
    return this._runs.record(RetentionJob.NEWS_POSTS, () =>
      this._news.purgeDeleted(),
    );
  }

  /**
   * Forgets Character Fleet memberships retracted 30 days ago. Daily.
   *
   * @returns What the run did, or null when it failed.
   */
  @Cron('7 4 * * *', { timeZone: CRON_TIMEZONE })
  characterFleetMemberships(): Promise<RetentionOutcome | null> {
    return this._runs.record(RetentionJob.CHARACTER_FLEET_MEMBERSHIPS, () =>
      this._memberships.purgeRetracted(),
    );
  }

  /**
   * Forgets chat messages past the retention period. Daily.
   *
   * @returns What the run did, or null when it failed.
   */
  @Cron('23 4 * * *', { timeZone: CRON_TIMEZONE })
  chatMessages(): Promise<RetentionOutcome | null> {
    return this._runs.record(RetentionJob.CHAT_MESSAGES, () =>
      this._messages.purge(),
    );
  }

  /**
   * Forgets chat reports closed 90 days ago. Daily.
   *
   * @returns What the run did, or null when it failed.
   */
  @Cron('41 4 * * *', { timeZone: CRON_TIMEZONE })
  chatReports(): Promise<RetentionOutcome | null> {
    return this._runs.record(RetentionJob.CHAT_REPORTS, () =>
      this._reports.purge(),
    );
  }

  /**
   * Deletes expired transcripts. Hourly, since each lasts 24 hours.
   *
   * @returns What the run did, or null when it failed.
   */
  @Cron(CronExpression.EVERY_HOUR, { timeZone: CRON_TIMEZONE })
  chatTranscripts(): Promise<RetentionOutcome | null> {
    return this._runs.record(RetentionJob.CHAT_TRANSCRIPTS, () =>
      this._transcripts.sweep(),
    );
  }

  /**
   * Forgets activity older than twelve months. Daily.
   *
   * @returns What the run did, or null when it failed.
   */
  @Cron('41 3 * * *', { timeZone: CRON_TIMEZONE })
  activity(): Promise<RetentionOutcome | null> {
    return this._runs.record(RetentionJob.ACTIVITY, () =>
      this._activity.purge(),
    );
  }

  /**
   * Tells, warns and releases holds past their review date. Daily.
   *
   * @returns What the run did, or null when it failed.
   */
  @Cron('3 5 * * *', { timeZone: CRON_TIMEZONE })
  moderationHolds(): Promise<RetentionOutcome | null> {
    return this._runs.record(RetentionJob.MODERATION_HOLDS, () =>
      this._holds.review(),
    );
  }

  /**
   * Runs every job that forgets by age until nothing due is left (FC-043).
   *
   * The restore check calls this at boot, after the ledgers: a database
   * restored from an older backup holds again what the daily jobs had
   * forgotten since — old chat messages, roster files, transcripts — and
   * Steve's decision of 1 October 2026 is that none of it may be readable,
   * not even for the day until the next run. Holds come back from their
   * ledger first, so a message under hold is still kept.
   *
   * Each job runs, and is recorded, as on its schedule, round after round
   * until it says it is complete. Reviewing holds and pruning this record
   * forget nothing a restore could bring back, so they are left to their
   * schedules.
   *
   * @returns What each job deleted.
   * @throws Error when a job fails, or never finishes; the restore check
   *   waits and tries again, and the API does not start meanwhile.
   */
  async catchUp(): Promise<RetentionCatchUp> {
    const jobs: Array<[RetentionJob, () => Promise<RetentionOutcome | null>]> =
      [
        [RetentionJob.ROSTER_SOURCES, () => this.rosterSources()],
        [RetentionJob.NEWS_POSTS, () => this.newsPosts()],
        [
          RetentionJob.CHARACTER_FLEET_MEMBERSHIPS,
          () => this.characterFleetMemberships(),
        ],
        [RetentionJob.CHAT_MESSAGES, () => this.chatMessages()],
        [RetentionJob.CHAT_REPORTS, () => this.chatReports()],
        [RetentionJob.CHAT_TRANSCRIPTS, () => this.chatTranscripts()],
        [RetentionJob.ACTIVITY, () => this.activity()],
      ];
    const caught: Record<string, Record<string, number>> = {};

    for (const [job, run] of jobs) {
      const totals: Record<string, number> = {};

      for (let round = 1; ; round++) {
        const outcome = await run();

        if (outcome === null) {
          throw new Error(`Retention job ${job} failed while catching up`);
        }

        for (const [kind, count] of Object.entries(outcome.counts)) {
          totals[kind] = (totals[kind] ?? 0) + count;
        }

        if (outcome.complete) {
          break;
        }

        if (round === CATCH_UP_MAX_ROUNDS) {
          throw new Error(`Retention job ${job} did not finish catching up`);
        }
      }

      caught[job] = totals;
    }

    return caught;
  }

  /**
   * Forgets this record's runs after a year. Daily.
   *
   * @returns What the run did, or null when it failed.
   */
  @Cron('11 5 * * *', { timeZone: CRON_TIMEZONE })
  retentionRuns(): Promise<RetentionOutcome | null> {
    return this._runs.record(RetentionJob.RETENTION_RUNS, () =>
      this._runs.prune(),
    );
  }
}
