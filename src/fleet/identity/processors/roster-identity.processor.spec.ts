import { Logger } from '@nestjs/common';

import { Job } from 'bullmq';

import { RosterIdentityRecomputeService } from '../services/roster-identity-recompute.service';
import { RosterIdentityProcessor } from './roster-identity.processor';

describe('RosterIdentityProcessor', () => {
  let recompute: { recompute: jest.Mock };
  let processor: RosterIdentityProcessor;
  let error: jest.SpyInstance;

  const job = (data: unknown): Job<unknown> =>
    ({ id: 'job-1', data }) as unknown as Job<unknown>;

  beforeEach(() => {
    recompute = { recompute: jest.fn(() => Promise.resolve({})) };
    processor = new RosterIdentityProcessor(
      recompute as unknown as RosterIdentityRecomputeService,
    );
    error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('recomputes the Fleet the job names', async () => {
    await processor.process(job({ fleetId: 'fleet-1' }));

    expect(recompute.recompute).toHaveBeenCalledWith('fleet-1');
  });

  it.each([
    ['no payload', null],
    ['a payload that is not an object', 'fleet-1'],
    ['no Fleet', {}],
    ['a Fleet that is not a string', { fleetId: 7 }],
    ['an empty Fleet', { fleetId: '' }],
  ])('drops a job with %s rather than retrying it', async (_case, data) => {
    await expect(processor.process(job(data))).resolves.toBeUndefined();

    expect(recompute.recompute).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      '[process] Identity job rejected - JobId: job-1',
    );
  });

  it('rethrows a failure, so the job is retried', async () => {
    recompute.recompute.mockRejectedValue(new Error('lock timeout'));

    await expect(
      processor.process(job({ fleetId: 'fleet-1' })),
    ).rejects.toThrow('lock timeout');
  });
});
