import { describe, expect, it, jest } from '@jest/globals';

import { FleetFeatureService } from '../fleet-feature.service';
import { FleetRetentionScheduler } from './fleet-retention.scheduler';
import { RetentionJob } from './retention-job.enum';
import { RetentionOutcome } from './retention-run.service';

describe('FleetRetentionScheduler (FC-037)', () => {
  const outcome: RetentionOutcome = { counts: {}, complete: true };
  const job = () => jest.fn(async () => outcome);
  const runs = {
    record: jest.fn(
      (_job: RetentionJob, work: () => Promise<RetentionOutcome>) => work(),
    ),
    prune: job(),
  };
  const sources = { expire: job() };
  const news = { purgeDeleted: job() };
  const memberships = { purgeRetracted: job() };
  const messages = { purge: job() };
  const reports = { purge: job() };
  const transcripts = { sweep: job() };
  const activity = { purge: job() };
  const holds = { review: job() };
  const scheduler = new FleetRetentionScheduler(
    runs as never,
    sources as never,
    news as never,
    memberships as never,
    messages as never,
    reports as never,
    transcripts as never,
    activity as never,
    holds as never,
  );

  it.each([
    ['rosterSources', RetentionJob.ROSTER_SOURCES, sources.expire],
    ['newsPosts', RetentionJob.NEWS_POSTS, news.purgeDeleted],
    [
      'characterFleetMemberships',
      RetentionJob.CHARACTER_FLEET_MEMBERSHIPS,
      memberships.purgeRetracted,
    ],
    ['chatMessages', RetentionJob.CHAT_MESSAGES, messages.purge],
    ['chatReports', RetentionJob.CHAT_REPORTS, reports.purge],
    ['chatTranscripts', RetentionJob.CHAT_TRANSCRIPTS, transcripts.sweep],
    ['activity', RetentionJob.ACTIVITY, activity.purge],
    ['moderationHolds', RetentionJob.MODERATION_HOLDS, holds.review],
    ['retentionRuns', RetentionJob.RETENTION_RUNS, runs.prune],
  ] as const)('runs %s as a recorded run', async (method, recorded, work) => {
    await expect(scheduler[method]()).resolves.toBe(outcome);
    expect(runs.record).toHaveBeenLastCalledWith(
      recorded,
      expect.any(Function),
    );
    expect(work).toHaveBeenCalled();
  });

  it('schedules one job for every kind of run, in UTC', () => {
    const methods = Object.getOwnPropertyNames(
      FleetRetentionScheduler.prototype,
    ).filter(name => name !== 'constructor');
    const schedules = methods.map(
      name =>
        Reflect.getMetadata(
          'SCHEDULE_CRON_OPTIONS',
          (
            FleetRetentionScheduler.prototype as unknown as Record<
              string,
              object
            >
          )[name],
        ) as { cronTime: string; timeZone: string },
    );

    expect(methods).toHaveLength(Object.values(RetentionJob).length);
    expect(schedules.map(schedule => schedule.timeZone)).toEqual(
      methods.map(() => 'UTC'),
    );
  });

  // FleetFeatureService: retention is owed whether or not the feature is on,
  // so nothing here may ask.
  it('never asks whether the Fleet feature is on', () => {
    const injected = Reflect.getMetadata(
      'design:paramtypes',
      FleetRetentionScheduler,
    ) as unknown[];

    expect(injected).not.toContain(FleetFeatureService);
  });
});
