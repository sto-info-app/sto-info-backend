import { Logger } from '@nestjs/common';

import { Queue } from 'bullmq';

import {
  ROSTER_IDENTITY_RECOMPUTE_ATTEMPTS,
  ROSTER_IDENTITY_RECOMPUTE_BACKOFF_MS,
  ROSTER_IDENTITY_RECOMPUTE_JOB,
} from '../constants/roster-identity.constants';
import { RosterIdentityQueueService } from './roster-identity-queue.service';

describe('RosterIdentityQueueService', () => {
  let queue: { add: jest.Mock };
  let service: RosterIdentityQueueService;

  beforeEach(() => {
    queue = { add: jest.fn(() => Promise.resolve({ id: 'job-1' })) };
    service = new RosterIdentityQueueService(queue as unknown as Queue);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('queues the Fleet and nothing else', async () => {
    await service.enqueue('fleet-1');

    expect(queue.add).toHaveBeenCalledWith(
      ROSTER_IDENTITY_RECOMPUTE_JOB,
      { fleetId: 'fleet-1' },
      expect.anything(),
    );
  });

  // A job keyed by the Fleet would be dropped while one for it is running,
  // and the running one may already have read past the change.
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
        attempts: ROSTER_IDENTITY_RECOMPUTE_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: ROSTER_IDENTITY_RECOMPUTE_BACKOFF_MS,
        },
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
