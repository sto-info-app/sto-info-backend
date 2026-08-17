import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StorytimeArcService } from '../arcs/storytime-arc.service';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeReadingListItemEntity } from './entities/storytime-reading-list-item.entity';
import { StorytimeReadingListEntity } from './entities/storytime-reading-list.entity';
import {
  MAX_LIST_ITEMS,
  MAX_LIST_SLUG_ATTEMPTS,
  StorytimeReadingListService,
} from './storytime-reading-list.service';

describe('StorytimeReadingListService', () => {
  let service: StorytimeReadingListService;
  let listRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
  };
  let itemRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };
  let storyService: { findPublicByIds: jest.Mock };
  let arcService: { findPublicByIds: jest.Mock };

  const ownerId = 'a0000000-0000-4000-8000-000000000001';
  const strangerId = 'a0000000-0000-4000-8000-000000000002';
  const listId = 'b0000000-0000-4000-8000-000000000001';
  const storyId = 'c0000000-0000-4000-8000-000000000001';
  const arcId = 'd0000000-0000-4000-8000-000000000001';

  /**
   * Builds a list.
   *
   * @param overrides - What differs from an empty private list.
   * @returns The list.
   */
  const buildList = (
    overrides: Partial<StorytimeReadingListEntity> = {},
  ): StorytimeReadingListEntity =>
    Object.assign(new StorytimeReadingListEntity(), {
      id: listId,
      ownerUserId: ownerId,
      name: 'Klingon favourites',
      slug: 'klingon-favourites',
      description: null,
      isPublic: false,
      itemCount: 0,
      ...overrides,
    });

  /**
   * Builds an item.
   *
   * @param overrides - What differs from a listed Story.
   * @returns The item.
   */
  const buildItem = (
    overrides: Partial<StorytimeReadingListItemEntity> = {},
  ): StorytimeReadingListItemEntity =>
    Object.assign(new StorytimeReadingListItemEntity(), {
      id: 'e0000000-0000-4000-8000-000000000001',
      readingListId: listId,
      storyId,
      arcId: null,
      note: null,
      orderIndex: 0,
      ...overrides,
    });

  beforeEach(async () => {
    listRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(input =>
        Object.assign(new StorytimeReadingListEntity(), input),
      ),
      save: jest.fn(input => Promise.resolve(input)),
      softDelete: jest.fn().mockResolvedValue(undefined),
    };
    itemRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(input =>
        Object.assign(new StorytimeReadingListItemEntity(), input),
      ),
      save: jest.fn(input => Promise.resolve(input)),
      delete: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(0),
    };
    storyService = {
      findPublicByIds: jest
        .fn()
        .mockResolvedValue([
          { id: storyId, title: 'The Long Patrol', slug: 'the-long-patrol' },
        ]),
    };
    arcService = {
      findPublicByIds: jest
        .fn()
        .mockResolvedValue([
          { id: arcId, title: 'The Dominion War', slug: 'the-dominion-war' },
        ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeReadingListService,
        {
          provide: getRepositoryToken(StorytimeReadingListEntity),
          useValue: listRepository,
        },
        {
          provide: getRepositoryToken(StorytimeReadingListItemEntity),
          useValue: itemRepository,
        },
        { provide: StorytimeStoryService, useValue: storyService },
        { provide: StorytimeArcService, useValue: arcService },
      ],
    }).compile();

    service = module.get<StorytimeReadingListService>(
      StorytimeReadingListService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('makes a list its owner keeps', async () => {
      const created = await service.create(
        { name: 'Klingon favourites' },
        ownerId,
      );

      expect(created.ownerUserId).toBe(ownerId);
      expect(created.slug).toBe('klingon-favourites');
    });

    // A list is often a working note before it is a recommendation.
    it('keeps a new list private unless told otherwise', async () => {
      const created = await service.create({ name: 'Later' }, ownerId);

      expect(created.isPublic).toBe(false);
    });

    it('makes a public list when asked', async () => {
      const created = await service.create(
        { name: 'Later', isPublic: true },
        ownerId,
      );

      expect(created.isPublic).toBe(true);
    });

    it.each([
      ['nothing', undefined],
      ['an empty name', ''],
      ['only spaces', '   '],
    ])('refuses a list with %s for a name', async (_name, name) => {
      await expect(service.create({ name }, ownerId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('trims the name', async () => {
      const created = await service.create({ name: '  Later  ' }, ownerId);

      expect(created.name).toBe('Later');
    });

    // A name of nothing but punctuation still has to be reachable.
    it('falls back to a stem when the name carries no address', async () => {
      const created = await service.create({ name: '!!!' }, ownerId);

      expect(created.slug).toBe('list');
    });

    it('suffixes an address the owner already uses', async () => {
      listRepository.findOne
        .mockResolvedValueOnce(buildList())
        .mockResolvedValueOnce(null);

      const created = await service.create({ name: 'Later' }, ownerId);

      expect(created.slug).toBe('later-2');
    });

    // Hundreds of identically named lists is a script, not a reader.
    it('gives up rather than looping forever', async () => {
      listRepository.findOne.mockResolvedValue(buildList());

      await expect(service.create({ name: 'Later' }, ownerId)).rejects.toThrow(
        BadRequestException,
      );
      expect(listRepository.findOne).toHaveBeenCalledTimes(
        MAX_LIST_SLUG_ATTEMPTS,
      );
    });
  });

  describe('update', () => {
    beforeEach(() => {
      listRepository.findOne.mockResolvedValue(buildList());
    });

    it('renames a list and re-addresses it', async () => {
      listRepository.findOne
        .mockResolvedValueOnce(buildList())
        .mockResolvedValueOnce(null);

      const updated = await service.update(
        listId,
        { name: 'Cardassian favourites' },
        ownerId,
      );

      expect(updated.name).toBe('Cardassian favourites');
      expect(updated.slug).toBe('cardassian-favourites');
    });

    // Saving a form without touching the name should not move the list.
    it('leaves the address alone when the name is unchanged', async () => {
      const updated = await service.update(
        listId,
        { name: 'Klingon favourites' },
        ownerId,
      );

      expect(updated.slug).toBe('klingon-favourites');
    });

    it('refuses to empty the name', async () => {
      await expect(
        service.update(listId, { name: '  ' }, ownerId),
      ).rejects.toThrow(BadRequestException);
    });

    it('changes the description', async () => {
      const updated = await service.update(
        listId,
        { description: 'Things worth a second read.' },
        ownerId,
      );

      expect(updated.description).toBe('Things worth a second read.');
    });

    it('clears the description', async () => {
      const updated = await service.update(
        listId,
        { description: null },
        ownerId,
      );

      expect(updated.description).toBeNull();
    });

    it('publishes a list', async () => {
      const updated = await service.update(listId, { isPublic: true }, ownerId);

      expect(updated.isPublic).toBe(true);
    });

    it('leaves everything alone when nothing is sent', async () => {
      const updated = await service.update(listId, {}, ownerId);

      expect(updated.name).toBe('Klingon favourites');
      expect(updated.description).toBeNull();
      expect(updated.isPublic).toBe(false);
    });
  });

  describe('remove', () => {
    it('deletes a list', async () => {
      listRepository.findOne.mockResolvedValue(buildList());

      await service.remove(listId, ownerId);

      expect(listRepository.softDelete).toHaveBeenCalledWith(listId);
    });
  });

  describe('findOwned', () => {
    it('reports that an unknown list does not exist', async () => {
      await expect(service.findOwned(listId, ownerId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses somebody else’s list', async () => {
      listRepository.findOne.mockResolvedValue(buildList());

      await expect(service.findOwned(listId, strangerId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('finding lists', () => {
    it('lists what one member keeps, private ones included', async () => {
      await service.findMine(ownerId);

      expect(listRepository.find).toHaveBeenCalledWith({
        where: { ownerUserId: ownerId },
        order: { updatedAt: 'DESC' },
      });
    });

    it('lists only the public ones for anybody else', async () => {
      await service.findPublicByOwner(ownerId);

      expect(listRepository.find).toHaveBeenCalledWith({
        where: { ownerUserId: ownerId, isPublic: true },
        order: { updatedAt: 'DESC' },
      });
    });

    it('finds a public list by its address', async () => {
      await service.findPublicBySlug(ownerId, 'klingon-favourites');

      expect(listRepository.findOne).toHaveBeenCalledWith({
        where: {
          ownerUserId: ownerId,
          slug: 'klingon-favourites',
          isPublic: true,
        },
      });
    });
  });

  describe('findEntries', () => {
    it('reads an empty list without asking after anything', async () => {
      await expect(service.findEntries(listId)).resolves.toEqual([]);
      expect(storyService.findPublicByIds).not.toHaveBeenCalled();
      expect(arcService.findPublicByIds).not.toHaveBeenCalled();
    });

    it('resolves what a list points at', async () => {
      itemRepository.find.mockResolvedValue([
        buildItem(),
        buildItem({ id: 'item-2', storyId: null, arcId, orderIndex: 1 }),
      ]);

      const entries = await service.findEntries(listId);

      expect(entries).toHaveLength(2);
      expect(entries[0].targetType).toBe(StorytimeTargetType.STORY);
      expect(entries[0].content.title).toBe('The Long Patrol');
      expect(entries[1].targetType).toBe(StorytimeTargetType.ARC);
      expect(entries[1].content.title).toBe('The Dominion War');
    });

    // A recommendation that outlives the thing recommended is worse than a
    // shorter list.
    it('leaves out what is no longer readable', async () => {
      itemRepository.find.mockResolvedValue([buildItem()]);
      storyService.findPublicByIds.mockResolvedValue([]);

      await expect(service.findEntries(listId)).resolves.toEqual([]);
    });

    it('asks only after the kinds a list actually holds', async () => {
      itemRepository.find.mockResolvedValue([buildItem()]);

      await service.findEntries(listId);

      expect(storyService.findPublicByIds).toHaveBeenCalledWith([storyId]);
      expect(arcService.findPublicByIds).not.toHaveBeenCalled();
    });

    it('asks only after Arcs for a list of Arcs', async () => {
      itemRepository.find.mockResolvedValue([
        buildItem({ storyId: null, arcId }),
      ]);

      await service.findEntries(listId);

      expect(arcService.findPublicByIds).toHaveBeenCalledWith([arcId]);
      expect(storyService.findPublicByIds).not.toHaveBeenCalled();
    });
  });

  describe('addItem', () => {
    beforeEach(() => {
      listRepository.findOne.mockResolvedValue(buildList());
    });

    it('puts a Story on a list', async () => {
      const item = await service.addItem(
        listId,
        StorytimeTargetType.STORY,
        storyId,
        'Worth a second read.',
        ownerId,
      );

      expect(item.storyId).toBe(storyId);
      expect(item.arcId).toBeNull();
      expect(item.note).toBe('Worth a second read.');
    });

    it('puts an Arc on a list', async () => {
      const item = await service.addItem(
        listId,
        StorytimeTargetType.ARC,
        arcId,
        null,
        ownerId,
      );

      expect(item.arcId).toBe(arcId);
      expect(item.storyId).toBeNull();
    });

    it('adds a new thing after everything already there', async () => {
      itemRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(buildItem({ orderIndex: 4 }));

      const item = await service.addItem(
        listId,
        StorytimeTargetType.STORY,
        storyId,
        null,
        ownerId,
      );

      expect(item.orderIndex).toBe(5);
    });

    // A list holding a thing twice is never what anybody meant.
    it('changes only the note when the thing is already listed', async () => {
      itemRepository.findOne.mockResolvedValue(buildItem());

      const item = await service.addItem(
        listId,
        StorytimeTargetType.STORY,
        storyId,
        'Actually, this one.',
        ownerId,
      );

      expect(item.note).toBe('Actually, this one.');
      expect(itemRepository.create).not.toHaveBeenCalled();
    });

    it('keeps the existing note when none is sent', async () => {
      itemRepository.findOne.mockResolvedValue(
        buildItem({ note: 'The original reason.' }),
      );

      const item = await service.addItem(
        listId,
        StorytimeTargetType.STORY,
        storyId,
        null,
        ownerId,
      );

      expect(item.note).toBe('The original reason.');
    });

    it('refuses something nobody can read', async () => {
      storyService.findPublicByIds.mockResolvedValue([]);

      await expect(
        service.addItem(
          listId,
          StorytimeTargetType.STORY,
          storyId,
          null,
          ownerId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it.each([
      StorytimeTargetType.CHAPTER,
      StorytimeTargetType.CHARACTER,
      StorytimeTargetType.COMMENT,
    ])('refuses to list a %s', async targetType => {
      arcService.findPublicByIds.mockResolvedValue([{ id: arcId }]);

      await expect(
        service.addItem(listId, targetType, arcId, null, ownerId),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses to overfill a list', async () => {
      listRepository.findOne.mockResolvedValue(
        buildList({ itemCount: MAX_LIST_ITEMS }),
      );

      await expect(
        service.addItem(
          listId,
          StorytimeTargetType.STORY,
          storyId,
          null,
          ownerId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // Counted from the rows rather than nudged, so it cannot drift.
    it('records how many things the list now holds', async () => {
      itemRepository.count.mockResolvedValue(3);

      await service.addItem(
        listId,
        StorytimeTargetType.STORY,
        storyId,
        null,
        ownerId,
      );

      expect(listRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ itemCount: 3 }),
      );
    });
  });

  describe('removeItem', () => {
    beforeEach(() => {
      listRepository.findOne.mockResolvedValue(buildList({ itemCount: 1 }));
    });

    it('takes something off a list', async () => {
      itemRepository.findOne.mockResolvedValue(buildItem());

      await service.removeItem(listId, buildItem().id, ownerId);

      expect(itemRepository.delete).toHaveBeenCalledWith(buildItem().id);
      expect(listRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ itemCount: 0 }),
      );
    });

    it('reports that something is not on the list', async () => {
      await expect(
        service.removeItem(listId, buildItem().id, ownerId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('reorder', () => {
    beforeEach(() => {
      listRepository.findOne.mockResolvedValue(buildList());
      itemRepository.find.mockResolvedValue([
        buildItem({ id: 'item-1' }),
        buildItem({ id: 'item-2' }),
      ]);
    });

    it('puts a list in the order asked for', async () => {
      await service.reorder(listId, ['item-2', 'item-1'], ownerId);

      expect(itemRepository.update).toHaveBeenCalledWith('item-2', {
        orderIndex: 0,
      });
      expect(itemRepository.update).toHaveBeenCalledWith('item-1', {
        orderIndex: 1,
      });
    });

    it.each([
      ['leaves something out', ['item-1']],
      ['names something twice', ['item-1', 'item-1']],
      ['names something not on the list', ['item-1', 'item-9']],
      ['names too much', ['item-1', 'item-2', 'item-3']],
    ])('refuses an order that %s', async (_name, itemIds) => {
      await expect(service.reorder(listId, itemIds, ownerId)).rejects.toThrow(
        BadRequestException,
      );
      expect(itemRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('findListsHolding', () => {
    it('reports nothing when the member keeps no lists', async () => {
      await expect(
        service.findListsHolding(StorytimeTargetType.STORY, storyId, ownerId),
      ).resolves.toEqual([]);
      expect(itemRepository.find).not.toHaveBeenCalled();
    });

    // Lets a reader see where a Story already sits, rather than discovering it
    // by adding it again.
    it('reports which lists already hold something', async () => {
      listRepository.find.mockResolvedValue([buildList()]);
      itemRepository.find.mockResolvedValue([buildItem()]);

      await expect(
        service.findListsHolding(StorytimeTargetType.STORY, storyId, ownerId),
      ).resolves.toEqual([listId]);
    });
  });
});
