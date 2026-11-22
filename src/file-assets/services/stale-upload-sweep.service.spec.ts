import { Logger } from '@nestjs/common';

import { jest } from '@jest/globals';
import { DataSource } from 'typeorm';

import { OperationsAlertKind } from 'src/operations/alerts/operations-alert.enum';

import {
  STALE_PLACEMENT_HOURS,
  STALE_PLACEMENT_SWEEP_LIMIT,
} from '../constants/file-asset-publication.constants';
import { FileAssetPlacementState } from '../enums/file-asset-placement-state.enum';
import { FileAssetState } from '../enums/file-asset-state.enum';
import {
  PublicationPauseService,
  PublicationPauseState,
} from '../publication/publication-pause.service';
import { FileAssetPlacementService } from './file-asset-placement.service';
import { FileAssetService } from './file-asset.service';
import { QuarantineStorageService } from './quarantine-storage.service';
import { StaleUploadSweepService } from './stale-upload-sweep.service';

/**
 * One worker's heartbeat, as the view's query returns it.
 *
 * @param overrides - What differs from a live, running worker.
 * @returns The row.
 */
const heartbeat = (overrides: Record<string, unknown> = {}) => ({
  workerId: 'worker-a',
  state: 'RUNNING',
  pauseReason: null,
  definitionsVersion: '27500',
  definitionsBuiltAt: null,
  jobsInHand: 0,
  startedAt: new Date(),
  beatAt: new Date(),
  pausedSince: null,
  secondsSinceBeat: 10,
  secondsPaused: null,
  secondsSinceDefinitions: null,
  ...overrides,
});

/** The switch while publication runs, never paused. */
const RUNNING: PublicationPauseState = {
  paused: false,
  pausedAt: null,
  pausedByUserId: null,
  resumedAt: null,
};

