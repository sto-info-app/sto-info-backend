import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeReadingListItemEntity } from './entities/storytime-reading-list-item.entity';
import { StorytimeReadingListEntity } from './entities/storytime-reading-list.entity';
import { PublicStorytimeReadingListsController } from './public-storytime-reading-lists.controller';
import { StorytimeReadingListMapper } from './storytime-reading-list.mapper';
import {
  ReadingListEntry,
  StorytimeReadingListService,
} from './storytime-reading-list.service';

describe('PublicStorytimeReadingListsController', () => {
  let controller: PublicStorytimeReadingListsController;
  let service: {
    findPublicByOwner: jest.Mock;
    findPublicBySlug: jest.Mock;
    findEntries: jest.Mock;
  };
  let featureService: { assertFlagEnabled: jest.Mock };

  const ownerId = 'a0000000-0000-4000-8000-000000000001';

  const list = Object.assign(new StorytimeReadingListEntity(), {
    id: 'b0000000-0000-4000-8000-000000000001',
    ownerUserId: ownerId,
    name: 'Klingon favourites',
    slug: 'klingon-favourites',
    description: null,
    isPublic: true,
    itemCount: 1,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });

  const entry: ReadingListEntry = {
    item: Object.assign(new StorytimeReadingListItemEntity(), {
      id: 'e0000000-0000-4000-8000-000000000001',
      note: null,
      orderIndex: 0,
    }),
    targetType: StorytimeTargetType.STORY,
    content: {
      id: 'c0000000-0000-4000-8000-000000000001',
      title: 'The Long Patrol',
      slug: 'the-long-patrol',
      shortDescription: null,
    } as StorytimeStoryEntity,
  };

  beforeEach(async () => {
    service = {
      findPublicByOwner: jest.fn().mockResolvedValue([list]),
      findPublicBySlug: jest.fn().mockResolvedValue(list),
      findEntries: jest.fn().mockResolvedValue([entry]),
    };
    featureService = {
      assertFlagEnabled: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicStorytimeReadingListsController],
      providers: [
        StorytimeReadingListMapper,
        { provide: StorytimeReadingListService, useValue: service },
        { provide: StorytimeFeatureService, useValue: featureService },
      ],
    }).compile();

    controller = module.get<PublicStorytimeReadingListsController>(
      PublicStorytimeReadingListsController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('lists a member’s public lists', async () => {
    const lists = await controller.findByOwner(ownerId);

    expect(service.findPublicByOwner).toHaveBeenCalledWith(ownerId);
    expect(lists[0].slug).toBe('klingon-favourites');
  });

  it('reads a public list and what is on it', async () => {
    const detail = await controller.findOne(ownerId, 'klingon-favourites');

    expect(service.findPublicBySlug).toHaveBeenCalledWith(
      ownerId,
      'klingon-favourites',
    );
    expect(detail.items).toHaveLength(1);
  });

  // That somebody keeps a list at all is theirs to disclose, so a private one
  // is not found rather than forbidden.
  it('reports nothing at the address of a private list', async () => {
    service.findPublicBySlug.mockResolvedValue(null);

    await expect(controller.findOne(ownerId, 'private')).rejects.toThrow(
      NotFoundException,
    );
  });

  it.each([
    ['listing', () => controller.findByOwner(ownerId)],
    ['reading', () => controller.findOne(ownerId, 'klingon-favourites')],
  ])('checks that public reading is switched on before %s', async (_n, act) => {
    await act();

    expect(featureService.assertFlagEnabled).toHaveBeenCalledWith(
      STORYTIME_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
    );
  });
});
