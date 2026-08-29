import { Logger, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { ReaderChapterStatus } from '../enums/reader-chapter-status.enum';
import { ReaderStoryStatus } from '../enums/reader-story-status.enum';
import { StorytimeUserChapterProgressEntity } from './entities/storytime-user-chapter-progress.entity';
import { StorytimeUserStoryProgressEntity } from './entities/storytime-user-story-progress.entity';
import { StorytimeProgressService } from './storytime-progress.service';

describe('StorytimeProgressService', () => {
  let service: StorytimeProgressService;
  let storyProgressRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let chapterProgressRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    count: jest.Mock;
    delete: jest.Mock;
  };
  let chapterRepository: { find: jest.Mock; findOne: jest.Mock };

  const userId = 'e6d3a1b2-0000-4000-8000-000000000001';
  const storyId = 'e6d3a1b2-0000-4000-8000-0000000000aa';

  /**
   * Builds a readable Chapter.
   *
   * @param id - The Chapter identifier.
   * @param orderIndex - Its position.
   * @returns The Chapter entity.
   */
  const buildChapter = (id: string, orderIndex: number) =>
    Object.assign(new StorytimeChapterEntity(), { id, storyId, orderIndex });

  /**
   * Builds a Story progress row.
   *
   * @param overrides - Fields to change.
   * @returns The progress entity.
   */
  const buildStoryProgress = (
    overrides: Partial<StorytimeUserStoryProgressEntity> = {},
  ): StorytimeUserStoryProgressEntity =>
    Object.assign(new StorytimeUserStoryProgressEntity(), {
      id: 'progress-1',
      userId,
      storyId,
      status: ReaderStoryStatus.NOT_STARTED,
      lastReadChapterId: null,
      startedAt: null,
      completedAt: null,
      lastReadAt: null,
      completedChapterCount: 0,
      knownPublishedChapterCount: 0,
      ...overrides,
    });

  /**
   * Builds a Chapter progress row.
   *
   * @param overrides - Fields to change.
   * @returns The progress entity.
   */
  const buildChapterProgress = (
    overrides: Partial<StorytimeUserChapterProgressEntity> = {},
  ): StorytimeUserChapterProgressEntity =>
    Object.assign(new StorytimeUserChapterProgressEntity(), {
      id: 'chapter-progress-1',
      userId,
      storyId,
      chapterId: 'chapter-1',
      status: ReaderChapterStatus.UNREAD,
      progressPercent: null,
      lastPositionType: null,
      lastPositionValue: null,
      startedAt: null,
      readAt: null,
      lastReadAt: null,
      ...overrides,
    });

  /**
   * Arranges the readable Chapters and which of them the reader has finished.
   *
   * @param chapters - The readable Chapters.
   * @param readIds - The Chapters the reader has finished.
   */
  const arrange = (
    chapters: StorytimeChapterEntity[],
    readIds: string[] = [],
  ) => {
    chapterRepository.find.mockResolvedValue(chapters);
    chapterProgressRepository.find.mockResolvedValue(
      readIds.map(chapterId => buildChapterProgress({ chapterId })),
    );
    chapterProgressRepository.count.mockResolvedValue(readIds.length);
  };

  beforeEach(async () => {
    storyProgressRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      // Faithful to TypeORM: `create` assigns the given fields to a bare
      // entity and applies no column defaults, because the defaults belong to
      // the database and this row is never inserted. Starting from a filled
      // row instead hid a reader with no progress arriving with no status at
      // all — which reached the Story page as a progress panel for a Story
      // they had not opened.
      create: jest.fn(input =>
        Object.assign(new StorytimeUserStoryProgressEntity(), input),
      ),
      save: jest.fn(input => Promise.resolve(input)),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    chapterProgressRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(input =>
        Object.assign(new StorytimeUserChapterProgressEntity(), input),
      ),
      save: jest.fn(input => Promise.resolve(input)),
      count: jest.fn().mockResolvedValue(0),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    chapterRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(buildChapter('chapter-1', 1000)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeProgressService,
        {
          provide: getRepositoryToken(StorytimeUserStoryProgressEntity),
          useValue: storyProgressRepository,
        },
        {
          provide: getRepositoryToken(StorytimeUserChapterProgressEntity),
          useValue: chapterProgressRepository,
        },
        {
          provide: getRepositoryToken(StorytimeChapterEntity),
          useValue: chapterRepository,
        },
      ],
    }).compile();

    service = module.get<StorytimeProgressService>(StorytimeProgressService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('reading a Chapter', () => {
    // Opening a Chapter is not reading it. Without this a reader following a
    // link and leaving would drag the Story out of "not started".
    it('records nothing meaningful below the threshold', async () => {
      arrange([buildChapter('chapter-1', 1000)]);

      await service.updateChapterProgress(userId, 'chapter-1', {
        progressPercent: 2,
      });

      const saved = chapterProgressRepository.save.mock
        .calls[0][0] as StorytimeUserChapterProgressEntity;
      expect(saved.status).toBe(ReaderChapterStatus.UNREAD);
      expect(saved.startedAt).toBeNull();
    });

    it('starts the Chapter once past the threshold', async () => {
      arrange([buildChapter('chapter-1', 1000)]);

      await service.updateChapterProgress(userId, 'chapter-1', {
        progressPercent: 25,
      });

      const saved = chapterProgressRepository.save.mock
        .calls[0][0] as StorytimeUserChapterProgressEntity;
      expect(saved.status).toBe(ReaderChapterStatus.IN_PROGRESS);
      expect(saved.startedAt).toBeInstanceOf(Date);
    });

    // A reader rarely scrolls to the last pixel; the footer and navigation
    // sit below the final paragraph.
    it('finishes the Chapter near the end rather than at exactly 100', async () => {
      arrange([buildChapter('chapter-1', 1000)]);

      await service.updateChapterProgress(userId, 'chapter-1', {
        progressPercent: 96,
      });

      const saved = chapterProgressRepository.save.mock
        .calls[0][0] as StorytimeUserChapterProgressEntity;
      expect(saved.status).toBe(ReaderChapterStatus.READ);
      expect(saved.readAt).toBeInstanceOf(Date);
    });

    it('stores the block anchor as the position', async () => {
      arrange([buildChapter('chapter-1', 1000)]);

      await service.updateChapterProgress(userId, 'chapter-1', {
        progressPercent: 40,
        blockId: 'b12',
      });

      const saved = chapterProgressRepository.save.mock
        .calls[0][0] as StorytimeUserChapterProgressEntity;
      expect(saved.lastPositionType).toBe('BLOCK');
      expect(saved.lastPositionValue).toBe('b12');
    });

    // Scrolling back up to re-read a paragraph has not un-read the Chapter.
    it('never moves progress backwards', async () => {
      chapterProgressRepository.findOne.mockResolvedValue(
        buildChapterProgress({ progressPercent: 80 }),
      );
      arrange([buildChapter('chapter-1', 1000)]);

      await service.updateChapterProgress(userId, 'chapter-1', {
        progressPercent: 20,
      });

      const saved = chapterProgressRepository.save.mock
        .calls[0][0] as StorytimeUserChapterProgressEntity;
      expect(saved.progressPercent).toBe(80);
    });

    // The client debounces and retries, so the same body twice must settle.
    it('is idempotent for the same position', async () => {
      chapterProgressRepository.findOne.mockResolvedValue(
        buildChapterProgress({
          progressPercent: 50,
          status: ReaderChapterStatus.IN_PROGRESS,
        }),
      );
      arrange([buildChapter('chapter-1', 1000)]);

      await service.updateChapterProgress(userId, 'chapter-1', {
        progressPercent: 50,
      });

      const saved = chapterProgressRepository.save.mock
        .calls[0][0] as StorytimeUserChapterProgressEntity;
      expect(saved.progressPercent).toBe(50);
      expect(saved.status).toBe(ReaderChapterStatus.IN_PROGRESS);
    });

    // Both fields are optional, so a client that tracks only the anchor is
    // entitled to send just that.
    it('accepts a position with no percentage', async () => {
      chapterProgressRepository.findOne.mockResolvedValue(
        buildChapterProgress({
          progressPercent: 60,
          status: ReaderChapterStatus.IN_PROGRESS,
        }),
      );
      arrange([buildChapter('chapter-1', 1000)]);

      await service.updateChapterProgress(userId, 'chapter-1', {
        blockId: 'b7',
      });

      const saved = chapterProgressRepository.save.mock
        .calls[0][0] as StorytimeUserChapterProgressEntity;
      expect(saved.progressPercent).toBe(60);
      expect(saved.lastPositionValue).toBe('b7');
    });

    it('treats a first visit with no percentage as unstarted', async () => {
      arrange([buildChapter('chapter-1', 1000)]);

      await service.updateChapterProgress(userId, 'chapter-1', {
        blockId: 'b1',
      });

      const saved = chapterProgressRepository.save.mock
        .calls[0][0] as StorytimeUserChapterProgressEntity;
      expect(saved.status).toBe(ReaderChapterStatus.UNREAD);
      expect(saved.progressPercent).toBe(0);
    });

    it('refuses an unknown Chapter', async () => {
      chapterRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateChapterProgress(userId, 'nope', { progressPercent: 50 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // Without a way to read the stored position back, recording it would be
  // pointless: the reader page could note where somebody got to and never put
  // them back there.
  describe('reading a position back', () => {
    it('reports where the reader left off', async () => {
      chapterProgressRepository.findOne.mockResolvedValue(
        buildChapterProgress({ lastPositionValue: 'b9', progressPercent: 55 }),
      );

      const progress = await service.findChapterProgress(userId, 'chapter-1');

      expect(progress?.lastPositionValue).toBe('b9');
      expect(chapterProgressRepository.findOne).toHaveBeenCalledWith({
        where: { userId, chapterId: 'chapter-1' },
      });
    });

    it('reports nothing for a Chapter the reader has never opened', async () => {
      await expect(
        service.findChapterProgress(userId, 'chapter-1'),
      ).resolves.toBeNull();
    });
  });

  describe('Story status', () => {
    it('stays not started while nothing has been read', async () => {
      arrange([buildChapter('chapter-1', 1000)]);

      const result = await service.getStoryProgress(userId, storyId);

      expect(result.progress.status).toBe(ReaderStoryStatus.NOT_STARTED);
      expect(result.percentComplete).toBe(0);
    });

    // A reader who has only ever looked at a Story gets a row that is never
    // inserted, so nothing applies the column defaults for them. Left to
    // those, the summary reaches the Story page with no status — which reads
    // as a progress panel for a Story nobody has opened — and a new-Chapter
    // count of NaN, which serialises to null.
    it('gives a reader with no row every figure the page asks for', async () => {
      arrange([
        buildChapter('chapter-1', 1000),
        buildChapter('chapter-2', 2000),
      ]);

      const result = await service.getStoryProgress(userId, storyId);

      expect(result.progress.status).toBe(ReaderStoryStatus.NOT_STARTED);
      expect(result.progress.lastReadChapterId).toBeNull();
      expect(result.progress.lastReadAt).toBeNull();
      expect(result.progress.completedAt).toBeNull();
      expect(result.readChapters).toBe(0);
      expect(result.newChapterCount).toBe(2);
      expect(Number.isNaN(result.newChapterCount)).toBe(false);
    });

    it('becomes in progress once a Chapter is finished', async () => {
      arrange(
        [buildChapter('chapter-1', 1000), buildChapter('chapter-2', 2000)],
        ['chapter-1'],
      );

      const result = await service.setChapterRead(userId, 'chapter-1', true);

      expect(result.progress.status).toBe(ReaderStoryStatus.IN_PROGRESS);
      expect(result.percentComplete).toBe(50);
    });

    it('completes once every readable Chapter is finished', async () => {
      arrange([buildChapter('chapter-1', 1000)], ['chapter-1']);

      const result = await service.setChapterRead(userId, 'chapter-1', true);

      expect(result.progress.status).toBe(ReaderStoryStatus.COMPLETED);
      expect(result.progress.completedAt).toBeInstanceOf(Date);
      expect(result.percentComplete).toBe(100);
    });

    // Reading one more Chapter of a Story somebody put on hold does not mean
    // they resumed it.
    it.each([ReaderStoryStatus.ON_HOLD, ReaderStoryStatus.ABANDONED])(
      'leaves %s alone when the reader reads on',
      async status => {
        storyProgressRepository.findOne.mockResolvedValue(
          buildStoryProgress({ status }),
        );
        arrange([buildChapter('chapter-1', 1000)], ['chapter-1']);

        const result = await service.setChapterRead(userId, 'chapter-1', true);

        expect(result.progress.status).toBe(status);
      },
    );

    it('records the Chapter the reader was last in', async () => {
      arrange([buildChapter('chapter-1', 1000)], ['chapter-1']);

      const result = await service.setChapterRead(userId, 'chapter-1', true);

      expect(result.progress.lastReadChapterId).toBe('chapter-1');
    });

    it('accepts a deliberate status from the reader', async () => {
      arrange([buildChapter('chapter-1', 1000)]);

      const result = await service.setStoryStatus(userId, storyId, {
        status: ReaderStoryStatus.ON_HOLD,
      });

      expect(result.progress.status).toBe(ReaderStoryStatus.ON_HOLD);
    });

    it('timestamps a Story the reader declares complete', async () => {
      arrange([buildChapter('chapter-1', 1000)]);

      const result = await service.setStoryStatus(userId, storyId, {
        status: ReaderStoryStatus.COMPLETED,
      });

      expect(result.progress.completedAt).toBeInstanceOf(Date);
    });
  });

  describe('marking read and unread', () => {
    it('marks a Chapter read outright', async () => {
      arrange([buildChapter('chapter-1', 1000)], ['chapter-1']);

      await service.setChapterRead(userId, 'chapter-1', true);

      const saved = chapterProgressRepository.save.mock
        .calls[0][0] as StorytimeUserChapterProgressEntity;
      expect(saved.status).toBe(ReaderChapterStatus.READ);
      expect(saved.progressPercent).toBe(100);
    });

    // Being told you have not read something and then dropped halfway through
    // it is worse than starting again.
    it('clears the stored position when marking unread', async () => {
      chapterProgressRepository.findOne.mockResolvedValue(
        buildChapterProgress({
          status: ReaderChapterStatus.READ,
          progressPercent: 100,
          lastPositionValue: 'b9',
          readAt: new Date(),
        }),
      );
      arrange([buildChapter('chapter-1', 1000)]);

      await service.setChapterRead(userId, 'chapter-1', false);

      const saved = chapterProgressRepository.save.mock
        .calls[0][0] as StorytimeUserChapterProgressEntity;
      expect(saved.status).toBe(ReaderChapterStatus.UNREAD);
      expect(saved.progressPercent).toBeNull();
      expect(saved.lastPositionValue).toBeNull();
      expect(saved.readAt).toBeNull();
    });

    it('refuses an unknown Chapter', async () => {
      chapterRepository.findOne.mockResolvedValue(null);

      await expect(
        service.setChapterRead(userId, 'nope', true),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Continue Reading', () => {
    it('points at the first unfinished Chapter', async () => {
      arrange(
        [
          buildChapter('chapter-1', 1000),
          buildChapter('chapter-2', 2000),
          buildChapter('chapter-3', 3000),
        ],
        ['chapter-1'],
      );

      const result = await service.getStoryProgress(userId, storyId);

      expect(result.continueChapterId).toBe('chapter-2');
    });

    it('points at the first Chapter when nothing has been read', async () => {
      arrange([buildChapter('chapter-1', 1000)]);

      const result = await service.getStoryProgress(userId, storyId);

      expect(result.continueChapterId).toBe('chapter-1');
    });

    it('points nowhere once everything is read', async () => {
      arrange([buildChapter('chapter-1', 1000)], ['chapter-1']);

      const result = await service.getStoryProgress(userId, storyId);

      expect(result.continueChapterId).toBeNull();
    });

    it('points nowhere when the Story has no readable Chapters', async () => {
      arrange([]);

      const result = await service.getStoryProgress(userId, storyId);

      expect(result.continueChapterId).toBeNull();
      expect(result.percentComplete).toBe(0);
    });
  });

  describe('new content after completion', () => {
    it('reports Chapters published since the reader was up to date', async () => {
      storyProgressRepository.findOne.mockResolvedValue(
        buildStoryProgress({
          status: ReaderStoryStatus.COMPLETED,
          knownPublishedChapterCount: 2,
        }),
      );
      arrange(
        [
          buildChapter('chapter-1', 1000),
          buildChapter('chapter-2', 2000),
          buildChapter('chapter-3', 3000),
        ],
        ['chapter-1', 'chapter-2'],
      );

      const result = await service.getStoryProgress(userId, storyId);

      expect(result.newChapterCount).toBe(1);
      expect(result.continueChapterId).toBe('chapter-3');
    });

    it('reports nothing new when the reader is up to date', async () => {
      storyProgressRepository.findOne.mockResolvedValue(
        buildStoryProgress({ knownPublishedChapterCount: 1 }),
      );
      arrange([buildChapter('chapter-1', 1000)], ['chapter-1']);

      const result = await service.getStoryProgress(userId, storyId);

      expect(result.newChapterCount).toBe(0);
    });

    // The Story returns to their in-progress list rather than sitting in
    // "completed" where they would never look.
    it('returns completed readers to in progress when a Chapter is published', async () => {
      storyProgressRepository.find.mockResolvedValue([
        buildStoryProgress({ status: ReaderStoryStatus.COMPLETED }),
        buildStoryProgress({
          id: 'progress-2',
          status: ReaderStoryStatus.COMPLETED,
        }),
      ]);

      await expect(service.reopenCompletedReaders(storyId)).resolves.toBe(2);

      const saved = storyProgressRepository.save.mock
        .calls[0][0] as StorytimeUserStoryProgressEntity[];
      expect(
        saved.every(row => row.status === ReaderStoryStatus.IN_PROGRESS),
      ).toBe(true);
    });

    it('does nothing when nobody had finished the Story', async () => {
      await expect(service.reopenCompletedReaders(storyId)).resolves.toBe(0);
      expect(storyProgressRepository.save).not.toHaveBeenCalled();
    });

    // Marking it read on their behalf would be a lie.
    it('leaves the new Chapter unread', async () => {
      storyProgressRepository.find.mockResolvedValue([
        buildStoryProgress({ status: ReaderStoryStatus.COMPLETED }),
      ]);

      await service.reopenCompletedReaders(storyId);

      expect(chapterProgressRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('completeStory', () => {
    it('marks every readable Chapter read', async () => {
      arrange([
        buildChapter('chapter-1', 1000),
        buildChapter('chapter-2', 2000),
      ]);

      await service.completeStory(userId, storyId);

      expect(chapterProgressRepository.save).toHaveBeenCalledTimes(2);
    });

    it('copes with a Story that has no readable Chapters', async () => {
      arrange([]);

      const result = await service.completeStory(userId, storyId);

      expect(result.progress.lastReadChapterId).toBeNull();
    });
  });

  describe('resetStory', () => {
    // A reader asking to reset wants the Story to look untouched, not a
    // record of having abandoned it.
    it('deletes the progress rows rather than zeroing them', async () => {
      arrange([buildChapter('chapter-1', 1000)]);

      await service.resetStory(userId, storyId);

      expect(chapterProgressRepository.delete).toHaveBeenCalledWith({
        userId,
        storyId,
      });
      expect(storyProgressRepository.delete).toHaveBeenCalledWith({
        userId,
        storyId,
      });
    });

    it('reports a clean slate afterwards', async () => {
      arrange([buildChapter('chapter-1', 1000)]);

      const result = await service.resetStory(userId, storyId);

      expect(result.progress.status).toBe(ReaderStoryStatus.NOT_STARTED);
      expect(result.readChapters).toBe(0);
    });
  });

  describe('findLibrary', () => {
    it('lists every Story the reader has progress on', async () => {
      storyProgressRepository.find.mockResolvedValue([buildStoryProgress()]);

      await expect(service.findLibrary(userId)).resolves.toHaveLength(1);
      expect(storyProgressRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId } }),
      );
    });

    it('filters by status for a library tab', async () => {
      await service.findLibrary(userId, ReaderStoryStatus.ON_HOLD);

      expect(storyProgressRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, status: ReaderStoryStatus.ON_HOLD },
        }),
      );
    });
  });
});
