import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { PublicStorytimeSearchController } from './public-storytime-search.controller';
import { StorytimeSearchService } from './storytime-search.service';

describe('PublicStorytimeSearchController', () => {
  let controller: PublicStorytimeSearchController;
  let searchService: { search: jest.Mock };
  let featureService: { assertFlagEnabled: jest.Mock };

  beforeEach(async () => {
    searchService = {
      search: jest.fn().mockResolvedValue({
        items: [
          {
            targetType: StorytimeTargetType.STORY,
            id: 'story-1',
            slug: 'voyager-home',
            title: 'Voyager Home',
            summary: 'A summary',
            storySlug: null,
            rank: 0.6,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
        countsByType: { STORY: 1 },
      }),
    };
    featureService = {
      assertFlagEnabled: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicStorytimeSearchController],
      providers: [
        { provide: StorytimeSearchService, useValue: searchService },
        { provide: StorytimeFeatureService, useValue: featureService },
      ],
    }).compile();

    controller = module.get<PublicStorytimeSearchController>(
      PublicStorytimeSearchController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('answers with what was found', async () => {
    const results = await controller.search({ q: 'voyager' });

    expect(results.items).toHaveLength(1);
    expect(results.items[0].title).toBe('Voyager Home');
    expect(results.countsByType).toEqual({ STORY: 1 });
  });

  it('passes the query through untouched', async () => {
    await controller.search({
      q: 'voyager',
      types: [StorytimeTargetType.ARC],
      page: 2,
    });

    expect(searchService.search).toHaveBeenCalledWith({
      q: 'voyager',
      types: [StorytimeTargetType.ARC],
      page: 2,
    });
  });

  // The rank ordered the results and means nothing to a reader; returning it
  // would only invite a client to render it.
  it('keeps the rank out of the response', async () => {
    const results = await controller.search({ q: 'voyager' });

    expect(
      results.items[0] as unknown as Record<string, unknown>,
    ).not.toHaveProperty('rank');
  });

  it('refuses when public reading is switched off', async () => {
    featureService.assertFlagEnabled.mockRejectedValue(
      new ForbiddenException(),
    );

    await expect(controller.search({ q: 'voyager' })).rejects.toThrow(
      ForbiddenException,
    );
    expect(featureService.assertFlagEnabled).toHaveBeenCalledWith(
      STORYTIME_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
    );
  });
});
