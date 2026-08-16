import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeChapterService } from '../chapters/storytime-chapter.service';
import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { MediaProvider } from '../enums/media-provider.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeChapterMediaEntity } from './entities/storytime-chapter-media.entity';
import { PublicStorytimeMediaController } from './public-storytime-media.controller';
import { StorytimeMediaMapper } from './storytime-media.mapper';
import { StorytimeMediaService } from './storytime-media.service';

describe('PublicStorytimeMediaController', () => {
  let controller: PublicStorytimeMediaController;
  let mediaService: { findByChapter: jest.Mock };
  let chapterService: { findPublicBySlug: jest.Mock };
  let storyService: { findPublicBySlug: jest.Mock };
  let featureService: {
    assertFlagEnabled: jest.Mock;
    isFlagEnabled: jest.Mock;
  };

  const media = Object.assign(new StorytimeChapterMediaEntity(), {
    id: 'media-1',
    chapterId: 'chapter-1',
    provider: MediaProvider.YOUTUBE,
    externalId: 'dQw4w9WgXcQ',
    playlistId: null,
    startSeconds: null,
    endSeconds: null,
    title: null,
    caption: null,
    orderIndex: 1000,
    isPrimary: false,
  });

  beforeEach(async () => {
    mediaService = { findByChapter: jest.fn().mockResolvedValue([media]) };
    chapterService = {
      findPublicBySlug: jest.fn().mockResolvedValue(
        Object.assign(new StorytimeChapterEntity(), {
          id: 'chapter-1',
          slug: 'chapter-one',
        }),
      ),
    };
    storyService = {
      findPublicBySlug: jest.fn().mockResolvedValue(
        Object.assign(new StorytimeStoryEntity(), {
          id: 'story-1',
          slug: 'a-story',
        }),
      ),
    };
    featureService = {
      assertFlagEnabled: jest.fn().mockResolvedValue(undefined),
      isFlagEnabled: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicStorytimeMediaController],
      providers: [
        { provide: StorytimeMediaService, useValue: mediaService },
        { provide: StorytimeChapterService, useValue: chapterService },
        { provide: StorytimeStoryService, useValue: storyService },
        StorytimeMediaMapper,
        { provide: StorytimeFeatureService, useValue: featureService },
      ],
    }).compile();

    controller = module.get<PublicStorytimeMediaController>(
      PublicStorytimeMediaController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('lists the videos on a published Chapter', async () => {
    const result = await controller.findAll('a-story', 'chapter-one');

    expect(result).toHaveLength(1);
    expect(result[0].embedUrl).toContain('youtube-nocookie.com');
  });

  // Media hangs off a Chapter, which hangs off a Story, so both gates have to
  // hold or a private Story's videos would be listable.
  it('refuses when no readable Story matches', async () => {
    storyService.findPublicBySlug.mockResolvedValue(null);

    await expect(controller.findAll('a-story', 'chapter-one')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('refuses when no readable Chapter matches', async () => {
    chapterService.findPublicBySlug.mockResolvedValue(null);

    await expect(controller.findAll('a-story', 'chapter-one')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('refuses when reading is switched off', async () => {
    featureService.assertFlagEnabled.mockRejectedValue(
      new ForbiddenException(),
    );

    await expect(controller.findAll('a-story', 'chapter-one')).rejects.toThrow(
      ForbiddenException,
    );
  });

  // A Chapter with its videos hidden is still a Chapter worth reading, so a
  // reader should meet an empty list rather than an error.
  describe('when embedding is switched off', () => {
    beforeEach(() => {
      featureService.isFlagEnabled.mockResolvedValue(false);
    });

    it('returns nothing rather than refusing', async () => {
      await expect(
        controller.findAll('a-story', 'chapter-one'),
      ).resolves.toEqual([]);
    });

    it('does not even look the videos up', async () => {
      await controller.findAll('a-story', 'chapter-one');

      expect(mediaService.findByChapter).not.toHaveBeenCalled();
      expect(featureService.isFlagEnabled).toHaveBeenCalledWith(
        STORYTIME_FEATURE_FLAGS.YOUTUBE_ENABLED,
      );
    });
  });
});
