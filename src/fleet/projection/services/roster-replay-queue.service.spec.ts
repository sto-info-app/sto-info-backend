import { Logger } from '@nestjs/common';

import { Queue } from 'bullmq';
import { EntityManager } from 'typeorm';

import {
  ROSTER_REPLAY_ATTEMPTS,
  ROSTER_REPLAY_BACKOFF_MS,
  ROSTER_REPLAY_JOB,
} from '../constants/roster-replay.constants';
import { RosterProjectionEntity } from '../entities/roster-projection.entity';
import { RosterReplayQueueService } from './roster-replay-queue.service';

describe('RosterReplayQueueService', () => {
  let queue: { add: jest.Mock };
  let service: RosterReplayQueueService;

  beforeEach(() => {
    queue = { add: jest.fn(() => Promise.resolve({ id: 'job-1' })) };
    service = new RosterReplayQueueService(queue as unknown as Queue);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('recording a request', () => {
    let builder: Record<string, jest.Mock>;
    let manager: { createQueryBuilder: jest.Mock; increment: jest.Mock };

    beforeEach(() => {
      builder = {};
      for (const step of ['insert', 'into', 'values', 'orIgnore']) {
        builder[step] = jest.fn(() => builder);
      }
      builder.execute = jest.fn(() => Promise.resolve({}));
      manager = {
        createQueryBuilder: jest.fn(() => builder),
        increment: jest.fn(() => Promise.resolve({})),
      };
    });

    // A Fleet's first request writes its row; every request, the first
    // included, bumps the counter, through the change's own transaction.
    it('makes sure the Fleet has a projection row, then bumps its counter', async () => {
      await service.request(manager as unknown as EntityManager, 'fleet-1');

      expect(builder.into).toHaveBeenCalledWith(RosterProjectionEntity);
      expect(builder.values).toHaveBeenCalledWith({ fleetId: 'fleet-1' });
      expect(builder.orIgnore).toHaveBeenCalled();
      expect(manager.increment).toHaveBeenCalledWith(
        RosterProjectionEntity,
        { fleetId: 'fleet-1' },
        'requested',
        1,
      );
      expect(builder.execute.mock.invocationCallOrder[0]).toBeLessThan(
        manager.increment.mock.invocationCallOrder[0],
      );
    });

    it('queues nothing: that is for after the commit', async () => {
      await service.request(manager as unknown as EntityManager, 'fleet-1');

      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  it('queues the Fleet and nothing else', async () => {
    await service.enqueue('fleet-1');

    expect(queue.add).toHaveBeenCalledWith(
      ROSTER_REPLAY_JOB,
      { fleetId: 'fleet-1' },
      expect.anything(),
    );
  });

  // A job keyed by the Fleet would be dropped while one for it is running,
  // and the running one may already have read past the change. The counters
  // make a surplus job cheap instead.
  it('does not key the job, so a request during a run is not dropped', async () => {
    await service.enqueue('fleet-1');

    const [, , options] = queue.add.mock.calls[0] as [
      string,
      unknown,
      Record<string, unknown>,
    ];

    expect(options).not.toHaveProperty('jobId');
  });

  it('retries with backoff and keeps a job that ran out of attempts', async () => {
    await service.enqueue('fleet-1');

    expect(queue.add).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        attempts: ROSTER_REPLAY_ATTEMPTS,
        backoff: { type: 'exponential', delay: ROSTER_REPLAY_BACKOFF_MS },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  });

  it('fails when the queue cannot be reached', async () => {
    queue.add.mockRejectedValue(new Error('Redis is not answering'));

    await expect(service.enqueue('fleet-1')).rejects.toThrow(
      'Redis is not answering',
    );
  });
});
