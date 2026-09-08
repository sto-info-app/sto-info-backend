import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { ReaderChapterStatus } from '../enums/reader-chapter-status.enum';
import { ReaderStoryStatus } from '../enums/reader-story-status.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryMapper } from '../stories/storytime-story.mapper';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeUserChapterProgressEntity } from './entities/storytime-user-chapter-progress.entity';
import { StorytimeUserStoryProgressEntity } from './entities/storytime-user-story-progress.entity';
import { StorytimeProgressController } from './storytime-progress.controller';
import { StorytimeProgressMapper } from './storytime-progress.mapper';
import {
  StoryProgressSummary,
  StorytimeProgressService,
} from './storytime-progress.service';

describe('StorytimeProgressController', () => {
  let controller: StorytimeProgressController;
  let progressService: {
    findLibrary: jest.Mock;
    getStoryProgress: jest.Mock;
    findChapterProgress: jest.Mock;
    setStoryStatus: jest.Mock;
    updateChapterProgress: jest.Mock;
    setChapterRead: jest.Mock;
    completeStory: jest.Mock;
    resetStory: jest.Mock;
  };
  let storyService: { findPublicByIds: jest.Mock };
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
      findChapterProgress: jest.fn().mockResolvedValue(null),
      setStoryStatus: jest.fn().mockResolvedValue(buildSummary()),
      updateChapterProgress: jest.fn().mockResolvedValue(buildSummary()),
      setChapterRead: jest.fn().mockResolvedValue(buildSummary()),
      completeStory: jest.fn().mockResolvedValue(buildSummary()),
      resetStory: jest.fn().mockResolvedValue(buildSummary()),
    };
    storyService = {
      findPublicByIds: jest.fn().mockResolvedValue([
        Object.assign(new StorytimeStoryEntity(), {
          id: storyId,
          slug: 'a-story',
          title: 'A Story',
          upVoteCount: 0,
          downVoteCount: 0,
        }),
      ]),
    };
    featureService = {
      assertFlagEnabled: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorytimeProgressController],
      providers: [
        { provide: StorytimeProgressService, useValue: progressService },
        StorytimeProgressMapper,
        { provide: StorytimeStoryService, useValue: storyService },
        StorytimeStoryMapper,
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

    // A library of identifiers would be useless, and one request per row would
    // be a request per row.
    it('fetches every Story in one go', async () => {
      progressService.findLibrary.mockResolvedValue([
        { storyId: 'story-1' },
        { storyId: 'story-1' },
      ]);

      const result = await controller.findLibrary(userId);

      expect(storyService.findPublicByIds).toHaveBeenCalledTimes(1);
      expect(result[0].story?.title).toBe('A Story');
    });

    // A Story made private or removed since the reader started it still
    // belongs in their own history rather than vanishing from it.
    it('keeps a row whose Story is no longer readable', async () => {
      progressService.findLibrary.mockResolvedValue([{ storyId: 'story-1' }]);
      storyService.findPublicByIds.mockResolvedValue([]);

      const result = await controller.findLibrary(userId);

      expect(result).toHaveLength(1);
      expect(result[0].story).toBeNull();
      expect(result[0].progress.storyId).toBe(storyId);
    });

    it('returns an empty library', async () => {
      await expect(controller.findLibrary(userId)).resolves.toEqual([]);
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

  it('reports progress through one Chapter', async () => {
    progressService.findChapterProgress.mockResolvedValue(
      Object.assign(new StorytimeUserChapterProgressEntity(), {
        chapterId: 'chapter-1',
        status: ReaderChapterStatus.IN_PROGRESS,
        progressPercent: 55,
        lastPositionValue: 'b9',
        lastReadAt: null,
      }),
    );

    const result = await controller.findChapterProgress('chapter-1', userId);

    expect(result.blockId).toBe('b9');
    expect(progressService.findChapterProgress).toHaveBeenCalledWith(
      userId,
      'chapter-1',
    );
  });

  it('reports an unopened Chapter as unread', async () => {
    const result = await controller.findChapterProgress('chapter-1', userId);

    expect(result.status).toBe(ReaderChapterStatus.UNREAD);
    expect(result.blockId).toBeNull();
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
        'findChapterProgress',
        () => controller.findChapterProgress('chapter-1', userId),
      ],
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
