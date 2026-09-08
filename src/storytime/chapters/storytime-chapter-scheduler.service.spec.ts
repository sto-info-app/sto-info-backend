import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeChapterSchedulerService } from './storytime-chapter-scheduler.service';
import { StorytimeChapterService } from './storytime-chapter.service';

describe('StorytimeChapterSchedulerService', () => {
  let service: StorytimeChapterSchedulerService;
  let chapterService: { publishDueChapters: jest.Mock };
  let featureService: { isFlagEnabled: jest.Mock };

  beforeEach(async () => {
    chapterService = { publishDueChapters: jest.fn().mockResolvedValue(2) };
    featureService = { isFlagEnabled: jest.fn().mockResolvedValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeChapterSchedulerService,
        { provide: StorytimeChapterService, useValue: chapterService },
        { provide: StorytimeFeatureService, useValue: featureService },
      ],
    }).compile();

    service = module.get<StorytimeChapterSchedulerService>(
      StorytimeChapterSchedulerService,
    );
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('publishes the Chapters that are due', async () => {
    await service.publishDueChapters();

    expect(chapterService.publishDueChapters).toHaveBeenCalled();
  });

  // An environment with Storytime switched off must never publish anything,
  // including after an administrator pulls the switch mid-incident.
  it('publishes nothing while Storytime is switched off', async () => {
    featureService.isFlagEnabled.mockResolvedValue(false);

    await service.publishDueChapters();

    expect(chapterService.publishDueChapters).not.toHaveBeenCalled();
  });

  // An unhandled rejection inside a scheduled job takes the process down.
  it('swallows a failure rather than letting it escape the job', async () => {
    chapterService.publishDueChapters.mockRejectedValue(
      new Error('database unavailable'),
    );

    await expect(service.publishDueChapters()).resolves.toBeUndefined();
  });

  // A rejection that is not an Error still has to be logged usefully rather
  // than crashing the logger.
  it('swallows a failure that is not an Error', async () => {
    chapterService.publishDueChapters.mockRejectedValue('database gone');

    await expect(service.publishDueChapters()).resolves.toBeUndefined();
  });

  it('swallows a failure to read the feature switch', async () => {
    featureService.isFlagEnabled.mockRejectedValue(new Error('settings down'));

    await expect(service.publishDueChapters()).resolves.toBeUndefined();
  });
});
