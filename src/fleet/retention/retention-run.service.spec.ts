import { Logger } from '@nestjs/common';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { InMemoryManager, Row } from '../../../test/in-memory-manager';
import { RetentionJob } from './retention-job.enum';
import { RetentionRunEntity } from './retention-run.entity';
import { RetentionRunService } from './retention-run.service';

const DAY = 86_400_000;

describe('RetentionRunService (FC-037)', () => {
  let db: InMemoryManager;
  let service: RetentionRunService;
  let error: jest.SpiedFunction<Logger['error']>;

  beforeEach(() => {
    db = new InMemoryManager().defaults(RetentionRunEntity, {
      finishedAt: null,
      complete: null,
      counts: null,
      error: null,
    });
    service = new RetentionRunService(db.asDataSource());
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const runs = (): Row[] => db.rows(RetentionRunEntity);

  it('records a run: when, what it did, and whether that was all', async () => {
    const outcome = { counts: { messages: 3 }, complete: false };

    await expect(
      service.record(RetentionJob.CHAT_MESSAGES, async () => outcome),
    ).resolves.toBe(outcome);
    expect(runs()).toEqual([
      expect.objectContaining({
        job: RetentionJob.CHAT_MESSAGES,
        startedAt: expect.any(Date),
        finishedAt: expect.any(Date),
        complete: false,
        counts: { messages: 3 },
      }),
    ]);
  });

  it('records why a run failed, and carries on', async () => {
    await expect(
      service.record(RetentionJob.ACTIVITY, () =>
        Promise.reject(new Error('x'.repeat(600))),
      ),
    ).resolves.toBeNull();
    await expect(
      service.record(RetentionJob.ACTIVITY, () => Promise.reject('down')),
    ).resolves.toBeNull();

    expect(runs()).toEqual([
      expect.objectContaining({ complete: false, error: 'x'.repeat(500) }),
      expect.objectContaining({ complete: false, error: 'down' }),
    ]);
    expect(error).toHaveBeenCalledWith(
      '[record] Retention run failed - Job: ACTIVITY',
      'down',
    );
  });

  it('reports a run it could not even start', async () => {
    db.save = (() => Promise.reject(new Error('no database'))) as never;

    await expect(
      service.record(RetentionJob.ACTIVITY, async () => ({
        counts: {},
        complete: true,
      })),
    ).resolves.toBeNull();
    expect(runs()).toEqual([]);
  });

  it('reports a failure it could not record', async () => {
    db.update = (() => Promise.reject(new Error('no database'))) as never;

    await expect(
      service.record(RetentionJob.ACTIVITY, async () => ({
        counts: {},
        complete: true,
      })),
    ).resolves.toBeNull();

    db.update = (() => Promise.reject('gone')) as never;

    await service.record(RetentionJob.ACTIVITY, async () => ({
      counts: {},
      complete: true,
    }));

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('[fail] Retention run not recorded as failed'),
      expect.any(String),
    );
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('[fail] Retention run not recorded as failed'),
      'gone',
    );
  });

  it('forgets runs after a year', async () => {
    db.seed(RetentionRunEntity, [
      { id: 'old', startedAt: new Date(Date.now() - 370 * DAY) },
      { id: 'recent', startedAt: new Date(Date.now() - 300 * DAY) },
    ]);

    await expect(service.prune()).resolves.toEqual({
      counts: { runs: 1 },
      complete: true,
    });
    expect(runs().map(run => run.id)).toEqual(['recent']);
  });
});
