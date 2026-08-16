import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LimitService } from '../../access-control/limit.service';
import { StorytimeMarkdownService } from '../content/storytime-markdown.service';
import { ChapterStatus } from '../enums/chapter-status.enum';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeProgressService } from '../progress/storytime-progress.service';
import { StorytimeOrderingService } from '../shared/storytime-ordering.service';
import {
  SlugRequest,
  StorytimeSlugService,
} from '../shared/storytime-slug.service';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeChapterEntity } from './entities/storytime-chapter.entity';
import { StorytimeChapterService } from './storytime-chapter.service';

/** Chainable stub standing in for the due-Chapter query builder. */
interface DueQueryBuilderStub {
  where: jest.Mock;
  andWhere: jest.Mock;
  getMany: jest.Mock;
}

describe('StorytimeChapterService', () => {
  let service: StorytimeChapterService;
  let chapterRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    count: jest.Mock;
    softDelete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let storyRepository: { update: jest.Mock };
  let storyService: { findEditableOrFail: jest.Mock };
  let slugService: {
    generateUniqueSlug: jest.Mock;
    recordRetiredSlug: jest.Mock;
  };
  let limitService: { assertWithinLimit: jest.Mock };
  let progressService: { reopenCompletedReaders: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let manager: { save: jest.Mock; count: jest.Mock; update: jest.Mock };

  const ownerId = 'e6d3a1b2-0000-4000-8000-000000000001';
  const storyId = 'e6d3a1b2-0000-4000-8000-0000000000aa';
  const chapterId = 'e6d3a1b2-0000-4000-8000-0000000000bb';

  /**
   * Builds a Chapter with sensible defaults.
   *
   * @param overrides - Fields to change.
   * @returns The Chapter entity.
   */
  const buildChapter = (
    overrides: Partial<StorytimeChapterEntity> = {},
  ): StorytimeChapterEntity => {
    const chapter = new StorytimeChapterEntity();
    Object.assign(chapter, {
      id: chapterId,
      storyId,
      title: 'Chapter One',
      slug: 'chapter-one',
      synopsis: null,
      contentSource: 'The Enterprise went to warp.',
      contentHtml: '<p id="b1">The Enterprise went to warp.</p>',
      status: ChapterStatus.DRAFT,
      moderationStatus: StorytimeModerationStatus.ACTIVE,
      languageCode: null,
      orderIndex: 1000,
      wordCount: 5,
      version: 1,
      publishedAt: null,
      scheduledPublishAt: null,
      upVoteCount: 0,
      downVoteCount: 0,
      ...overrides,
    });
    return chapter;
  };

  beforeEach(async () => {
    manager = {
      save: jest.fn(input => Promise.resolve(input)),
      count: jest.fn().mockResolvedValue(1),
      update: jest.fn().mockResolvedValue(undefined),
    };

    chapterRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(input =>
        Object.assign(new StorytimeChapterEntity(), input),
      ),
      save: jest.fn(input => Promise.resolve(input)),
      count: jest.fn().mockResolvedValue(0),
      softDelete: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(),
    };

    storyRepository = { update: jest.fn().mockResolvedValue(undefined) };

    storyService = {
      findEditableOrFail: jest.fn().mockResolvedValue(
        Object.assign(new StorytimeStoryEntity(), {
          id: storyId,
          ownerUserId: ownerId,
          languageCode: 'en',
        }),
      ),
    };

    slugService = {
      generateUniqueSlug: jest.fn(async (request: SlugRequest) => {
        await request.isTakenByLiveEntity('candidate-slug');
        return 'chapter-one';
      }),
      recordRetiredSlug: jest.fn().mockResolvedValue(undefined),
    };

    limitService = {
      assertWithinLimit: jest.fn().mockResolvedValue(undefined),
    };

    progressService = {
      reopenCompletedReaders: jest.fn().mockResolvedValue(0),
    };

    dataSource = {
      transaction: jest.fn((callback: (m: typeof manager) => unknown) =>
        callback(manager),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeChapterService,
        {
          provide: getRepositoryToken(StorytimeChapterEntity),
          useValue: chapterRepository,
        },
        {
          provide: getRepositoryToken(StorytimeStoryEntity),
          useValue: storyRepository,
        },
        { provide: StorytimeStoryService, useValue: storyService },
        { provide: StorytimeSlugService, useValue: slugService },
        StorytimeOrderingService,
        StorytimeMarkdownService,
        { provide: LimitService, useValue: limitService },
        { provide: StorytimeProgressService, useValue: progressService },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<StorytimeChapterService>(StorytimeChapterService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('creates a Chapter in the Story', async () => {
      const created = await service.create(
        storyId,
        { title: 'Chapter One' },
        ownerId,
      );

      expect(created.storyId).toBe(storyId);
      expect(created.createdByUserId).toBe(ownerId);
    });

    // Ownership belongs to the Story, so it is asked of the Story rather than
    // re-derived here.
    it('refuses when the caller does not own the Story', async () => {
      storyService.findEditableOrFail.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.create(storyId, { title: 'Chapter One' }, ownerId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('places the first Chapter at the start', async () => {
      const created = await service.create(
        storyId,
        { title: 'Chapter One' },
        ownerId,
      );

      expect(created.orderIndex).toBe(1000);
    });

    it('places a later Chapter after the last', async () => {
      chapterRepository.findOne.mockResolvedValue(
        buildChapter({ orderIndex: 3000 }),
      );

      const created = await service.create(
        storyId,
        { title: 'Chapter Two' },
        ownerId,
      );

      expect(created.orderIndex).toBe(4000);
    });

    it('renders the content and derives the reading figures', async () => {
      const created = await service.create(
        storyId,
        {
          title: 'Chapter One',
          contentSource: '# Heading\n\nSome words here.',
        },
        ownerId,
      );

      expect(created.contentHtml).toContain('<h2');
      expect(created.wordCount).toBeGreaterThan(0);
      expect(created.estimatedReadingMinutes).toBe(1);
    });

    it('accepts a Chapter with no content yet', async () => {
      const created = await service.create(
        storyId,
        { title: 'Chapter One' },
        ownerId,
      );

      expect(created.contentSource).toBe('');
      expect(created.wordCount).toBe(0);
    });

    it('refuses when the Story is at its Chapter limit', async () => {
      limitService.assertWithinLimit.mockRejectedValue(
        new ForbiddenException('limit'),
      );

      await expect(
        service.create(storyId, { title: 'Chapter One' }, ownerId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a language that is not offered', async () => {
      await expect(
        service.create(
          storyId,
          { title: 'Chapter One', languageCode: 'xx' },
          ownerId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts an offered language', async () => {
      const created = await service.create(
        storyId,
        { title: 'Chapter One', languageCode: 'tlh' },
        ownerId,
      );

      expect(created.languageCode).toBe('tlh');
    });
  });

  describe('update', () => {
    beforeEach(() => {
      chapterRepository.findOne.mockResolvedValue(buildChapter());
    });

    it('applies the supplied changes', async () => {
      const updated = await service.update(
        chapterId,
        { synopsis: 'A summary' },
        ownerId,
      );

      expect(updated.synopsis).toBe('A summary');
      expect(updated.version).toBe(2);
    });

    it('rejects an update made from a stale copy', async () => {
      await expect(
        service.update(chapterId, { title: 'New', version: 0 }, ownerId),
      ).rejects.toThrow(ConflictException);
    });

    it('regenerates the rendered content and figures', async () => {
      const updated = await service.update(
        chapterId,
        { contentSource: '**bold** words here' },
        ownerId,
      );

      expect(updated.contentHtml).toContain('<strong>bold</strong>');
      expect(updated.wordCount).toBe(3);
    });

    it('records the old slug when the title changes', async () => {
      slugService.generateUniqueSlug.mockResolvedValue('a-new-slug');

      await service.update(chapterId, { title: 'A New Title' }, ownerId);

      expect(slugService.recordRetiredSlug).toHaveBeenCalledWith(
        expect.anything(),
        chapterId,
        'chapter-one',
        'a-new-slug',
        storyId,
      );
    });

    // A creator may tidy the URL without touching the title, so the existing
    // title has to be what the new slug is derived from.
    it('regenerates the slug from the existing title when only the slug changes', async () => {
      await service.update(chapterId, { slug: 'a-tidier-url' }, ownerId);

      expect(slugService.generateUniqueSlug).toHaveBeenCalledWith(
        expect.objectContaining({
          desiredSlug: 'a-tidier-url',
          title: 'Chapter One',
        }),
      );
    });

    // A Chapter renaming itself must not collide with the slug it already has.
    it('lets a Chapter keep its own slug when renaming', async () => {
      await service.update(chapterId, { title: 'A New Title' }, ownerId);

      const request = slugService.generateUniqueSlug.mock
        .calls[0][0] as SlugRequest;
      await request.isTakenByLiveEntity('candidate-slug');

      expect(chapterRepository.findOne).toHaveBeenCalledWith({
        where: {
          storyId,
          slug: 'candidate-slug',
          id: expect.anything(),
          deletedAt: expect.anything(),
        },
      });
    });

    it('accepts a language change to an offered language', async () => {
      const updated = await service.update(
        chapterId,
        { languageCode: 'de' },
        ownerId,
      );

      expect(updated.languageCode).toBe('de');
    });

    it('refuses a language change to one that is not offered', async () => {
      await expect(
        service.update(chapterId, { languageCode: 'xx' }, ownerId),
      ).rejects.toThrow(BadRequestException);
    });

    it('marks the Story as recently updated', async () => {
      await service.update(chapterId, { synopsis: 'x' }, ownerId);

      expect(storyRepository.update).toHaveBeenCalledWith(
        storyId,
        expect.objectContaining({ lastContentUpdateAt: expect.any(Date) }),
      );
    });
  });

  describe('findEditableOrFail', () => {
    it('returns a Chapter in a Story the caller owns', async () => {
      chapterRepository.findOne.mockResolvedValue(buildChapter());

      await expect(
        service.findEditableOrFail(chapterId, ownerId),
      ).resolves.toBeDefined();
    });

    it('throws when the Chapter does not exist', async () => {
      await expect(
        service.findEditableOrFail(chapterId, ownerId),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when the caller does not own the Story', async () => {
      chapterRepository.findOne.mockResolvedValue(buildChapter());
      storyService.findEditableOrFail.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.findEditableOrFail(chapterId, ownerId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('publish', () => {
    it('publishes a Chapter with content', async () => {
      chapterRepository.findOne.mockResolvedValue(buildChapter());

      const published = await service.publish(chapterId, ownerId);

      expect(published.status).toBe(ChapterStatus.PUBLISHED);
      expect(published.publishedAt).toBeInstanceOf(Date);
    });

    // The count decides whether the Story itself may be published, so it has
    // to move with the Chapter rather than drift.
    it('refreshes the Story published count in the same transaction', async () => {
      chapterRepository.findOne.mockResolvedValue(buildChapter());

      await service.publish(chapterId, ownerId);

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(manager.update).toHaveBeenCalledWith(
        StorytimeStoryEntity,
        storyId,
        expect.objectContaining({ publishedChapterCount: 1 }),
      );
    });

    it('clears any pending schedule', async () => {
      chapterRepository.findOne.mockResolvedValue(
        buildChapter({
          status: ChapterStatus.SCHEDULED,
          scheduledPublishAt: new Date('2030-01-01T00:00:00Z'),
        }),
      );

      const published = await service.publish(chapterId, ownerId);

      expect(published.scheduledPublishAt).toBeNull();
    });

    it('keeps the original publication date when republishing', async () => {
      const first = new Date('2026-01-01T00:00:00Z');
      chapterRepository.findOne.mockResolvedValue(
        buildChapter({ status: ChapterStatus.UNPUBLISHED, publishedAt: first }),
      );

      const published = await service.publish(chapterId, ownerId);

      expect(published.publishedAt).toBe(first);
    });

    it('does nothing when the Chapter is already published', async () => {
      chapterRepository.findOne.mockResolvedValue(
        buildChapter({ status: ChapterStatus.PUBLISHED }),
      );

      await service.publish(chapterId, ownerId);

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('refuses a Chapter with no content', async () => {
      chapterRepository.findOne.mockResolvedValue(
        buildChapter({ contentSource: '   ' }),
      );

      await expect(service.publish(chapterId, ownerId)).rejects.toThrow(
        /no content/,
      );
    });

    it('refuses a removed Chapter', async () => {
      chapterRepository.findOne.mockResolvedValue(
        buildChapter({ moderationStatus: StorytimeModerationStatus.REMOVED }),
      );

      await expect(service.publish(chapterId, ownerId)).rejects.toThrow(
        /removed by an administrator/,
      );
    });

    // Somebody who had finished the Story now has something left to read, so
    // it belongs back in their in-progress list rather than sitting in
    // "completed" where they would never look at it again.
    it('returns readers who had finished the Story to in progress', async () => {
      chapterRepository.findOne.mockResolvedValue(buildChapter());

      await service.publish(chapterId, ownerId);

      expect(progressService.reopenCompletedReaders).toHaveBeenCalledWith(
        storyId,
      );
    });

    // The Chapter is already saved and visible by this point, so failing the
    // creator's publish over reader bookkeeping would be the worse outcome.
    it.each([
      ['an Error', new Error('database unavailable')],
      ['a rejection that is not an Error', 'database gone'],
    ])(
      'publishes anyway when reopening readers fails with %s',
      async (_name, failure) => {
        chapterRepository.findOne.mockResolvedValue(buildChapter());
        progressService.reopenCompletedReaders.mockRejectedValue(failure);

        const published = await service.publish(chapterId, ownerId);

        expect(published.status).toBe(ChapterStatus.PUBLISHED);
      },
    );

    it('leaves readers alone when nothing was published', async () => {
      chapterRepository.findOne.mockResolvedValue(
        buildChapter({ status: ChapterStatus.PUBLISHED }),
      );

      await service.publish(chapterId, ownerId);

      expect(progressService.reopenCompletedReaders).not.toHaveBeenCalled();
    });
  });

  describe('unpublish', () => {
    it('withdraws a published Chapter and refreshes the count', async () => {
      chapterRepository.findOne.mockResolvedValue(
        buildChapter({ status: ChapterStatus.PUBLISHED }),
      );
      manager.count.mockResolvedValue(0);

      const result = await service.unpublish(chapterId, ownerId);

      expect(result.status).toBe(ChapterStatus.UNPUBLISHED);
      expect(manager.update).toHaveBeenCalledWith(
        StorytimeStoryEntity,
        storyId,
        expect.objectContaining({ publishedChapterCount: 0 }),
      );
    });

    it('does nothing when the Chapter is not published', async () => {
      chapterRepository.findOne.mockResolvedValue(buildChapter());

      await service.unpublish(chapterId, ownerId);

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('schedule', () => {
    it('schedules a Chapter for a future time', async () => {
      chapterRepository.findOne.mockResolvedValue(buildChapter());
      const when = new Date(Date.now() + 3_600_000);

      const scheduled = await service.schedule(chapterId, when, ownerId);

      expect(scheduled.status).toBe(ChapterStatus.SCHEDULED);
      expect(scheduled.scheduledPublishAt).toBe(when);
    });

    it('refuses a time in the past', async () => {
      chapterRepository.findOne.mockResolvedValue(buildChapter());

      await expect(
        service.schedule(chapterId, new Date(Date.now() - 1000), ownerId),
      ).rejects.toThrow(/must be in the future/);
    });

    it('refuses to schedule a Chapter with no content', async () => {
      chapterRepository.findOne.mockResolvedValue(
        buildChapter({ contentSource: '' }),
      );

      await expect(
        service.schedule(chapterId, new Date(Date.now() + 1000), ownerId),
      ).rejects.toThrow(/no content/);
    });
  });

  describe('publishDueChapters', () => {
    /**
     * Arranges the due-Chapter query to return the supplied Chapters.
     *
     * @param chapters - The Chapters that are due.
     */
    const arrangeDue = (chapters: StorytimeChapterEntity[]) => {
      const builder: DueQueryBuilderStub = {
        where: jest.fn((): DueQueryBuilderStub => builder),
        andWhere: jest.fn((): DueQueryBuilderStub => builder),
        getMany: jest.fn().mockResolvedValue(chapters),
      };
      chapterRepository.createQueryBuilder.mockReturnValue(builder);
    };

    it('publishes every Chapter that is due', async () => {
      arrangeDue([
        buildChapter({ id: 'a', status: ChapterStatus.SCHEDULED }),
        buildChapter({ id: 'b', status: ChapterStatus.SCHEDULED }),
      ]);

      await expect(service.publishDueChapters()).resolves.toBe(2);
    });

    it('publishes nothing when none are due', async () => {
      arrangeDue([]);

      await expect(service.publishDueChapters()).resolves.toBe(0);
    });

    // A rejection that is not an Error still has to be logged usefully.
    it('continues after a failure that is not an Error', async () => {
      arrangeDue([
        buildChapter({ id: 'a', status: ChapterStatus.SCHEDULED }),
        buildChapter({ id: 'b', status: ChapterStatus.SCHEDULED }),
      ]);
      dataSource.transaction
        .mockRejectedValueOnce('database gone')
        .mockImplementation((callback: (m: typeof manager) => unknown) =>
          callback(manager),
        );

      await expect(service.publishDueChapters()).resolves.toBe(1);
    });

    it('returns finished readers to in progress for each Story', async () => {
      arrangeDue([
        buildChapter({ id: 'a', status: ChapterStatus.SCHEDULED }),
        buildChapter({ id: 'b', status: ChapterStatus.SCHEDULED }),
      ]);

      await service.publishDueChapters();

      expect(progressService.reopenCompletedReaders).toHaveBeenCalledTimes(2);
      expect(progressService.reopenCompletedReaders).toHaveBeenCalledWith(
        storyId,
      );
    });

    // One failure must not strand the rest of the queue.
    it('continues after a Chapter fails to publish', async () => {
      arrangeDue([
        buildChapter({ id: 'a', status: ChapterStatus.SCHEDULED }),
        buildChapter({ id: 'b', status: ChapterStatus.SCHEDULED }),
      ]);
      dataSource.transaction
        .mockRejectedValueOnce(new Error('database unavailable'))
        .mockImplementation((callback: (m: typeof manager) => unknown) =>
          callback(manager),
        );

      await expect(service.publishDueChapters()).resolves.toBe(1);
    });
  });

  describe('findNeighbours', () => {
    const first = buildChapter({ id: 'first', orderIndex: 1000 });
    const middle = buildChapter({ id: 'middle', orderIndex: 2000 });
    const last = buildChapter({ id: 'last', orderIndex: 3000 });

    beforeEach(() => {
      chapterRepository.find.mockResolvedValue([first, middle, last]);
    });

    it('finds both neighbours in the middle of a Story', async () => {
      const neighbours = await service.findNeighbours(middle);

      expect(neighbours.previous?.id).toBe('first');
      expect(neighbours.next?.id).toBe('last');
    });

    it('reports no previous Chapter at the start', async () => {
      const neighbours = await service.findNeighbours(first);

      expect(neighbours.previous).toBeNull();
      expect(neighbours.next?.id).toBe('middle');
    });

    it('reports no next Chapter at the end', async () => {
      const neighbours = await service.findNeighbours(last);

      expect(neighbours.next).toBeNull();
    });

    // Navigation is built from readable Chapters only, so a draft between two
    // published ones is stepped over rather than leading to a dead end.
    it('reports nothing for a Chapter that is not readable', async () => {
      const neighbours = await service.findNeighbours(
        buildChapter({ id: 'draft' }),
      );

      expect(neighbours.previous).toBeNull();
      expect(neighbours.next).toBeNull();
    });
  });

  describe('findPublicBySlug', () => {
    it('returns a published Chapter', async () => {
      chapterRepository.findOne.mockResolvedValue(
        buildChapter({ status: ChapterStatus.PUBLISHED }),
      );

      await expect(
        service.findPublicBySlug(storyId, 'chapter-one'),
      ).resolves.toBeDefined();
    });

    it('hides a draft Chapter', async () => {
      chapterRepository.findOne.mockResolvedValue(buildChapter());

      await expect(
        service.findPublicBySlug(storyId, 'chapter-one'),
      ).resolves.toBeNull();
    });

    it('hides a removed Chapter', async () => {
      chapterRepository.findOne.mockResolvedValue(
        buildChapter({
          status: ChapterStatus.PUBLISHED,
          moderationStatus: StorytimeModerationStatus.REMOVED,
        }),
      );

      await expect(
        service.findPublicBySlug(storyId, 'chapter-one'),
      ).resolves.toBeNull();
    });

    it('reports nothing for an unknown slug', async () => {
      await expect(
        service.findPublicBySlug(storyId, 'nope'),
      ).resolves.toBeNull();
    });
  });

  describe('reorder', () => {
    beforeEach(() => {
      chapterRepository.find.mockResolvedValue([
        buildChapter({ id: 'a', orderIndex: 1000 }),
        buildChapter({ id: 'b', orderIndex: 2000 }),
      ]);
      chapterRepository.save.mockImplementation(input =>
        Promise.resolve(input),
      );
    });

    it('renumbers into the order given', async () => {
      const result = await service.reorder(storyId, ['b', 'a'], ownerId);
      const byId = new Map(result.map(chapter => [chapter.id, chapter]));

      expect(byId.get('b')?.orderIndex).toBe(1000);
      expect(byId.get('a')?.orderIndex).toBe(2000);
    });

    it('refuses a list that omits a Chapter', async () => {
      await expect(service.reorder(storyId, ['a'], ownerId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses a list naming an unknown Chapter', async () => {
      await expect(
        service.reorder(storyId, ['a', 'zzz'], ownerId),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a list containing duplicates', async () => {
      await expect(
        service.reorder(storyId, ['a', 'a'], ownerId),
      ).rejects.toThrow(/duplicates/);
    });
  });

  describe('remove', () => {
    it('soft-deletes and recounts the Story', async () => {
      chapterRepository.findOne.mockResolvedValue(
        buildChapter({ status: ChapterStatus.PUBLISHED }),
      );
      chapterRepository.count.mockResolvedValue(0);

      await service.remove(chapterId, ownerId);

      expect(chapterRepository.softDelete).toHaveBeenCalledWith(chapterId);
      expect(storyRepository.update).toHaveBeenCalledWith(
        storyId,
        expect.objectContaining({ publishedChapterCount: 0 }),
      );
    });
  });

  describe('recalculateStoryChapterCount', () => {
    it('counts only published, active Chapters', async () => {
      chapterRepository.count.mockResolvedValue(3);

      await expect(service.recalculateStoryChapterCount(storyId)).resolves.toBe(
        3,
      );
      expect(chapterRepository.count).toHaveBeenCalledWith({
        where: {
          storyId,
          status: ChapterStatus.PUBLISHED,
          moderationStatus: StorytimeModerationStatus.ACTIVE,
        },
      });
    });
  });
});
