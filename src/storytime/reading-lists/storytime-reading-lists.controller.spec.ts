import { Test, TestingModule } from '@nestjs/testing';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeReadingListItemEntity } from './entities/storytime-reading-list-item.entity';
import { StorytimeReadingListEntity } from './entities/storytime-reading-list.entity';
import { StorytimeReadingListMapper } from './storytime-reading-list.mapper';
import {
  ReadingListEntry,
  StorytimeReadingListService,
} from './storytime-reading-list.service';
import { StorytimeReadingListsController } from './storytime-reading-lists.controller';

describe('StorytimeReadingListsController', () => {
  let controller: StorytimeReadingListsController;
  let service: {
    findMine: jest.Mock;
    findOwned: jest.Mock;
    findEntries: jest.Mock;
    findListsHolding: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    addItem: jest.Mock;
    removeItem: jest.Mock;
    reorder: jest.Mock;
  };

  const ownerId = 'a0000000-0000-4000-8000-000000000001';
  const listId = 'b0000000-0000-4000-8000-000000000001';
  const storyId = 'c0000000-0000-4000-8000-000000000001';
  const itemId = 'e0000000-0000-4000-8000-000000000001';

  const list = Object.assign(new StorytimeReadingListEntity(), {
    id: listId,
    ownerUserId: ownerId,
    name: 'Klingon favourites',
    slug: 'klingon-favourites',
    description: null,
    isPublic: false,
    itemCount: 1,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });

  const entry: ReadingListEntry = {
    item: Object.assign(new StorytimeReadingListItemEntity(), {
      id: itemId,
      note: null,
      orderIndex: 0,
    }),
    targetType: StorytimeTargetType.STORY,
    content: {
      id: storyId,
      title: 'The Long Patrol',
      slug: 'the-long-patrol',
      shortDescription: null,
    } as StorytimeStoryEntity,
  };

  beforeEach(async () => {
    service = {
      findMine: jest.fn().mockResolvedValue([list]),
      findOwned: jest.fn().mockResolvedValue(list),
      findEntries: jest.fn().mockResolvedValue([entry]),
      findListsHolding: jest.fn().mockResolvedValue([listId]),
      create: jest.fn().mockResolvedValue(list),
      update: jest.fn().mockResolvedValue(list),
      remove: jest.fn().mockResolvedValue(undefined),
      addItem: jest.fn().mockResolvedValue(entry.item),
      removeItem: jest.fn().mockResolvedValue(undefined),
      reorder: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorytimeReadingListsController],
      providers: [
        StorytimeReadingListMapper,
        { provide: StorytimeReadingListService, useValue: service },
      ],
    }).compile();

    controller = module.get<StorytimeReadingListsController>(
      StorytimeReadingListsController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('lists the caller’s own lists', async () => {
    const lists = await controller.findMine(ownerId);

    expect(service.findMine).toHaveBeenCalledWith(ownerId);
    expect(lists[0].name).toBe('Klingon favourites');
  });

  it('reports which of the caller’s lists hold something', async () => {
    await expect(
      controller.findHolding(StorytimeTargetType.STORY, storyId, ownerId),
    ).resolves.toEqual([listId]);
  });

  it('makes a list', async () => {
    const created = await controller.create(
      { name: 'Klingon favourites' },
      ownerId,
    );

    expect(service.create).toHaveBeenCalledWith(
      { name: 'Klingon favourites' },
      ownerId,
    );
    expect(created.id).toBe(listId);
  });

  it('reads a list and what is on it', async () => {
    const detail = await controller.findOne(listId, ownerId);

    expect(service.findOwned).toHaveBeenCalledWith(listId, ownerId);
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0].title).toBe('The Long Patrol');
  });

  it('changes a list', async () => {
    await controller.update(listId, { isPublic: true }, ownerId);

    expect(service.update).toHaveBeenCalledWith(
      listId,
      { isPublic: true },
      ownerId,
    );
  });

  it('deletes a list', async () => {
    await controller.remove(listId, ownerId);

    expect(service.remove).toHaveBeenCalledWith(listId, ownerId);
  });

  it('puts something on a list and returns the list', async () => {
    const detail = await controller.addItem(
      listId,
      {
        targetType: StorytimeTargetType.STORY,
        targetId: storyId,
        note: 'Worth a second read.',
      },
      ownerId,
    );

    expect(service.addItem).toHaveBeenCalledWith(
      listId,
      StorytimeTargetType.STORY,
      storyId,
      'Worth a second read.',
      ownerId,
    );
    expect(detail.items).toHaveLength(1);
  });

  it('adds something without a note', async () => {
    await controller.addItem(
      listId,
      { targetType: StorytimeTargetType.ARC, targetId: storyId },
      ownerId,
    );

    expect(service.addItem).toHaveBeenCalledWith(
      listId,
      StorytimeTargetType.ARC,
      storyId,
      null,
      ownerId,
    );
  });

  it('takes something off a list and returns what remains', async () => {
    const detail = await controller.removeItem(listId, itemId, ownerId);

    expect(service.removeItem).toHaveBeenCalledWith(listId, itemId, ownerId);
    expect(detail.id).toBe(listId);
  });

  it('puts a list in order and returns it', async () => {
    const detail = await controller.reorder(
      listId,
      { itemIds: [itemId] },
      ownerId,
    );

    expect(service.reorder).toHaveBeenCalledWith(listId, [itemId], ownerId);
    expect(detail.id).toBe(listId);
  });
});
