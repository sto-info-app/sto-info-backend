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

  beforeEach(async () => {
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

      expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 10 });
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
  });

  describe('remove', () => {
    it('soft removes the post', async () => {
      const existing = { id: '1' } as NewsPostEntity;
      repository.findOne.mockResolvedValue(existing);

      await service.remove('1');

      expect(repository.softRemove).toHaveBeenCalledWith(existing);
    });
  });
});
