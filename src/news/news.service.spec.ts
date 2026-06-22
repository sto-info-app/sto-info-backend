import { jest } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { NewsPostEntity } from './entities/news-post.entity';
import { NewsCategory } from './enums/news-category.enum';
import { NewsStatus } from './enums/news-status.enum';
import { NewsService } from './news.service';

describe('NewsService', () => {
  let service: NewsService;
  let repository: jest.Mocked<Repository<NewsPostEntity>>;
  let queryBuilder: {
    select: jest.Mock;
    addSelect: jest.Mock;
    where: jest.Mock;
    groupBy: jest.Mock;
    getRawMany: jest.Mock<
      () => Promise<Array<{ category: NewsCategory; count: string }>>
    >;
  };

  beforeEach(async () => {
    queryBuilder = {
      select: jest.fn(() => queryBuilder),
      addSelect: jest.fn(() => queryBuilder),
      where: jest.fn(() => queryBuilder),
      groupBy: jest.fn(() => queryBuilder),
      getRawMany: jest.fn(() =>
        Promise.resolve([] as Array<{ category: NewsCategory; count: string }>),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NewsService,
        {
          provide: getRepositoryToken(NewsPostEntity),
          useValue: {
            findAndCount: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            softRemove: jest.fn(),
            createQueryBuilder: jest.fn(() => queryBuilder),
          },
        },
      ],
    }).compile();

    service = module.get<NewsService>(NewsService);
    repository = module.get(getRepositoryToken(NewsPostEntity));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findPublished', () => {
    it('returns a page of published posts with defaults', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.findPublished({});

      expect(result).toEqual({
        items: [],
        total: 0,
        page: 1,
        pageSize: 10,
        categoryCounts: {},
      });
      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: NewsStatus.PUBLISHED },
          skip: 0,
          take: 10,
        }),
      );
    });

    it('clamps page size and applies category filter', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      await service.findPublished({
        page: 2,
        pageSize: 999,
        category: NewsCategory.RELEASE_NOTES,
      });

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: NewsStatus.PUBLISHED,
            category: NewsCategory.RELEASE_NOTES,
          },
          skip: 50,
          take: 50,
        }),
      );
    });

    it('maps grouped category counts into a record', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);
      queryBuilder.getRawMany.mockResolvedValueOnce([
        { category: NewsCategory.GENERAL, count: '3' },
        { category: NewsCategory.RELEASE_NOTES, count: '1' },
      ]);

      const result = await service.findPublished({});

      expect(result.categoryCounts).toEqual({
        [NewsCategory.GENERAL]: 3,
        [NewsCategory.RELEASE_NOTES]: 1,
      });
    });
  });

  describe('findPublishedBySlug', () => {
    it('returns the post when found', async () => {
      const post = { id: '1' } as NewsPostEntity;
      repository.findOne.mockResolvedValue(post);

      await expect(service.findPublishedBySlug('slug')).resolves.toBe(post);
    });

    it('throws when not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findPublishedBySlug('x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('generates a slug and stamps publishedAt when publishing', async () => {
      (repository.create as jest.Mock).mockImplementation(
        (value: unknown) => value,
      );
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.create(
        { title: 'Hello World', body: 'b', status: NewsStatus.PUBLISHED },
        'author-1',
      );

      expect(result.slug).toMatch(/^hello-world-/);
      expect(result.authorId).toBe('author-1');
      expect(result.publishedAt).toBeInstanceOf(Date);
    });

    it('uses provided slug and leaves publishedAt null for drafts', async () => {
      (repository.create as jest.Mock).mockImplementation(
        (value: unknown) => value,
      );
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.create(
        { title: 'T', body: 'b', slug: 'custom-slug' },
        'a',
      );

      expect(result.slug).toBe('custom-slug');
      expect(result.publishedAt).toBeNull();
    });

    it('trims provided slug', async () => {
      (repository.create as jest.Mock).mockImplementation(
        (value: unknown) => value,
      );
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.create(
        { title: 'T', body: 'b', slug: '  custom-slug  ' },
        'a',
      );

      expect(result.slug).toBe('custom-slug');
    });

    it('uses category from DTO', async () => {
      (repository.create as jest.Mock).mockImplementation(
        (value: unknown) => value,
      );
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.create(
        {
          title: 'T',
          body: 'b',
          category: NewsCategory.RELEASE_NOTES,
        },
        'a',
      );

      expect(result.category).toBe(NewsCategory.RELEASE_NOTES);
    });

    it('uses DRAFT status by default', async () => {
      (repository.create as jest.Mock).mockImplementation(
        (value: unknown) => value,
      );
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.create({ title: 'T', body: 'b' }, 'a');

      expect(result.status).toBe(NewsStatus.DRAFT);
    });

    it('uses provided summary or null', async () => {
      (repository.create as jest.Mock).mockImplementation(
        (value: unknown) => value,
      );
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.create(
        { title: 'T', body: 'b', summary: 'My summary' },
        'a',
      );

      expect(result.summary).toBe('My summary');
    });

    it('sets summary to null when not provided', async () => {
      (repository.create as jest.Mock).mockImplementation(
        (value: unknown) => value,
      );
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.create({ title: 'T', body: 'b' }, 'a');

      expect(result.summary).toBeNull();
    });

    it('translates duplicate slug errors into a conflict', async () => {
      (repository.create as jest.Mock).mockImplementation(
        (value: unknown) => value,
      );
      repository.save.mockRejectedValue(
        new QueryFailedError('q', [], new Error('duplicate key value')),
      );

      await expect(
        service.create({ title: 'T', body: 'b' }, 'a'),
      ).rejects.toThrow(ConflictException);
    });

    it('rethrows non-duplicate errors', async () => {
      (repository.create as jest.Mock).mockImplementation(
        (value: unknown) => value,
      );
      const error = new Error('some other error');
      repository.save.mockRejectedValue(error);

      await expect(
        service.create({ title: 'T', body: 'b' }, 'a'),
      ).rejects.toThrow(error);
    });

    it('removes leading and trailing hyphens from generated slug input', async () => {
      (repository.create as jest.Mock).mockImplementation(
        (value: unknown) => value,
      );
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.create(
        { title: '---Hello World---', body: 'b' },
        'author-2',
      );

      expect(result.slug).toMatch(/^hello-world-/);
      expect(result.slug).not.toContain('--hello-world');
    });

    it('falls back to suffix when slug base becomes empty after trimming', async () => {
      (repository.create as jest.Mock).mockImplementation(
        (value: unknown) => value,
      );
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.create(
        { title: '-----', body: 'b' },
        'author-3',
      );

      expect(result.slug).toMatch(/^[a-z0-9]+$/);
      expect(result.slug).not.toContain('-');
    });

    it('handles unicode and diacritics in title when generating slug', async () => {
      (repository.create as jest.Mock).mockImplementation(
        (value: unknown) => value,
      );
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.create(
        { title: 'Café Naïve Über', body: 'b' },
        'a',
      );

      expect(result.slug).toMatch(/^cafe-naive-uber-/);
    });

    it('handles special characters in title when generating slug', async () => {
      (repository.create as jest.Mock).mockImplementation(
        (value: unknown) => value,
      );
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.create(
        { title: 'Hello! @World# $Test%', body: 'b' },
        'a',
      );

      expect(result.slug).toMatch(/^hello-world-test-/);
    });

    it('truncates slug base to 240 characters', async () => {
      (repository.create as jest.Mock).mockImplementation(
        (value: unknown) => value,
      );
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const longTitle = 'A'.repeat(300);
      const result = await service.create({ title: longTitle, body: 'b' }, 'a');

      // slug base is truncated to 240 chars, then suffix is appended
      expect(result.slug.length).toBeGreaterThan(240);
      expect(result.slug).toMatch(/^a+-[a-z0-9]+$/);
    });
  });

  describe('findAllForAdmin', () => {
    it('returns all posts including drafts with defaults', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.findAllForAdmin({});

      expect(result).toEqual({
        items: [],
        total: 0,
        page: 1,
        pageSize: 10,
      });
      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          skip: 0,
          take: 10,
        }),
      );
    });

    it('applies category filter when provided', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAllForAdmin({
        category: NewsCategory.GENERAL,
        page: 2,
        pageSize: 25,
      });

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { category: NewsCategory.GENERAL },
          skip: 25,
          take: 25,
        }),
      );
    });

    it('clamps page size to max', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAllForAdmin({ pageSize: 999 });

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
        }),
      );
    });

    it('handles negative page gracefully', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAllForAdmin({ page: -5, pageSize: 10 });

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
        }),
      );
    });
  });

  describe('findOneById', () => {
    it('returns the post when found', async () => {
      const post = { id: '1' } as NewsPostEntity;
      repository.findOne.mockResolvedValue(post);

      const result = await service.findOneById('1');

      expect(result).toBe(post);
    });

    it('throws NotFoundException when not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findOneById('x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('clears publishedAt when reverting to draft', async () => {
      const existing = {
        id: '1',
        status: NewsStatus.PUBLISHED,
        publishedAt: new Date(),
      } as NewsPostEntity;
      repository.findOne.mockResolvedValue(existing);
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.update('1', { status: NewsStatus.DRAFT });

      expect(result.publishedAt).toBeNull();
    });

    it('updates title when provided', async () => {
      const existing = {
        id: '1',
        title: 'Old Title',
        slug: 'old-slug',
      } as NewsPostEntity;
      repository.findOne.mockResolvedValue(existing);
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.update('1', { title: 'New Title' });

      expect(result.title).toBe('New Title');
    });

    it('trims and updates slug when provided', async () => {
      const existing = {
        id: '1',
        slug: 'old-slug',
      } as NewsPostEntity;
      repository.findOne.mockResolvedValue(existing);
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.update('1', { slug: '  new-slug  ' });

      expect(result.slug).toBe('new-slug');
    });

    it('updates summary when provided', async () => {
      const existing = {
        id: '1',
        summary: 'Old summary',
      } as NewsPostEntity;
      repository.findOne.mockResolvedValue(existing);
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.update('1', { summary: 'New summary' });

      expect(result.summary).toBe('New summary');
    });

    it('updates summary when provided', async () => {
      const existing = {
        id: '1',
        summary: 'Old summary',
      } as NewsPostEntity;
      repository.findOne.mockResolvedValue(existing);
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.update('1', { summary: 'New summary' });

      expect(result.summary).toBe('New summary');
    });

    it('sets summary to null when null is passed via any-cast', async () => {
      const existing = {
        id: '1',
        summary: 'Old summary',
      } as NewsPostEntity;
      repository.findOne.mockResolvedValue(existing);
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.update('1', { summary: null as any });

      expect(result.summary).toBeNull();
    });

    it('leaves summary unchanged when not provided', async () => {
      const existing = {
        id: '1',
        summary: 'Old summary',
      } as NewsPostEntity;
      repository.findOne.mockResolvedValue(existing);
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.update('1', { body: 'New body' });

      expect(result.summary).toBe('Old summary');
    });

    it('updates body when provided', async () => {
      const existing = { id: '1', body: 'Old' } as NewsPostEntity;
      repository.findOne.mockResolvedValue(existing);
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.update('1', { body: 'New body' });

      expect(result.body).toBe('New body');
    });

    it('updates category when provided', async () => {
      const existing = {
        id: '1',
        category: NewsCategory.GENERAL,
      } as NewsPostEntity;
      repository.findOne.mockResolvedValue(existing);
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.update('1', {
        category: NewsCategory.RELEASE_NOTES,
      });

      expect(result.category).toBe(NewsCategory.RELEASE_NOTES);
    });

    it('sets publishedAt when transitioning to published', async () => {
      const now = new Date();
      const existing = {
        id: '1',
        status: NewsStatus.DRAFT,
        publishedAt: null,
      } as NewsPostEntity;
      repository.findOne.mockResolvedValue(existing);
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.update('1', {
        status: NewsStatus.PUBLISHED,
      });

      expect(result.publishedAt).toBeInstanceOf(Date);
      expect(result.publishedAt!.getTime()).toBeGreaterThanOrEqual(
        now.getTime(),
      );
    });

    it('preserves publishedAt when already published and transitioning within published state', async () => {
      const originalDate = new Date('2026-01-01');
      const existing = {
        id: '1',
        status: NewsStatus.PUBLISHED,
        publishedAt: originalDate,
      } as NewsPostEntity;
      repository.findOne.mockResolvedValue(existing);
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.update('1', { title: 'New Title' });

      expect(result.publishedAt).toBe(originalDate);
    });

    it('does not change status when status is unchanged', async () => {
      const existing = {
        id: '1',
        status: NewsStatus.PUBLISHED,
        publishedAt: new Date('2026-01-01'),
      } as NewsPostEntity;
      repository.findOne.mockResolvedValue(existing);
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.update('1', {
        status: NewsStatus.PUBLISHED,
      });

      expect(result.status).toBe(NewsStatus.PUBLISHED);
    });

    it('throws ConflictException for duplicate slug', async () => {
      const existing = {
        id: '1',
        slug: 'old-slug',
      } as NewsPostEntity;
      repository.findOne.mockResolvedValue(existing);
      repository.save.mockRejectedValue(
        new QueryFailedError('q', [], new Error('duplicate key value')),
      );

      await expect(
        service.update('1', { slug: 'duplicate-slug' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when post not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.update('nonexistent', { title: 'New' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('publish', () => {
    it('sets status and publishedAt', async () => {
      const existing = {
        id: '1',
        status: NewsStatus.DRAFT,
        publishedAt: null,
      } as NewsPostEntity;
      repository.findOne.mockResolvedValue(existing);
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.publish('1');

      expect(result.status).toBe(NewsStatus.PUBLISHED);
      expect(result.publishedAt).toBeInstanceOf(Date);
    });

    it('preserves existing publishedAt when already published', async () => {
      const publishedDate = new Date('2026-01-01');
      const existing = {
        id: '1',
        status: NewsStatus.PUBLISHED,
        publishedAt: publishedDate,
      } as NewsPostEntity;
      repository.findOne.mockResolvedValue(existing);
      (repository.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.publish('1');

      expect(result.publishedAt).toBe(publishedDate);
    });

    it('throws NotFoundException when post not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.publish('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('soft removes the post', async () => {
      const existing = { id: '1' } as NewsPostEntity;
      repository.findOne.mockResolvedValue(existing);

      await service.remove('1');

      expect(repository.softRemove).toHaveBeenCalledWith(existing);
    });

    it('throws NotFoundException when post not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.remove('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('private methods via public interface', () => {
    it('clampPageSize returns default when pageSize is 0', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      await service.findPublished({ pageSize: 0 });

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: DEFAULT_PAGE_SIZE }),
      );
    });

    it('clampPageSize returns default when pageSize is negative', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      await service.findPublished({ pageSize: -10 });

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: DEFAULT_PAGE_SIZE }),
      );
    });

    it('clampPageSize returns requested size when within range', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      await service.findPublished({ pageSize: 25 });

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 25 }),
      );
    });

    it('clampPageSize caps at maximum', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      await service.findPublished({ pageSize: 1000 });

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: MAX_PAGE_SIZE }),
      );
    });
  });
});

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
