import { Logger } from '@nestjs/common';

import { jest } from '@jest/globals';

import {
  STALE_PLACEMENT_HOURS,
  STALE_PLACEMENT_SWEEP_LIMIT,
} from '../constants/file-asset-publication.constants';
import { FileAssetPlacementState } from '../enums/file-asset-placement-state.enum';
import { FileAssetState } from '../enums/file-asset-state.enum';
import { FileAssetPlacementService } from './file-asset-placement.service';
import { FileAssetService } from './file-asset.service';
import { QuarantineStorageService } from './quarantine-storage.service';
import { StaleUploadSweepService } from './stale-upload-sweep.service';

describe('StaleUploadSweepService', () => {
  const placement = { id: 'placement-1', assetId: 'asset-1' };

  let findStalePending: jest.Mock<(...args: any[]) => Promise<any>>;
  let settle: jest.Mock<(...args: any[]) => Promise<any>>;
  let findById: jest.Mock<(...args: any[]) => Promise<any>>;
  let discard: jest.Mock<(...args: any[]) => Promise<any>>;
  let remove: jest.Mock<(...args: any[]) => Promise<any>>;
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

    service = new StaleUploadSweepService(
      { findStalePending, settle } as unknown as FileAssetPlacementService,
      { findById, discard } as unknown as FileAssetService,
      { remove } as unknown as QuarantineStorageService,
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
});
