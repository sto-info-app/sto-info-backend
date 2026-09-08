import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeSlugHistoryEntity } from '../stories/entities/storytime-slug-history.entity';
import {
  MAX_SLUG_ATTEMPTS,
  SLUG_FALLBACK_STEM,
  StorytimeSlugService,
} from './storytime-slug.service';

describe('StorytimeSlugService', () => {
  let service: StorytimeSlugService;
  let historyRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };

  const storyId = 'e6d3a1b2-0000-4000-8000-000000000001';
  const targetId = 'e6d3a1b2-0000-4000-8000-000000000002';

  /** Availability test that reports every candidate as free. */
  const nothingTaken = jest.fn().mockResolvedValue(false);

  beforeEach(async () => {
    historyRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(input => input),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeSlugService,
        {
          provide: getRepositoryToken(StorytimeSlugHistoryEntity),
          useValue: historyRepository,
        },
      ],
    }).compile();

    service = module.get<StorytimeSlugService>(StorytimeSlugService);
    nothingTaken.mockClear();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateUniqueSlug', () => {
    it('derives a slug from the title', async () => {
      await expect(
        service.generateUniqueSlug({
          title: 'The Long Way Home',
          targetType: StorytimeTargetType.STORY,
          isTakenByLiveEntity: nothingTaken,
        }),
      ).resolves.toBe('the-long-way-home');
    });

    it('prefers a slug the creator typed', async () => {
      await expect(
        service.generateUniqueSlug({
          desiredSlug: 'my-own-slug',
          title: 'The Long Way Home',
          targetType: StorytimeTargetType.STORY,
          isTakenByLiveEntity: nothingTaken,
        }),
      ).resolves.toBe('my-own-slug');
    });

    it('normalises a slug the creator typed', async () => {
      await expect(
        service.generateUniqueSlug({
          desiredSlug: 'My Own Slug!!',
          title: 'Ignored',
          targetType: StorytimeTargetType.STORY,
          isTakenByLiveEntity: nothingTaken,
        }),
      ).resolves.toBe('my-own-slug');
    });

    it('falls back to the title when the typed slug normalises away', async () => {
      await expect(
        service.generateUniqueSlug({
          desiredSlug: '!!!',
          title: 'The Long Way Home',
          targetType: StorytimeTargetType.STORY,
          isTakenByLiveEntity: nothingTaken,
        }),
      ).resolves.toBe('the-long-way-home');
    });

    // A Story still has to be addressable even if its title carries no
    // characters a URL can use.
    it('falls back to a stem when the title normalises away', async () => {
      await expect(
        service.generateUniqueSlug({
          title: '!!! ???',
          targetType: StorytimeTargetType.STORY,
          isTakenByLiveEntity: nothingTaken,
        }),
      ).resolves.toBe(SLUG_FALLBACK_STEM);
    });

    it('suffixes a counter when the slug is already live', async () => {
      const isTaken = jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValue(false);

      await expect(
        service.generateUniqueSlug({
          title: 'The Long Way Home',
          targetType: StorytimeTargetType.STORY,
          isTakenByLiveEntity: isTaken,
        }),
      ).resolves.toBe('the-long-way-home-2');
    });

    it('keeps counting past repeated collisions', async () => {
      const isTaken = jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValue(false);

      await expect(
        service.generateUniqueSlug({
          title: 'Repeat',
          targetType: StorytimeTargetType.STORY,
          isTakenByLiveEntity: isTaken,
        }),
      ).resolves.toBe('repeat-3');
    });

    // An old link must never start resolving to unrelated content.
    it('refuses a slug that another entity has retired', async () => {
      historyRepository.findOne.mockResolvedValueOnce({ targetId });

      await expect(
        service.generateUniqueSlug({
          title: 'The Long Way Home',
          targetType: StorytimeTargetType.STORY,
          isTakenByLiveEntity: nothingTaken,
        }),
      ).resolves.toBe('the-long-way-home-2');
    });

    it('keeps the slug within the column width', async () => {
      const slug = await service.generateUniqueSlug({
        title: 'a'.repeat(400),
        targetType: StorytimeTargetType.STORY,
        isTakenByLiveEntity: nothingTaken,
      });

      expect(slug.length).toBeLessThanOrEqual(220);
    });

    it('keeps a suffixed slug within the column width', async () => {
      const isTaken = jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValue(false);

      const slug = await service.generateUniqueSlug({
        title: 'a'.repeat(400),
        targetType: StorytimeTargetType.STORY,
        isTakenByLiveEntity: isTaken,
      });

      expect(slug.length).toBeLessThanOrEqual(220);
      expect(slug.endsWith('-2')).toBe(true);
    });

    // Looping forever would be worse than failing.
    it('gives up rather than looping when everything is taken', async () => {
      const isTaken = jest.fn().mockResolvedValue(true);

      await expect(
        service.generateUniqueSlug({
          title: 'Busy',
          targetType: StorytimeTargetType.STORY,
          isTakenByLiveEntity: isTaken,
        }),
      ).rejects.toThrow(/after 200 attempts/);
      expect(isTaken).toHaveBeenCalledTimes(MAX_SLUG_ATTEMPTS);
    });

    it('scopes the retired-slug check to the Story for Chapters', async () => {
      await service.generateUniqueSlug({
        title: 'Chapter One',
        targetType: StorytimeTargetType.CHAPTER,
        storyId,
        isTakenByLiveEntity: nothingTaken,
      });

      expect(historyRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            targetType: StorytimeTargetType.CHAPTER,
            storyId,
          }),
        }),
      );
    });
  });

  describe('recordRetiredSlug', () => {
    it('records the previous slug', async () => {
      await service.recordRetiredSlug(
        StorytimeTargetType.STORY,
        targetId,
        'old-slug',
        'new-slug',
      );

      expect(historyRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          targetType: StorytimeTargetType.STORY,
          targetId,
          slug: 'old-slug',
          storyId: null,
        }),
      );
    });

    it('scopes a Chapter slug to its Story', async () => {
      await service.recordRetiredSlug(
        StorytimeTargetType.CHAPTER,
        targetId,
        'old',
        'new',
        storyId,
      );

      expect(historyRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ storyId }),
      );
    });

    // Callers invoke this on every update without checking first.
    it('does nothing when the slug has not changed', async () => {
      await service.recordRetiredSlug(
        StorytimeTargetType.STORY,
        targetId,
        'same-slug',
        'same-slug',
      );

      expect(historyRepository.save).not.toHaveBeenCalled();
    });

    // A slug can be retired, reclaimed, and retired again.
    it('does not record the same retired slug twice', async () => {
      historyRepository.findOne.mockResolvedValue({ targetId });

      await service.recordRetiredSlug(
        StorytimeTargetType.STORY,
        targetId,
        'old-slug',
        'new-slug',
      );

      expect(historyRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('findByRetiredSlug', () => {
    it('finds the entity that used the slug', async () => {
      historyRepository.findOne.mockResolvedValue({ targetId });

      await expect(
        service.findByRetiredSlug(StorytimeTargetType.STORY, 'old-slug'),
      ).resolves.toBe(targetId);
    });

    it('reports nothing when the slug was never used', async () => {
      await expect(
        service.findByRetiredSlug(StorytimeTargetType.STORY, 'never-used'),
      ).resolves.toBeNull();
    });

    // A slug retired more than once belongs to whoever gave it up last.
    it('prefers the most recently retired match', async () => {
      historyRepository.findOne.mockResolvedValue({ targetId });

      await service.findByRetiredSlug(StorytimeTargetType.STORY, 'old-slug');

      expect(historyRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ order: { replacedAt: 'DESC' } }),
      );
    });
  });
});
