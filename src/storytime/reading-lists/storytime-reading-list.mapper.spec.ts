import { Test, TestingModule } from '@nestjs/testing';
import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeReadingListItemEntity } from './entities/storytime-reading-list-item.entity';
import { StorytimeReadingListEntity } from './entities/storytime-reading-list.entity';
import { StorytimeReadingListMapper } from './storytime-reading-list.mapper';
import { ReadingListEntry } from './storytime-reading-list.service';

describe('StorytimeReadingListMapper', () => {
  let mapper: StorytimeReadingListMapper;

  const updatedAt = new Date('2026-01-01T00:00:00.000Z');

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
      id: 'list-1',
      ownerUserId: 'reader-1',
      name: 'Klingon favourites',
      slug: 'klingon-favourites',
      description: null,
      isPublic: false,
      itemCount: 0,
      updatedAt,
      ...overrides,
    });

  /**
   * Builds an entry pointing at a Story.
   *
   * @param overrides - What differs from a plain listed Story.
   * @returns The entry.
   */
  const buildStoryEntry = (
    overrides: Partial<StorytimeReadingListItemEntity> = {},
  ): ReadingListEntry => ({
    item: Object.assign(new StorytimeReadingListItemEntity(), {
      id: 'item-1',
      note: null,
      orderIndex: 0,
      ...overrides,
    }),
    targetType: StorytimeTargetType.STORY,
    content: {
      id: 'story-1',
      title: 'The Long Patrol',
      slug: 'the-long-patrol',
      shortDescription: 'A patrol that went long.',
    } as StorytimeStoryEntity,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StorytimeReadingListMapper],
    }).compile();

    mapper = module.get<StorytimeReadingListMapper>(StorytimeReadingListMapper);
  });

  it('is defined', () => {
    expect(mapper).toBeDefined();
  });

  it('maps a list', () => {
    expect(mapper.toDto(buildList({ isPublic: true, itemCount: 2 }))).toEqual({
      id: 'list-1',
      ownerUserId: 'reader-1',
      name: 'Klingon favourites',
      slug: 'klingon-favourites',
      description: null,
      isPublic: true,
      itemCount: 2,
      updatedAt,
    });
  });

  it('maps several lists', () => {
    const dtos = mapper.toDtos([
      buildList(),
      buildList({ id: 'list-2', name: 'Later' }),
    ]);

    expect(dtos.map(dto => dto.id)).toEqual(['list-1', 'list-2']);
  });

  // Flattened so that no caller has to learn the difference between the two
  // kinds a list may hold.
  it('flattens a listed Story to its title and address', () => {
    expect(
      mapper.toItemDto(buildStoryEntry({ note: 'Worth a second read.' })),
    ).toEqual({
      id: 'item-1',
      targetType: StorytimeTargetType.STORY,
      targetId: 'story-1',
      title: 'The Long Patrol',
      slug: 'the-long-patrol',
      shortDescription: 'A patrol that went long.',
      note: 'Worth a second read.',
      orderIndex: 0,
    });
  });

  it('flattens a listed Arc the same way', () => {
    const entry: ReadingListEntry = {
      item: Object.assign(new StorytimeReadingListItemEntity(), {
        id: 'item-2',
        note: null,
        orderIndex: 1,
      }),
      targetType: StorytimeTargetType.ARC,
      content: {
        id: 'arc-1',
        title: 'The Dominion War',
        slug: 'the-dominion-war',
        shortDescription: null,
      } as StorytimeArcEntity,
    };

    expect(mapper.toItemDto(entry)).toEqual(
      expect.objectContaining({
        targetType: StorytimeTargetType.ARC,
        targetId: 'arc-1',
        shortDescription: null,
      }),
    );
  });

  it('maps a list with what is on it', () => {
    const detail = mapper.toDetailDto(buildList({ itemCount: 1 }), [
      buildStoryEntry(),
    ]);

    expect(detail.id).toBe('list-1');
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0].title).toBe('The Long Patrol');
  });

  it('maps an empty list', () => {
    expect(mapper.toDetailDto(buildList(), []).items).toEqual([]);
  });
});
