import { Logger } from '@nestjs/common';

import { Job } from 'bullmq';

import { RosterReplayService } from '../services/roster-replay.service';
import { RosterReplayProcessor } from './roster-replay.processor';

describe('RosterReplayProcessor', () => {
  let replay: { replay: jest.Mock };
  let processor: RosterReplayProcessor;
  let error: jest.SpyInstance;

  const job = (data: unknown): Job<unknown> =>
    ({ id: 'job-1', data }) as unknown as Job<unknown>;

  beforeEach(() => {
    replay = { replay: jest.fn(() => Promise.resolve({})) };
    processor = new RosterReplayProcessor(
      replay as unknown as RosterReplayService,
    );
    error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('replays the Fleet the job names', async () => {
    await processor.process(job({ fleetId: 'fleet-1' }));

    expect(replay.replay).toHaveBeenCalledWith('fleet-1');
  });

  it.each([
    ['no payload', null],
    ['a payload that is not an object', 'fleet-1'],
    ['no Fleet', {}],
    ['a Fleet that is not a string', { fleetId: 7 }],
    ['an empty Fleet', { fleetId: '' }],
  ])('drops a job with %s rather than retrying it', async (_case, data) => {
    await expect(processor.process(job(data))).resolves.toBeUndefined();

    expect(replay.replay).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      '[process] Replay job rejected - JobId: job-1',
    );
  });

  it('rethrows a failure, so the job is retried', async () => {
    replay.replay.mockRejectedValue(new Error('lock timeout'));

    await expect(
      processor.process(job({ fleetId: 'fleet-1' })),
    ).rejects.toThrow('lock timeout');
  });
});