describe('StaleUploadSweepService', () => {
  const placement = { id: 'placement-1', assetId: 'asset-1' };

  let findStalePending: jest.Mock<(...args: any[]) => Promise<any>>;
  let settle: jest.Mock<(...args: any[]) => Promise<any>>;
  let findById: jest.Mock<(...args: any[]) => Promise<any>>;
  let discard: jest.Mock<(...args: any[]) => Promise<any>>;
  let remove: jest.Mock<(...args: any[]) => Promise<any>>;
  let heartbeats: unknown[] | Error | string;
  let recentAlert: boolean;
  let query: jest.Mock<(sql: string, params?: unknown[]) => Promise<unknown>>;
  let state: jest.Mock<(fresh?: boolean) => Promise<PublicationPauseState>>;
  let service: StaleUploadSweepService;

  beforeEach(() => {
    findStalePending = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue([placement]);
    settle = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({});
    findById = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({
      id: 'asset-1',
      state: FileAssetState.SCANNING,
      objectKey: 'test/assets/asset-1',
    });
    discard = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({});
    remove = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue(undefined);

    heartbeats = [heartbeat()];
    recentAlert = false;
    query = jest.fn((sql: string) => {
      if (sql.includes('worker_heartbeat_status')) {
        return Array.isArray(heartbeats)
          ? Promise.resolve(heartbeats)
          : Promise.reject(heartbeats);
      }

      return Promise.resolve([{ recent: recentAlert }]);
    });
    state = jest.fn(() => Promise.resolve(RUNNING));

    service = new StaleUploadSweepService(
      { findStalePending, settle } as unknown as FileAssetPlacementService,
      { findById, discard } as unknown as FileAssetService,
      { remove } as unknown as QuarantineStorageService,
      { query } as unknown as DataSource,
      { state } as unknown as PublicationPauseService,
    );

    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('gives up on an upload nothing came back for', async () => {
    await expect(service.sweep()).resolves.toEqual({
      abandoned: 1,
      undeleted: 0,
      heldBy: null,
    });

    expect(remove).toHaveBeenCalledWith('test/assets/asset-1');
    expect(discard).toHaveBeenCalledWith(
      'asset-1',
      'Abandoned: no verdict within the sweep window',
    );
    expect(settle).toHaveBeenCalledWith(
      placement,
      FileAssetPlacementState.ABANDONED,
    );
  });

  // Far longer than any scan and far longer than the pauses ADR-0020 makes
  // ordinary, so an upload caught by a freshclam outage still publishes.
  it('looks only at uploads older than the window', async () => {
    const before = Date.now() - STALE_PLACEMENT_HOURS * 60 * 60 * 1_000;

    await service.sweep();

    const [threshold, limit] = findStalePending.mock.calls[0] as [Date, number];

    expect(threshold.getTime()).toBeCloseTo(before, -3);
    expect(limit).toBe(STALE_PLACEMENT_SWEEP_LIMIT);
  });

  it('reports a quiet night', async () => {
    findStalePending.mockResolvedValue([]);

    await expect(service.sweep()).resolves.toEqual({
      abandoned: 0,
      undeleted: 0,
      heldBy: null,
    });
  });

  // Leaving it pending would report an upload as in progress for ever
  // because a bucket was briefly unavailable.
  it.each([
    ['an error', new Error('the bucket said no')],
    ['something that is not an error', 'the bucket said no'],
  ])(
    'abandons the placement when the bytes will not go, given %s',
    async (_name, failure) => {
      remove.mockRejectedValue(failure);

      await expect(service.sweep()).resolves.toEqual({
        abandoned: 1,
        undeleted: 1,
        heldBy: null,
      });
      expect(settle).toHaveBeenCalled();
    },
  );

  it('settles a placement whose asset has gone', async () => {
    findById.mockResolvedValue(null);

    await service.sweep();

    expect(remove).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalled();
  });

  it('has nothing to drop for an upload that never stored anything', async () => {
    findById.mockResolvedValue({
      id: 'asset-1',
      state: FileAssetState.RECEIVING,
      objectKey: null,
    });

    await service.sweep();

    expect(remove).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalled();
  });

  it('leaves an asset that is already gone alone', async () => {
    findById.mockResolvedValue({
      id: 'asset-1',
      state: FileAssetState.DELETED,
      objectKey: 'test/assets/asset-1',
    });

    await service.sweep();

    expect(discard).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalled();
  });

  // FC-042: the day counts from when the pipeline started again, so nothing
  // is given up on while it is stopped, or for a day after.
  describe('while the pipeline is stopped', () => {
    /**
     * Sweeps, and says why it held back.
     *
     * @returns The reason, having checked nothing was touched.
     */
    const held = async (): Promise<string | null> => {
      const report = await service.sweep();

      if (report.heldBy !== null) {
        expect(report).toEqual({
          abandoned: 0,
          undeleted: 0,
          heldBy: report.heldBy,
        });
        expect(findStalePending).not.toHaveBeenCalled();
        expect(settle).not.toHaveBeenCalled();
      }

      return report.heldBy;
    };

    it('holds back while publication is paused', async () => {
      state.mockResolvedValue({ ...RUNNING, paused: true });

      await expect(held()).resolves.toBe('PUBLICATION_PAUSED');
      expect(state).toHaveBeenCalledWith(true);
    });

    it.each([
      ['no worker has beaten lately', [heartbeat({ secondsSinceBeat: 600 })]],
      ['there is no worker at all', []],
    ])('holds back while the worker is silent: %s', async (_name, rows) => {
      heartbeats = rows;

      await expect(held()).resolves.toBe('WORKER_SILENT');
    });

    it.each([
      ['an error', new Error('relation does not exist')],
      ['something that is not an error', 'odd'],
    ])(
      'counts a heartbeat it cannot read, given %s, as silent',
      async (_name, failure) => {
        heartbeats = failure;

        await expect(held()).resolves.toBe('WORKER_SILENT');
        expect(Logger.prototype.warn).toHaveBeenCalledWith(
          expect.stringContaining(
            '[holdOf] Worker heartbeat unreadable; counted as silent',
          ),
        );
      },
    );

    it('holds back while every live worker is paused', async () => {
      heartbeats = [
        heartbeat({
          state: 'PAUSED',
          pausedSince: new Date(),
          secondsPaused: 60,
        }),
        heartbeat({ secondsSinceBeat: 900 }),
      ];

      await expect(held()).resolves.toBe('WORKER_PAUSED');
    });

    it('holds back for a day after a stopping alert clears, or while one is open', async () => {
      recentAlert = true;

      await expect(held()).resolves.toBe('RECENTLY_RESUMED');

      const [sql, params] = query.mock.calls.find(([statement]) =>
        statement.includes('operations_alert'),
      )!;
      const before = Date.now() - STALE_PLACEMENT_HOURS * 60 * 60 * 1_000;

      expect(sql).toContain('"clearedAt" IS NULL OR "clearedAt" > $2');
      expect(params?.[0]).toEqual([
        OperationsAlertKind.WORKER_SILENT,
        OperationsAlertKind.WORKER_PAUSED,
        OperationsAlertKind.QUEUES_UNREACHABLE,
      ]);
      expect(Math.abs((params?.[1] as Date).getTime() - before)).toBeLessThan(
        5_000,
      );
    });

    it('holds back for a day after publication was resumed', async () => {
      state.mockResolvedValue({
        ...RUNNING,
        resumedAt: new Date(Date.now() - 60 * 60 * 1_000),
      });

      await expect(held()).resolves.toBe('RECENTLY_RESUMED');
    });

    it('sweeps once publication was resumed more than a day ago', async () => {
      state.mockResolvedValue({
        ...RUNNING,
        resumedAt: new Date(Date.now() - 25 * 60 * 60 * 1_000),
      });

      await expect(held()).resolves.toBeNull();
      expect(settle).toHaveBeenCalled();
    });
  });
});
