import { HttpStatus, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeStoryEntity } from './entities/storytime-story.entity';
import { PublicStorytimeStoriesController } from './public-storytime-stories.controller';
import { StorytimeStoryMapper } from './storytime-story.mapper';
import { StorytimeStoryService } from './storytime-story.service';

describe('PublicStorytimeStoriesController', () => {
  let controller: PublicStorytimeStoriesController;
  let storyService: {
    findPublicPaginated: jest.Mock;
    findPublicBySlug: jest.Mock;
    findPublicByRetiredSlug: jest.Mock;
  };
  let featureService: { assertFlagEnabled: jest.Mock };
  let response: { status: jest.Mock; setHeader: jest.Mock };

  const story = Object.assign(new StorytimeStoryEntity(), {
    id: 'story-1',
    slug: 'the-long-way-home',
    title: 'The Long Way Home',
    upVoteCount: 0,
    downVoteCount: 0,
  });

  beforeEach(async () => {
    storyService = {
      findPublicPaginated: jest
        .fn()
        .mockResolvedValue({ items: [story], total: 1, page: 1, pageSize: 12 }),
      findPublicBySlug: jest.fn().mockResolvedValue(null),
      findPublicByRetiredSlug: jest.fn().mockResolvedValue(null),
    };
    featureService = {
      assertFlagEnabled: jest.fn().mockResolvedValue(undefined),
    };
    response = { status: jest.fn(), setHeader: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicStorytimeStoriesController],
      providers: [
        { provide: StorytimeStoryService, useValue: storyService },
        StorytimeStoryMapper,
        { provide: StorytimeFeatureService, useValue: featureService },
      ],
    }).compile();

    controller = module.get<PublicStorytimeStoriesController>(
      PublicStorytimeStoriesController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('returns a page of Stories', async () => {
      const result = await controller.findAll({});

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(12);
    });

    it('passes the query through', async () => {
      await controller.findAll({ languageCode: 'de' });

      expect(storyService.findPublicPaginated).toHaveBeenCalledWith({
        languageCode: 'de',
      });
    });
  });

  describe('findOne', () => {
    it('returns the Story for a current slug', async () => {
      storyService.findPublicBySlug.mockResolvedValue(story);

      const result = await controller.findOne(
        'the-long-way-home',
        response as unknown as Response,
      );

      expect(result?.slug).toBe('the-long-way-home');
      expect(response.status).not.toHaveBeenCalled();
    });

    // Links shared before a rename have to keep working, and a redirect lets
    // search engines consolidate rather than see duplicates.
    it('redirects permanently for a retired slug', async () => {
      storyService.findPublicByRetiredSlug.mockResolvedValue(story);

      const result = await controller.findOne(
        'an-older-name',
        response as unknown as Response,
      );

      expect(result).toBeUndefined();
      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.MOVED_PERMANENTLY,
      );
      expect(response.setHeader).toHaveBeenCalledWith(
        'Location',
        '/api/storytime/stories/the-long-way-home',
      );
    });

    it('escapes the slug it redirects to', async () => {
      storyService.findPublicByRetiredSlug.mockResolvedValue(
        Object.assign(new StorytimeStoryEntity(), {
          ...story,
          slug: 'a b',
        }),
      );

      await controller.findOne('old', response as unknown as Response);

      expect(response.setHeader).toHaveBeenCalledWith(
        'Location',
        '/api/storytime/stories/a%20b',
      );
    });

    it('reports not found when nothing matches', async () => {
      await expect(
        controller.findOne('nope', response as unknown as Response),
      ).rejects.toThrow(NotFoundException);
    });

    it('prefers a current slug over a retired one', async () => {
      storyService.findPublicBySlug.mockResolvedValue(story);
      storyService.findPublicByRetiredSlug.mockResolvedValue(story);

      await controller.findOne(
        'the-long-way-home',
        response as unknown as Response,
      );

      expect(storyService.findPublicByRetiredSlug).not.toHaveBeenCalled();
    });
  });

  describe('when public reading is switched off', () => {
    beforeEach(() => {
      featureService.assertFlagEnabled.mockRejectedValue(
        new NotFoundException(),
      );
    });

    it('refuses the listing', async () => {
      await expect(controller.findAll({})).rejects.toThrow(NotFoundException);
    });

    it('refuses a Story', async () => {
      await expect(
        controller.findOne('any', response as unknown as Response),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
