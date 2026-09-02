import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { StorytimeArcMapper } from '../arcs/storytime-arc.mapper';
import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { SpotlightEntityType } from '../enums/spotlight-entity-type.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryMapper } from '../stories/storytime-story.mapper';
import { StorytimeTagMapper } from '../tags/storytime-tag.mapper';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeSpotlightEntity } from './entities/storytime-spotlight.entity';
import { PublicStorytimeSpotlightController } from './public-storytime-spotlight.controller';
import { StorytimeSpotlightMapper } from './storytime-spotlight.mapper';
import { StorytimeSpotlightService } from './storytime-spotlight.service';

describe('PublicStorytimeSpotlightController', () => {
  let controller: PublicStorytimeSpotlightController;
  let spotlightService: {
    findShowing: jest.Mock;
    findArchive: jest.Mock;
    findBySlug: jest.Mock;
  };
  let featureService: { assertFlagEnabled: jest.Mock };

  const resolved = {
    entry: Object.assign(new StorytimeSpotlightEntity(), {
      id: 'spotlight-1',
      slug: 'a-fine-story',
      entityType: SpotlightEntityType.STORY,
      storyId: 'story-1',
      arcId: null,
      headline: 'A Fine Story',
      summary: 'Worth your evening.',
      selectionReason: null,
      overrideImageId: null,
      overrideImageAlt: null,
      startsAt: new Date('2026-06-01T00:00:00.000Z'),
      endsAt: null,
    }),
    story: Object.assign(new StorytimeStoryEntity(), {
      id: 'story-1',
      title: 'A Fine Story',
      slug: 'a-fine-story',
    }),
    arc: null,
    author: { username: 'Kira', publiclyVisible: true },
    tags: [],
  };

  beforeEach(async () => {
    spotlightService = {
      findShowing: jest.fn().mockResolvedValue([resolved]),
      findArchive: jest.fn().mockResolvedValue([resolved]),
      findBySlug: jest.fn().mockResolvedValue(resolved),
    };
    featureService = {
      assertFlagEnabled: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicStorytimeSpotlightController],
      providers: [
        { provide: StorytimeSpotlightService, useValue: spotlightService },
        StorytimeSpotlightMapper,
        StorytimeStoryMapper,
        StorytimeArcMapper,
        StorytimeTagMapper,
        { provide: StorytimeFeatureService, useValue: featureService },
      ],
    }).compile();

    controller = module.get<PublicStorytimeSpotlightController>(
      PublicStorytimeSpotlightController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('lists what is showing', async () => {
    const showing = await controller.findShowing();

    expect(showing).toHaveLength(1);
    expect(showing[0].story?.title).toBe('A Fine Story');
  });

  it('lists the archive', async () => {
    const past = await controller.findArchive();

    expect(past).toHaveLength(1);
    expect(spotlightService.findArchive).toHaveBeenCalled();
  });

  it('reads one entry', async () => {
    const entry = await controller.findOne('a-fine-story');

    expect(entry.headline).toBe('A Fine Story');
    expect(spotlightService.findBySlug).toHaveBeenCalledWith('a-fine-story');
  });

  it('reports a slug with nothing showing', async () => {
    spotlightService.findBySlug.mockResolvedValue(null);

    await expect(controller.findOne('nothing')).rejects.toThrow(
      NotFoundException,
    );
  });

  // Both switches apply: the Spotlight is a way of reading Storytime content.
  describe.each([
    ['public reading', STORYTIME_FEATURE_FLAGS.PUBLIC_READ_ENABLED],
    ['the Spotlight', STORYTIME_FEATURE_FLAGS.SPOTLIGHT_ENABLED],
  ])('when %s is switched off', (_name, flag) => {
    beforeEach(() => {
      featureService.assertFlagEnabled.mockImplementation(
        (requested: string) => {
          if (requested === flag) {
            throw new ForbiddenException();
          }

          return Promise.resolve();
        },
      );
    });

    it.each([
      ['findShowing', () => controller.findShowing()],
      ['findArchive', () => controller.findArchive()],
      ['findOne', () => controller.findOne('a-fine-story')],
    ])('refuses %s', async (_route, act) => {
      await expect(act()).rejects.toThrow(ForbiddenException);
    });
  });
});
