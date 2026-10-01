import { Logger } from '@nestjs/common';

import { jest } from '@jest/globals';
import { Queue } from 'bullmq';

import {
  FILE_ASSET_PUBLICATION_ATTEMPTS,
  FILE_ASSET_PUBLICATION_BACKOFF_MS,
  FILE_ASSET_PUBLICATION_JOB,
} from '../constants/file-asset-publication.constants';
import { AssetPublicationQueueService } from './asset-publication-queue.service';

describe('AssetPublicationQueueService', () => {
  let add: jest.Mock<(...args: any[]) => Promise<any>>;
  let getJob: jest.Mock<(jobId: string) => Promise<any>>;
  let service: AssetPublicationQueueService;

  beforeEach(() => {
    add = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({});
    getJob = jest
      .fn<(jobId: string) => Promise<any>>()
      .mockResolvedValue(undefined);
    service = new AssetPublicationQueueService({
      add,
      getJob,
    } as unknown as Queue);

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  // FC-042: the failed job used to swallow every later request for the
  // same asset, silently, stranding it.
  it('sends a failed publication of the same asset round again instead', async () => {
    const retry = jest
      .fn<(...args: any[]) => Promise<void>>()
      .mockResolvedValue(undefined);

    getJob.mockResolvedValue({ isFailed: () => Promise.resolve(true), retry });

    await service.enqueue('asset-1');

    expect(getJob).toHaveBeenCalledWith('asset-1');
    expect(retry).toHaveBeenCalledWith('failed', {
      resetAttemptsMade: true,
      resetAttemptsStarted: true,
    });
    expect(add).not.toHaveBeenCalled();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      '[enqueue] Failed publication sent round again - AssetId: asset-1',
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('queues an asset identifier and nothing else', async () => {
    await service.enqueue('asset-1');

    expect(add).toHaveBeenCalledWith(
      FILE_ASSET_PUBLICATION_JOB,
      { assetId: 'asset-1' },
      expect.objectContaining({
        attempts: FILE_ASSET_PUBLICATION_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: FILE_ASSET_PUBLICATION_BACKOFF_MS,
        },
      }),
    );
  });

  // A verdict delivered twice should enqueue one job rather than two.
  it('keys the job by the asset', async () => {
    await service.enqueue('asset-1');

    expect(add).toHaveBeenCalledWith(
      FILE_ASSET_PUBLICATION_JOB,
      { assetId: 'asset-1' },
      expect.objectContaining({ jobId: 'asset-1' }),
    );
  });

  // A publication that ran out of attempts is an asset somebody uploaded
  // and cannot see; the only other trace of it would be a log line.
  it('keeps a job that failed for good', async () => {
    await service.enqueue('asset-1');

    expect(add).toHaveBeenCalledWith(
      FILE_ASSET_PUBLICATION_JOB,
      { assetId: 'asset-1' },
      expect.objectContaining({ removeOnComplete: true, removeOnFail: false }),
    );
  });
});
