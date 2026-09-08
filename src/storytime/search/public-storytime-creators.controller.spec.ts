import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeArcMapper } from '../arcs/storytime-arc.mapper';
import { StorytimeArcService } from '../arcs/storytime-arc.service';
import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryMapper } from '../stories/storytime-story.mapper';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeTagEntity } from '../tags/entities/storytime-tag.entity';
import { StorytimeTagMapper } from '../tags/storytime-tag.mapper';
import { StorytimeTaggingService } from '../tags/storytime-tagging.service';
import { PublicStorytimeCreatorsController } from './public-storytime-creators.controller';

describe('PublicStorytimeCreatorsController', () => {
  let controller: PublicStorytimeCreatorsController;
  let storyService: { findPublicPaginated: jest.Mock };
  let arcService: { findPublicByOwner: jest.Mock };
  let featureService: { assertFlagEnabled: jest.Mock };
  let taggingService: { findForMany: jest.Mock };

  const userId = 'e6d3a1b2-0000-4000-8000-000000000001';

  const tag = Object.assign(new StorytimeTagEntity(), {
    id: 'tag-1',
    slug: 'war',
    name: 'War',
    description: null,
    category: 'THEME',
    displayOrder: 0,
  });

  beforeEach(async () => {
    storyService = {
      findPublicPaginated: jest.fn().mockResolvedValue({
        items: [
          Object.assign(new StorytimeStoryEntity(), {
            id: 'story-1',
            slug: 'a-story',
            title: 'A Story',
            upVoteCount: 0,
            downVoteCount: 0,
          }),
        ],
        total: 1,
        page: 1,
        pageSize: 12,
      }),
    };
    arcService = {
      findPublicByOwner: jest.fn().mockResolvedValue([
        Object.assign(new StorytimeArcEntity(), {
          id: 'arc-1',
          slug: 'the-long-war',
          title: 'The Long War',
          upVoteCount: 0,
          downVoteCount: 0,
        }),
      ]),
    };
    taggingService = {
      findForMany: jest
        .fn()
        .mockImplementation((targetType: string) =>
          Promise.resolve(
            targetType === 'STORY'
              ? new Map([['story-1', [tag]]])
              : new Map([['arc-1', [tag]]]),
          ),
        ),
    };
    featureService = {
      assertFlagEnabled: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicStorytimeCreatorsController],
      providers: [
        { provide: StorytimeStoryService, useValue: storyService },
        { provide: StorytimeArcService, useValue: arcService },
        StorytimeStoryMapper,
        StorytimeArcMapper,
        { provide: StorytimeTaggingService, useValue: taggingService },
        StorytimeTagMapper,
        { provide: StorytimeFeatureService, useValue: featureService },
      ],
    }).compile();

    controller = module.get<PublicStorytimeCreatorsController>(
      PublicStorytimeCreatorsController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('lists what the member has published', async () => {
    const work = await controller.findByCreator(userId);

    expect(work.stories[0].title).toBe('A Story');
    expect(work.arcs[0].title).toBe('The Long War');
  });

  // The creator page is a Story listing and an Arc listing, and says what each
  // work is about the way the other listings do.
  it('names what each Story and Arc is tagged with', async () => {
    const work = await controller.findByCreator(userId);

    expect(taggingService.findForMany).toHaveBeenCalledWith('STORY', [
      'story-1',
    ]);
    expect(taggingService.findForMany).toHaveBeenCalledWith('ARC', ['arc-1']);
    expect(work.stories[0].tags.map(each => each.name)).toEqual(['War']);
    expect(work.arcs[0].tags.map(each => each.name)).toEqual(['War']);
  });

  // The listing services own the rule about what "published" means, so asking
  // them is what stops the creator page drifting from the archive.
  it('asks for that member’s work specifically', async () => {
    await controller.findByCreator(userId);

    expect(storyService.findPublicPaginated).toHaveBeenCalledWith({
      ownerUserId: userId,
    });
    expect(arcService.findPublicByOwner).toHaveBeenCalledWith(userId);
  });

  it('answers with empty lists when they have published nothing', async () => {
    storyService.findPublicPaginated.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 12,
    });
    arcService.findPublicByOwner.mockResolvedValue([]);

    const work = await controller.findByCreator(userId);

    expect(work.stories).toEqual([]);
    expect(work.arcs).toEqual([]);
  });

  it('refuses when public reading is switched off', async () => {
    featureService.assertFlagEnabled.mockRejectedValue(
      new ForbiddenException(),
    );

    await expect(controller.findByCreator(userId)).rejects.toThrow(
      ForbiddenException,
    );
    expect(featureService.assertFlagEnabled).toHaveBeenCalledWith(
      STORYTIME_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
    );
  });
});
