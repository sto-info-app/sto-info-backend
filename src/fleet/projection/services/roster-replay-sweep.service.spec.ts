import { Logger } from '@nestjs/common';

import { FindOperator, Repository } from 'typeorm';

import { RosterProjectionEntity } from '../entities/roster-projection.entity';
import { RosterReplayQueueService } from './roster-replay-queue.service';
import { RosterReplaySweepService } from './roster-replay-sweep.service';

describe('RosterReplaySweepService', () => {
  let projections: { find: jest.Mock };
  let queue: { enqueue: jest.Mock };
  let service: RosterReplaySweepService;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    projections = {
      find: jest.fn(() =>
        Promise.resolve([{ fleetId: 'fleet-1' }, { fleetId: 'fleet-2' }]),
      ),
    };
    queue = { enqueue: jest.fn(() => Promise.resolve()) };
    service = new RosterReplaySweepService(
      projections as unknown as Repository<RosterProjectionEntity>,
      queue as unknown as RosterReplayQueueService,
    );
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    // Spying on a method already spied on returns the same spy, calls and
    // all, so each test starts from none.
    warn.mockClear();
    error.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('queues every Fleet whose projection is behind what was asked of it', async () => {
    await expect(service.sweep()).resolves.toBe(2);

    expect(queue.enqueue).toHaveBeenCalledWith('fleet-1');
    expect(queue.enqueue).toHaveBeenCalledWith('fleet-2');
    expect(warn).toHaveBeenCalledWith(
      '[sweep] Roster projections behind, replays queued - Fleets: 2',
    );
  });

  it('asks the database for built behind requested, and nothing else', async () => {
    await service.sweep();

    const [[options]] = projections.find.mock.calls as [
      [
        {
          where: { built: FindOperator<unknown> };
          select: Record<string, boolean>;
        },
      ],
    ];

    expect(options.select).toEqual({ fleetId: true });
    expect(options.where.built.type).toBe('raw');
    expect(
      (options.where.built.getSql as (alias: string) => string)('"built"'),
    ).toBe('"built" < "requested"');
  });

  it('says nothing when no Fleet is behind', async () => {
    projections.find.mockResolvedValue([]);

    await expect(service.sweep()).resolves.toBe(0);

    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  // An unhandled rejection in a scheduled job takes the process down.
  it('catches a failure and leaves it for the next sweep', async () => {
    queue.enqueue.mockRejectedValue(new Error('Redis is not answering'));

    await expect(service.sweep()).resolves.toBeNull();

    expect(error).toHaveBeenCalledWith(
      'Roster replay sweep failed',
      expect.stringContaining('Redis is not answering'),
    );
  });

  it('reports a failure that is not an Error as text', async () => {
    projections.find.mockRejectedValue('connection reset');

    await expect(service.sweep()).resolves.toBeNull();

    expect(error).toHaveBeenCalledWith(
      'Roster replay sweep failed',
      'connection reset',
    );
  });
});
