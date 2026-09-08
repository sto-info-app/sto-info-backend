import { HttpStatus, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import type { Response } from 'express';

import { StorytimeStoryArcsService } from '../arcs/storytime-story-arcs.service';
import { StorytimeAuthorService } from '../shared/storytime-author.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeTagEntity } from '../tags/entities/storytime-tag.entity';
import { StorytimeTagMapper } from '../tags/storytime-tag.mapper';
import { StorytimeTaggingService } from '../tags/storytime-tagging.service';
import { StoryDto } from './dto/story.dto';
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
  let authorService: { findAuthor: jest.Mock; findAuthors: jest.Mock };
  let storyArcsService: { findForStory: jest.Mock; findForStories: jest.Mock };
  let taggingService: { findFor: jest.Mock; findForMany: jest.Mock };
  let featureService: { assertFlagEnabled: jest.Mock };
  let response: { status: jest.Mock; setHeader: jest.Mock };

  const story = Object.assign(new StorytimeStoryEntity(), {
    id: 'story-1',
    slug: 'the-long-way-home',
    title: 'The Long Way Home',
    ownerUserId: 'user-1',
    upVoteCount: 0,
    downVoteCount: 0,
  });

  const arc = {
    id: 'arc-1',
    title: 'The Dominion Trilogy',
    slug: 'the-dominion-trilogy',
  };

  const tag = Object.assign(new StorytimeTagEntity(), {
    id: 'tag-1',
    slug: 'first-contact',
    name: 'First contact',
    description: null,
    category: 'THEME',
    displayOrder: 0,
  });

  beforeEach(async () => {
    storyService = {
      findPublicPaginated: jest
        .fn()
        .mockResolvedValue({ items: [story], total: 1, page: 1, pageSize: 12 }),
      findPublicBySlug: jest.fn().mockResolvedValue(null),
      findPublicByRetiredSlug: jest.fn().mockResolvedValue(null),
    };
    authorService = {
      findAuthor: jest.fn().mockResolvedValue({
        username: 'midniteshadow7',
        publiclyVisible: true,
      }),
      findAuthors: jest
        .fn()
        .mockResolvedValue(
          new Map([
            [
              story.ownerUserId,
              { username: 'midniteshadow7', publiclyVisible: true },
            ],
          ]),
        ),
    };
    storyArcsService = {
      findForStory: jest.fn().mockResolvedValue([arc]),
      findForStories: jest.fn().mockResolvedValue(new Map([[story.id, [arc]]])),
    };
    taggingService = {
      findFor: jest.fn().mockResolvedValue([tag]),
      findForMany: jest.fn().mockResolvedValue(new Map([[story.id, [tag]]])),
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
        { provide: StorytimeAuthorService, useValue: authorService },
        { provide: StorytimeStoryArcsService, useValue: storyArcsService },
        { provide: StorytimeTaggingService, useValue: taggingService },
        StorytimeTagMapper,
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

    // What a Story is about decides what a reader opens as much as its title
    // does, and one lookup for the page is what makes saying so affordable.
    it('names what each Story on the page is tagged with', async () => {
      const result = await controller.findAll({});

      expect(taggingService.findForMany).toHaveBeenCalledWith('STORY', [
        'story-1',
      ]);
      expect((result.items[0] as StoryDto).tags.map(each => each.name)).toEqual(
        ['First contact'],
      );
    });

    it('leaves an untagged Story with no tags rather than none of the page', async () => {
      taggingService.findForMany.mockResolvedValue(new Map());

      const result = await controller.findAll({});

      expect((result.items[0] as StoryDto).tags).toEqual([]);
    });

    // A listing that only says a Story exists leaves a reader to open each one
    // to find out whose it is. One lookup for the page is what makes naming
    // them affordable.
    it('names who wrote each Story on the page', async () => {
      const result = await controller.findAll({});

      expect(authorService.findAuthors).toHaveBeenCalledWith(['user-1']);
      expect((result.items[0] as StoryDto).author).toEqual({
        username: 'midniteshadow7',
        publiclyVisible: true,
      });
    });

    it('names the Arcs each Story on the page belongs to', async () => {
      const result = await controller.findAll({});

      expect(storyArcsService.findForStories).toHaveBeenCalledWith(['story-1']);
      expect((result.items[0] as StoryDto).arcs).toEqual([arc]);
    });

    // A Story whose author has closed their account, or that is in no Arc, is
    // still worth listing. Neither absence may cost the reader the page.
    it('lists a Story with no author and no Arc', async () => {
      authorService.findAuthors.mockResolvedValue(new Map());
      storyArcsService.findForStories.mockResolvedValue(new Map());

      const result = await controller.findAll({});

      expect((result.items[0] as StoryDto).author).toBeNull();
      expect((result.items[0] as StoryDto).arcs).toEqual([]);
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

    it('names what the Story is tagged with', async () => {
      storyService.findPublicBySlug.mockResolvedValue(story);

      const result = await controller.findOne(
        'the-long-way-home',
        response as unknown as Response,
      );

      expect(taggingService.findFor).toHaveBeenCalledWith('STORY', 'story-1');
      expect(result?.tags.map(each => each.name)).toEqual(['First contact']);
    });

    it('names the Arcs the Story belongs to', async () => {
      storyService.findPublicBySlug.mockResolvedValue(story);

      const result = await controller.findOne(
        'the-long-way-home',
        response as unknown as Response,
      );

      expect(storyArcsService.findForStory).toHaveBeenCalledWith('story-1');
      expect(result?.arcs).toEqual([arc]);
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
