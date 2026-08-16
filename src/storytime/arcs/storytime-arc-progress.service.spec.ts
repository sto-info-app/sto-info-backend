import { Test, TestingModule } from '@nestjs/testing';
import { ReaderStoryStatus } from '../enums/reader-story-status.enum';
import { StorytimeProgressService } from '../progress/storytime-progress.service';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeArcProgressService } from './storytime-arc-progress.service';

describe('StorytimeArcProgressService', () => {
  let service: StorytimeArcProgressService;
  let progressService: { getStoryProgress: jest.Mock };

  const userId = 'user-1';
  const arcId = 'arc-1';

  /**
   * Builds a readable Story.
   *
   * @param id - The Story identifier.
   * @returns The Story entity.
   */
  const buildStory = (id: string) =>
    Object.assign(new StorytimeStoryEntity(), { id });

  /**
   * Arranges each Story's progress, in the order the Stories were given.
   *
   * @param statuses - The reader's status for each Story.
   * @param continueChapterIds - Where to pick up in each.
   */
  const arrangeProgress = (
    statuses: ReaderStoryStatus[],
    continueChapterIds: (string | null)[] = [],
  ): void => {
    let call = 0;

    progressService.getStoryProgress.mockImplementation((_user, storyId) => {
      const index = call++;

      return Promise.resolve({
        progress: { storyId, status: statuses[index] },
        continueChapterId: continueChapterIds[index] ?? null,
      });
    });
  };

  beforeEach(async () => {
    progressService = { getStoryProgress: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeArcProgressService,
        { provide: StorytimeProgressService, useValue: progressService },
      ],
    }).compile();

    service = module.get<StorytimeArcProgressService>(
      StorytimeArcProgressService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('reports nothing read at the start of an Arc', async () => {
    arrangeProgress([
      ReaderStoryStatus.NOT_STARTED,
      ReaderStoryStatus.NOT_STARTED,
    ]);

    const summary = await service.summarise(userId, arcId, [
      buildStory('story-1'),
      buildStory('story-2'),
    ]);

    expect(summary.completedStories).toBe(0);
    expect(summary.percentComplete).toBe(0);
    expect(summary.totalStories).toBe(2);
  });

  it('counts the Stories the reader has finished', async () => {
    arrangeProgress([
      ReaderStoryStatus.COMPLETED,
      ReaderStoryStatus.NOT_STARTED,
    ]);

    const summary = await service.summarise(userId, arcId, [
      buildStory('story-1'),
      buildStory('story-2'),
    ]);

    expect(summary.completedStories).toBe(1);
    expect(summary.percentComplete).toBe(50);
  });

  // An Arc whose later Stories are not out yet should read as complete once
  // the published ones are done, rather than stalling at a percentage nobody
  // can move.
  it('reads as complete when every readable Story is finished', async () => {
    arrangeProgress([ReaderStoryStatus.COMPLETED]);

    const summary = await service.summarise(userId, arcId, [
      buildStory('story-1'),
    ]);

    expect(summary.percentComplete).toBe(100);
    expect(summary.continueStoryId).toBeNull();
  });

  describe('where to continue', () => {
    it('points at the first unfinished Story', async () => {
      arrangeProgress([
        ReaderStoryStatus.COMPLETED,
        ReaderStoryStatus.NOT_STARTED,
      ]);

      const summary = await service.summarise(userId, arcId, [
        buildStory('story-1'),
        buildStory('story-2'),
      ]);

      expect(summary.continueStoryId).toBe('story-2');
    });

    // A Story left half-read is still the next thing to do, so it wins over
    // one the reader has never opened.
    it('prefers a Story left part-read to a later untouched one', async () => {
      arrangeProgress(
        [ReaderStoryStatus.IN_PROGRESS, ReaderStoryStatus.NOT_STARTED],
        ['chapter-3', null],
      );

      const summary = await service.summarise(userId, arcId, [
        buildStory('story-1'),
        buildStory('story-2'),
      ]);

      expect(summary.continueStoryId).toBe('story-1');
      expect(summary.continueChapterId).toBe('chapter-3');
    });

    // On hold and abandoned are deliberate, but they are still unfinished, and
    // an Arc reader asking where to continue means "in this Arc".
    it.each([ReaderStoryStatus.ON_HOLD, ReaderStoryStatus.ABANDONED])(
      'still points at a Story marked %s',
      async status => {
        arrangeProgress([status, ReaderStoryStatus.NOT_STARTED]);

        const summary = await service.summarise(userId, arcId, [
          buildStory('story-1'),
          buildStory('story-2'),
        ]);

        expect(summary.continueStoryId).toBe('story-1');
      },
    );
  });

  // A curator may assemble an Arc before its Stories are released, so an Arc
  // with nothing readable in it is a real state rather than a mistake.
  describe('an Arc with nothing readable in it', () => {
    it('reports no progress at all', async () => {
      const summary = await service.summarise(userId, arcId, []);

      expect(summary).toEqual({
        arcId,
        totalStories: 0,
        completedStories: 0,
        percentComplete: 0,
        continueStoryId: null,
        continueChapterId: null,
      });
    });

    // Dividing by zero would be the alternative.
    it('asks about no Stories', async () => {
      await service.summarise(userId, arcId, []);

      expect(progressService.getStoryProgress).not.toHaveBeenCalled();
    });
  });

  it('rounds the percentage to a whole number', async () => {
    arrangeProgress([
      ReaderStoryStatus.COMPLETED,
      ReaderStoryStatus.NOT_STARTED,
      ReaderStoryStatus.NOT_STARTED,
    ]);

    const summary = await service.summarise(userId, arcId, [
      buildStory('story-1'),
      buildStory('story-2'),
      buildStory('story-3'),
    ]);

    expect(summary.percentComplete).toBe(33);
  });
});
