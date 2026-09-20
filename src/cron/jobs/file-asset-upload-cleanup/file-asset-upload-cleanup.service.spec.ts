import { Logger } from '@nestjs/common';

import { jest } from '@jest/globals';

import { StaleUploadSweepService } from 'src/file-assets/services/stale-upload-sweep.service';

import { FileAssetUploadCleanupService } from './file-asset-upload-cleanup.service';

describe('FileAssetUploadCleanupService', () => {
  let sweep: jest.Mock<(...args: any[]) => Promise<any>>;
  let logSpy: jest.SpiedFunction<(...args: any[]) => any>;
  let service: FileAssetUploadCleanupService;

  beforeEach(() => {
    sweep = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue({ abandoned: 2, undeleted: 1 });

    service = new FileAssetUploadCleanupService({
      sweep,
    } as unknown as StaleUploadSweepService);

    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs the sweep and reports what it did', async () => {
    await service.cleanup();

    expect(sweep).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      'Abandoned 2 stale upload(s); 1 left bytes in quarantine.',
    );
  });

  // The job wrapper owns the schedule and nothing else, so a failure in
  // the sweep is the cron service's to log and swallow.
  it('lets a failure through to the cron service', async () => {
    sweep.mockRejectedValue(new Error('the database said no'));

    await expect(service.cleanup()).rejects.toThrow('the database said no');
  });
});
