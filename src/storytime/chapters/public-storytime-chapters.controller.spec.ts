import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeChapterEntity } from './entities/storytime-chapter.entity';
import { PublicStorytimeChaptersController } from './public-storytime-chapters.controller';
import { StorytimeChapterMapper } from './storytime-chapter.mapper';
import { StorytimeChapterService } from './storytime-chapter.service';

describe('PublicStorytimeChaptersController', () => {
  let controller: PublicStorytimeChaptersController;
  let chapterService: {
    findPublicByStory: jest.Mock;
    findPublicBySlug: jest.Mock;
    findNeighbours: jest.Mock;
  };
  let storyService: { findPublicBySlug: jest.Mock };
  let featureService: { assertFlagEnabled: jest.Mock };

  const story = Object.assign(new StorytimeStoryEntity(), {
    id: 'story-1',
    slug: 'a-story',
    languageCode: 'en',
  });

  const chapter = Object.assign(new StorytimeChapterEntity(), {
    id: 'chapter-1',
    storyId: 'story-1',
    slug: 'chapter-one',
    title: 'Chapter One',
    upVoteCount: 0,
    downVoteCount: 0,
    languageCode: null,
  });

  beforeEach(async () => {
    chapterService = {
      findPublicByStory: jest.fn().mockResolvedValue([chapter]),
      findPublicBySlug: jest.fn().mockResolvedValue(chapter),
      findNeighbours: jest
        .fn()
        .mockResolvedValue({ previous: null, next: null }),
    };
    storyService = { findPublicBySlug: jest.fn().mockResolvedValue(story) };
    featureService = {
      assertFlagEnabled: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicStorytimeChaptersController],
      providers: [
        { provide: StorytimeChapterService, useValue: chapterService },
        { provide: StorytimeStoryService, useValue: storyService },
        StorytimeChapterMapper,
        { provide: StorytimeFeatureService, useValue: featureService },
      ],
    }).compile();

    controller = module.get<PublicStorytimeChaptersController>(
      PublicStorytimeChaptersController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('lists the readable Chapters of a Story', async () => {
      await expect(controller.findAll('a-story')).resolves.toHaveLength(1);
    });

    // A published Chapter inside a private Story must stay unreachable, and
    // gating on the Story is the single check that guarantees it.
    it('refuses when the Story is not publicly readable', async () => {
      storyService.findPublicBySlug.mockResolvedValue(null);

      await expect(controller.findAll('a-story')).rejects.toThrow(
        NotFoundException,
      );
      expect(chapterService.findPublicByStory).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns the Chapter with its navigation', async () => {
      const result = await controller.findOne('a-story', 'chapter-one');

      expect(result.chapter.title).toBe('Chapter One');
      expect(result.previous).toBeNull();
      expect(result.next).toBeNull();
    });

    it('includes the neighbours when there are any', async () => {
      chapterService.findNeighbours.mockResolvedValue({
        previous: Object.assign(new StorytimeChapterEntity(), {
          slug: 'prologue',
          title: 'Prologue',
        }),
        next: Object.assign(new StorytimeChapterEntity(), {
          slug: 'chapter-two',
          title: 'Chapter Two',
        }),
      });

      const result = await controller.findOne('a-story', 'chapter-one');

      expect(result.previous).toEqual({
        slug: 'prologue',
        title: 'Prologue',
      });
      expect(result.next).toEqual({
        slug: 'chapter-two',
        title: 'Chapter Two',
      });
    });

    it('resolves the language from the Story', async () => {
      const result = await controller.findOne('a-story', 'chapter-one');

      expect(result.chapter.languageCode).toBe('en');
    });

    it('refuses when the Story is not readable', async () => {
      storyService.findPublicBySlug.mockResolvedValue(null);

      await expect(
        controller.findOne('a-story', 'chapter-one'),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses when the Chapter is not readable', async () => {
      chapterService.findPublicBySlug.mockResolvedValue(null);

      await expect(
        controller.findOne('a-story', 'chapter-one'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('when public reading is switched off', () => {
    beforeEach(() => {
      featureService.assertFlagEnabled.mockRejectedValue(
        new NotFoundException(),
      );
    });

    it('refuses the Chapter list', async () => {
      await expect(controller.findAll('a-story')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses a Chapter', async () => {
      await expect(
        controller.findOne('a-story', 'chapter-one'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
