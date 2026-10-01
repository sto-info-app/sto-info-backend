import { describe, expect, it, jest } from '@jest/globals';

import { FleetFeatureService } from '../fleet-feature.service';
import {
  CATCH_UP_MAX_ROUNDS,
  FleetRetentionScheduler,
} from './fleet-retention.scheduler';
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
    ).filter(name => name !== 'constructor' && name !== 'catchUp');
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

  // FC-043: the restore check's catch-up, after a restore.
  describe('catchUp', () => {
    /** Every job that forgets by age, in the order it is caught up. */
    const forgetting = () => [
      sources.expire,
      news.purgeDeleted,
      memberships.purgeRetracted,
      messages.purge,
      reports.purge,
      transcripts.sweep,
      activity.purge,
    ];

    it('runs every job that forgets by age until each says it is done', async () => {
      messages.purge
        .mockResolvedValueOnce({ counts: { messages: 500 }, complete: false })
        .mockResolvedValueOnce({ counts: { messages: 20 }, complete: true });
      sources.expire.mockResolvedValueOnce({
        counts: { sources: 2, assets: 1 },
        complete: true,
      });

      const caught = await scheduler.catchUp();

      expect(caught).toEqual({
        ROSTER_SOURCES: { sources: 2, assets: 1 },
        NEWS_POSTS: {},
        CHARACTER_FLEET_MEMBERSHIPS: {},
        CHAT_MESSAGES: { messages: 520 },
        CHAT_REPORTS: {},
        CHAT_TRANSCRIPTS: {},
        ACTIVITY: {},
      });
      for (const work of forgetting()) {
        expect(work).toHaveBeenCalled();
      }
      // Each round is a recorded run, as on its schedule.
      expect(runs.record).toHaveBeenCalledWith(
        RetentionJob.CHAT_MESSAGES,
        expect.any(Function),
      );
    });

    // Reviewing holds tells people things, and pruning this record forgets
    // nothing a restore could bring back.
    it('leaves reviewing holds and pruning runs to their schedules', async () => {
      holds.review.mockClear();
      runs.prune.mockClear();

      await scheduler.catchUp();

      expect(holds.review).not.toHaveBeenCalled();
      expect(runs.prune).not.toHaveBeenCalled();
    });

    it('fails when a job fails, so the restore check tries again', async () => {
      runs.record.mockImplementationOnce(async () => null as never);

      await expect(scheduler.catchUp()).rejects.toThrow(
        'Retention job ROSTER_SOURCES failed while catching up',
      );
    });

    it('fails rather than looping for ever on a job that never finishes', async () => {
      reports.purge.mockClear();
      reports.purge.mockResolvedValue({ counts: {}, complete: false });

      await expect(scheduler.catchUp()).rejects.toThrow(
        'Retention job CHAT_REPORTS did not finish catching up',
      );
      expect(reports.purge).toHaveBeenCalledTimes(CATCH_UP_MAX_ROUNDS);

      reports.purge.mockResolvedValue(outcome);
    });
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
