import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { ReaderStoryStatus } from '../enums/reader-story-status.enum';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeUserStoryProgressEntity } from './entities/storytime-user-story-progress.entity';
import { StorytimeProgressController } from './storytime-progress.controller';
import { StorytimeProgressMapper } from './storytime-progress.mapper';
import {
  StorytimeProgressService,
  StoryProgressSummary,
} from './storytime-progress.service';

describe('StorytimeProgressController', () => {
  let controller: StorytimeProgressController;
  let progressService: {
    findLibrary: jest.Mock;
    getStoryProgress: jest.Mock;
    setStoryStatus: jest.Mock;
    updateChapterProgress: jest.Mock;
    setChapterRead: jest.Mock;
    completeStory: jest.Mock;
    resetStory: jest.Mock;
  };
  let featureService: { assertFlagEnabled: jest.Mock };

  const userId = 'user-1';
  const storyId = 'story-1';

  /**
   * Builds a progress summary for the service to return.
   *
   * @param overrides - Fields to change.
   * @returns The summary.
   */
  const buildSummary = (
    overrides: Partial<StoryProgressSummary> = {},
  ): StoryProgressSummary => ({
    progress: Object.assign(new StorytimeUserStoryProgressEntity(), {
      userId,
      storyId,
      status: ReaderStoryStatus.IN_PROGRESS,
      lastReadChapterId: null,
      lastReadAt: null,
      completedAt: null,
    }),
    totalChapters: 2,
    readChapters: 1,
    percentComplete: 50,
    newChapterCount: 0,
    continueChapterId: 'chapter-2',
    ...overrides,
  });

  beforeEach(async () => {
    progressService = {
      findLibrary: jest.fn().mockResolvedValue([]),
      getStoryProgress: jest.fn().mockResolvedValue(buildSummary()),
      setStoryStatus: jest.fn().mockResolvedValue(buildSummary()),
      updateChapterProgress: jest.fn().mockResolvedValue(buildSummary()),
      setChapterRead: jest.fn().mockResolvedValue(buildSummary()),
      completeStory: jest.fn().mockResolvedValue(buildSummary()),
      resetStory: jest.fn().mockResolvedValue(buildSummary()),
    };
    featureService = {
      assertFlagEnabled: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorytimeProgressController],
      providers: [
        { provide: StorytimeProgressService, useValue: progressService },
        StorytimeProgressMapper,
        { provide: StorytimeFeatureService, useValue: featureService },
      ],
    }).compile();

    controller = module.get<StorytimeProgressController>(
      StorytimeProgressController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findLibrary', () => {
    it('summarises each Story the reader has progress on', async () => {
      progressService.findLibrary.mockResolvedValue([
        { storyId: 'story-1' },
        { storyId: 'story-2' },
      ]);

      const result = await controller.findLibrary(userId);

      expect(result).toHaveLength(2);
      expect(progressService.getStoryProgress).toHaveBeenCalledWith(
        userId,
        'story-2',
      );
    });

    it('passes a status filter through', async () => {
      await controller.findLibrary(userId, ReaderStoryStatus.ABANDONED);

      expect(progressService.findLibrary).toHaveBeenCalledWith(
        userId,
        ReaderStoryStatus.ABANDONED,
      );
    });
  });

  it('reports progress through one Story', async () => {
    const result = await controller.findOne(storyId, userId);

    expect(result.percentComplete).toBe(50);
    expect(progressService.getStoryProgress).toHaveBeenCalledWith(
      userId,
      storyId,
    );
  });

  it('sets a deliberate Story status', async () => {
    await controller.setStoryStatus(
      storyId,
      { status: ReaderStoryStatus.ON_HOLD },
      userId,
    );

    expect(progressService.setStoryStatus).toHaveBeenCalledWith(
      userId,
      storyId,
      { status: ReaderStoryStatus.ON_HOLD },
    );
  });

  it('records a reading position', async () => {
    await controller.updateChapterProgress(
      'chapter-1',
      { progressPercent: 40, blockId: 'b3' },
      userId,
    );

    expect(progressService.updateChapterProgress).toHaveBeenCalledWith(
      userId,
      'chapter-1',
      { progressPercent: 40, blockId: 'b3' },
    );
  });

  it('marks a Chapter read', async () => {
    await controller.setChapterRead('chapter-1', { isRead: true }, userId);

    expect(progressService.setChapterRead).toHaveBeenCalledWith(
      userId,
      'chapter-1',
      true,
    );
  });

  it('marks a Chapter unread', async () => {
    await controller.setChapterRead('chapter-1', { isRead: false }, userId);

    expect(progressService.setChapterRead).toHaveBeenCalledWith(
      userId,
      'chapter-1',
      false,
    );
  });

  it('completes a whole Story', async () => {
    await controller.completeStory(storyId, userId);

    expect(progressService.completeStory).toHaveBeenCalledWith(userId, storyId);
  });

  it('resets a Story', async () => {
    await controller.resetStory(storyId, userId);

    expect(progressService.resetStory).toHaveBeenCalledWith(userId, storyId);
  });

  // Progress is part of reading, so it goes away with the rest of it rather
  // than carrying on quietly behind a switched-off feature.
  describe('when reading is switched off', () => {
    beforeEach(() => {
      featureService.assertFlagEnabled.mockRejectedValue(
        new ForbiddenException(),
      );
    });

    it.each([
      ['findLibrary', () => controller.findLibrary(userId)],
      ['findOne', () => controller.findOne(storyId, userId)],
      [
        'setStoryStatus',
        () =>
          controller.setStoryStatus(
            storyId,
            { status: ReaderStoryStatus.ON_HOLD },
            userId,
          ),
      ],
      [
        'updateChapterProgress',
        () =>
          controller.updateChapterProgress(
            'chapter-1',
            { progressPercent: 10 },
            userId,
          ),
      ],
      [
        'setChapterRead',
        () => controller.setChapterRead('chapter-1', { isRead: true }, userId),
      ],
      ['completeStory', () => controller.completeStory(storyId, userId)],
      ['resetStory', () => controller.resetStory(storyId, userId)],
    ])('refuses %s', async (_name, act) => {
      await expect(act()).rejects.toThrow(ForbiddenException);
      expect(featureService.assertFlagEnabled).toHaveBeenCalledWith(
        STORYTIME_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
      );
    });
  });
});
