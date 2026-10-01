import { describe, expect, it, jest } from '@jest/globals';
import { DataSource } from 'typeorm';

import { ScanWorkerHeartbeatDto } from '../dto/scan-diagnostics.dto';
import {
  readWorkerHeartbeats,
  workerBlockage,
} from './worker-heartbeat.utility';

/**
 * A worker's heartbeat, as it is read.
 *
 * @param overrides - What differs from a live, running worker.
 * @returns The heartbeat.
 */
const worker = (
  overrides: Partial<ScanWorkerHeartbeatDto> = {},
): ScanWorkerHeartbeatDto => ({
  workerId: 'worker-a',
  state: 'RUNNING',
  pauseReason: null,
  definitionsVersion: null,
  definitionsBuiltAt: null,
  signatureAgeHours: null,
  jobsInHand: 0,
  startedAt: new Date(),
  beatAt: new Date(),
  secondsSinceBeat: 5,
  live: true,
  pausedSince: null,
  pausedMinutes: null,
  ...overrides,
});

describe('worker heartbeat utility (FC-042)', () => {
  describe('workerBlockage', () => {
    it.each([
      ['a heartbeat that could not be read', null, 'WORKER_SILENT'],
      ['no worker at all', [], 'WORKER_SILENT'],
      ['no live worker', [worker({ live: false })], 'WORKER_SILENT'],
      [
        'every live worker paused',
        [worker({ state: 'PAUSED' }), worker({ live: false })],
        'WORKER_PAUSED',
      ],
      [
        'one live worker running',
        [worker({ state: 'PAUSED' }), worker()],
        null,
      ],
      ['one live worker stopping', [worker({ state: 'STOPPING' })], null],
    ])('judges %s', (_name, workers, blockage) => {
      expect(workerBlockage(workers as ScanWorkerHeartbeatDto[] | null)).toBe(
        blockage,
      );
    });
  });

  describe('readWorkerHeartbeats', () => {
    it('lets a view it cannot read throw, for the caller to judge', async () => {
      const failure = new Error('relation does not exist');
      const query = jest.fn(() => Promise.reject(failure));

      await expect(
        readWorkerHeartbeats({ query } as unknown as DataSource),
      ).rejects.toBe(failure);
    });
  });
});
