import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, IsNull, Not, Repository } from 'typeorm';

import { normaliseToSlug } from '../../shared/utilities/slug.utility';
import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeArcService } from '../arcs/storytime-arc.service';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeReadingListItemEntity } from './entities/storytime-reading-list-item.entity';
import { StorytimeReadingListEntity } from './entities/storytime-reading-list.entity';

/** Used when a name reduces to nothing a URL can carry. */
export const LIST_SLUG_FALLBACK_STEM = 'list';

/**
 * How many suffixed candidates to try before giving up.
 *
 * Reaching this would mean one person keeps hundreds of identically named
 * lists, which is a script rather than a reader. Failing loudly beats looping.
 */
export const MAX_LIST_SLUG_ATTEMPTS = 100;

/** The most things one list may hold. */
export const MAX_LIST_ITEMS = 500;

/** What a caller sends to make or change a list. */
export interface ReadingListRequest {
  /** What the list is called. */
  name?: string;
  /** What the list is for. */
  description?: string | null;
  /** Whether anybody may read it. */
  isPublic?: boolean;
}

/** What a listed thing has in common, whichever kind it is. */
export type ListedContent = StorytimeStoryEntity | StorytimeArcEntity;

/** One thing on a list, with the content it points at. */
export interface ReadingListEntry {
  /** The item. */
  item: StorytimeReadingListItemEntity;
  /** Whether it is a Story or an Arc. */
  targetType: StorytimeTargetType.STORY | StorytimeTargetType.ARC;
  /** What it points at, as it stands now. */
  content: ListedContent;
}

/**
 * Reading lists: things a member has gathered, in the order they mean them.
 *
 * Only publicly readable Stories and Arcs may be listed, and what a list holds
 * is resolved when it is read rather than copied when it is added. A list is a
 * recommendation, and a recommendation that outlives the thing recommended is
 * worse than a shorter list.
 *
 * Chapters are deliberately not listable: a list of chapters drawn from
 * different Stories is a Story, and Storytime already has those.
 */
@Injectable()
export class StorytimeReadingListService {
  /**
   * Creates an instance of StorytimeReadingListService.
   *
   * @param _listRepository - Repository of lists.
   * @param _itemRepository - Repository of the things on them.
   * @param _storyService - Decides which Stories anybody may read.
   * @param _arcService - Decides which Arcs anybody may read.
   */
  constructor(
    @InjectRepository(StorytimeReadingListEntity)
    private readonly _listRepository: Repository<StorytimeReadingListEntity>,
    @InjectRepository(StorytimeReadingListItemEntity)
    private readonly _itemRepository: Repository<StorytimeReadingListItemEntity>,
    private readonly _storyService: StorytimeStoryService,
    private readonly _arcService: StorytimeArcService,
  ) {}

  /**
   * Makes a list.
   *
   * @param request - What it is called, and whether anybody may read it.
   * @param ownerUserId - Who keeps it.
   * @returns The list.
   * @throws BadRequestException when the name is empty.
   */
  async create(
    request: ReadingListRequest,
    ownerUserId: string,
  ): Promise<StorytimeReadingListEntity> {
    const name = this.requireName(request.name);

    return this._listRepository.save(
      this._listRepository.create({
        ownerUserId,
        name,
        slug: await this.generateSlug(name, ownerUserId),
        description: request.description ?? null,
        isPublic: request.isPublic ?? false,
        itemCount: 0,
      }),
    );
  }

  /**
   * Changes a list.
   *
   * Renaming re-addresses it. A list is reached from its owner's page rather
   * than from links pasted years ago, so the address follows the name rather
   * than the other way round.
   *
   * @param listId - The list.
   * @param request - What to change.
   * @param ownerUserId - Who is asking.
   * @returns The list as it now stands.
   * @throws BadRequestException when the name is emptied.
   */
  async update(
    listId: string,
    request: ReadingListRequest,
    ownerUserId: string,
  ): Promise<StorytimeReadingListEntity> {
    const list = await this.findOwned(listId, ownerUserId);

    if (request.name !== undefined) {
      const name = this.requireName(request.name);

      if (name !== list.name) {
        list.name = name;
        list.slug = await this.generateSlug(name, ownerUserId, listId);
      }
    }

    if (request.description !== undefined) {
      list.description = request.description ?? null;
    }

    if (request.isPublic !== undefined) {
      list.isPublic = request.isPublic;
    }

    return this._listRepository.save(list);
  }

  /**
   * Deletes a list.
   *
   * Soft, like everything else here, and the slug becomes free again because
   * the uniqueness is partial on deletion.
   *
   * @param listId - The list.
   * @param ownerUserId - Who is asking.
   */
  async remove(listId: string, ownerUserId: string): Promise<void> {
    const list = await this.findOwned(listId, ownerUserId);

    await this._listRepository.softDelete(list.id);
  }

  /**
   * Lists what one member keeps, private ones included.
   *
   * @param ownerUserId - The member.
   * @returns Their lists, most recently touched first.
   */
  findMine(ownerUserId: string): Promise<StorytimeReadingListEntity[]> {
    return this._listRepository.find({
      where: { ownerUserId },
      order: { updatedAt: 'DESC' },
    });
  }

  /**
   * Lists the public lists one member keeps.
   *
   * @param ownerUserId - The member.
   * @returns Their public lists, most recently touched first.
   */
  findPublicByOwner(
    ownerUserId: string,
  ): Promise<StorytimeReadingListEntity[]> {
    return this._listRepository.find({
      where: { ownerUserId, isPublic: true },
      order: { updatedAt: 'DESC' },
    });
  }

  /**
   * Finds a list its owner keeps.
   *
   * @param listId - The list.
   * @param ownerUserId - Who is asking.
   * @returns The list.
   * @throws NotFoundException when there is no such list.
   * @throws ForbiddenException when somebody else keeps it.
   */
  async findOwned(
    listId: string,
    ownerUserId: string,
  ): Promise<StorytimeReadingListEntity> {
    const list = await this._listRepository.findOne({ where: { id: listId } });

    if (!list) {
      throw new NotFoundException('That reading list does not exist.');
    }

    if (list.ownerUserId !== ownerUserId) {
      throw new ForbiddenException('That reading list is not yours.');
    }

    return list;
  }

  /**
   * Finds a public list by its owner and address.
   *
   * @param ownerUserId - Who keeps it.
   * @param slug - Its address.
   * @returns The list, or null when there is no public list there.
   */
  async findPublicBySlug(
    ownerUserId: string,
    slug: string,
  ): Promise<StorytimeReadingListEntity | null> {
    return this._listRepository.findOne({
      where: { ownerUserId, slug, isPublic: true },
    });
  }

  /**
   * Reads what is on a list.
   *
   * Content is resolved now rather than copied when it was added, and anything
   * no longer readable is left out. A list is a recommendation, and one that
   * outlives the thing recommended is worse than a shorter list.
   *
   * @param listId - The list.
   * @returns Its items, in order, with what each still points at.
   */
  async findEntries(listId: string): Promise<ReadingListEntry[]> {
    const items = await this._itemRepository.find({
      where: { readingListId: listId },
      order: { orderIndex: 'ASC', createdAt: 'ASC' },
    });

    if (items.length === 0) {
      return [];
    }

    const [stories, arcs] = await Promise.all([
      this.findStories(items),
      this.findArcs(items),
    ]);

    // One lookup for both kinds. Identifiers are unique across the two tables,
    // so nothing can collide, and it saves asking which kind an item is twice.
    const content = new Map<string, ListedContent>([...stories, ...arcs]);

    return items.flatMap(item => {
      // The check constraint guarantees exactly one of the two is set, so this
      // is an identifier on every row the database will accept.
      const targetId = (item.storyId ?? item.arcId) as string;
      const listed = content.get(targetId);

      // Anything no longer readable is simply left off, which is what makes a
      // list shrink rather than serve a link to nothing.
      return listed
        ? [
            {
              item,
              targetType: item.storyId
                ? StorytimeTargetType.STORY
                : StorytimeTargetType.ARC,
              content: listed,
            },
          ]
        : [];
    });
  }

  /**
   * Adds something to a list.
   *
   * Adding what is already there changes nothing but the note, because a list
   * holding a thing twice is never what anybody meant.
   *
   * @param listId - The list.
   * @param targetType - Whether it is a Story or an Arc.
   * @param targetId - The thing.
   * @param note - Why it is on the list.
   * @param ownerUserId - Who is asking.
   * @returns The item.
   * @throws BadRequestException when the list is full or the thing is not
   *   something anybody may read.
   */
  async addItem(
    listId: string,
    targetType: StorytimeTargetType,
    targetId: string,
    note: string | null,
    ownerUserId: string,
  ): Promise<StorytimeReadingListItemEntity> {
    const list = await this.findOwned(listId, ownerUserId);

    await this.assertReadable(targetType, targetId);

    const column = this.columnFor(targetType);
    const existing = await this._itemRepository.findOne({
      where: { readingListId: listId, [column]: targetId },
    });

    if (existing) {
      existing.note = note ?? existing.note;

      return this._itemRepository.save(existing);
    }

    if (list.itemCount >= MAX_LIST_ITEMS) {
      throw new BadRequestException(
        `A reading list may hold at most ${MAX_LIST_ITEMS} things.`,
      );
    }

    const item = await this._itemRepository.save(
      this._itemRepository.create({
        readingListId: listId,
        storyId: targetType === StorytimeTargetType.STORY ? targetId : null,
        arcId: targetType === StorytimeTargetType.ARC ? targetId : null,
        note,
        orderIndex: await this.nextIndex(listId),
      }),
    );

    await this.recount(list);

    return item;
  }

  /**
   * Takes something off a list.
   *
   * @param listId - The list.
   * @param itemId - The item.
   * @param ownerUserId - Who is asking.
   * @throws NotFoundException when that item is not on that list.
   */
  async removeItem(
    listId: string,
    itemId: string,
    ownerUserId: string,
  ): Promise<void> {
    const list = await this.findOwned(listId, ownerUserId);
    const item = await this._itemRepository.findOne({
      where: { id: itemId, readingListId: listId },
    });

    if (!item) {
      throw new NotFoundException('That is not on this list.');
    }

    await this._itemRepository.delete(item.id);
    await this.recount(list);
  }

  /**
   * Puts a list in a given order.
   *
   * The order is the point of a reading list, so it is set outright rather than
   * nudged an item at a time: the client already knows the order it wants.
   *
   * @param listId - The list.
   * @param itemIds - Every item on the list, in the order wanted.
   * @param ownerUserId - Who is asking.
   * @throws BadRequestException when the order does not name exactly what is
   *   on the list.
   */
  async reorder(
    listId: string,
    itemIds: string[],
    ownerUserId: string,
  ): Promise<void> {
    await this.findOwned(listId, ownerUserId);

    const items = await this._itemRepository.find({
      where: { readingListId: listId },
    });

    const known = new Set(items.map(item => item.id));
    const named = new Set(itemIds);

    if (
      named.size !== itemIds.length ||
      known.size !== named.size ||
      itemIds.some(id => !known.has(id))
    ) {
      throw new BadRequestException(
        'The order must name every item on the list exactly once.',
      );
    }

    await Promise.all(
      itemIds.map((id, index) =>
        this._itemRepository.update(id, { orderIndex: index }),
      ),
    );
  }

  /**
   * Finds which of a member's lists already hold something.
   *
   * Lets a reader see at a glance where a Story already sits, rather than
   * discovering it by adding it again.
   *
   * @param targetType - Whether it is a Story or an Arc.
   * @param targetId - The thing.
   * @param ownerUserId - The member.
   * @returns The identifiers of their lists holding it.
   */
  async findListsHolding(
    targetType: StorytimeTargetType,
    targetId: string,
    ownerUserId: string,
  ): Promise<string[]> {
    const lists = await this.findMine(ownerUserId);

    if (lists.length === 0) {
      return [];
    }

    const items = await this._itemRepository.find({
      where: {
        readingListId: In(lists.map(list => list.id)),
        [this.columnFor(targetType)]: targetId,
      },
    });

    return items.map(item => item.readingListId);
  }

  /**
   * Requires a name that is actually a name.
   *
   * @param name - What was sent.
   * @returns The name, trimmed.
   * @throws BadRequestException when there is nothing left of it.
   */
  private requireName(name?: string): string {
    const trimmed = (name ?? '').trim();

    if (trimmed.length === 0) {
      throw new BadRequestException('A reading list needs a name.');
    }

    return trimmed;
  }

  /**
   * Produces an address free within one member's lists.
   *
   * Scoped to the owner rather than site-wide: two people may both keep a list
   * called "Klingon favourites", and neither should have to rename theirs
   * because the other got there first.
   *
   * @param name - What the list is called.
   * @param ownerUserId - Whose lists to avoid colliding with.
   * @param exceptListId - A list allowed to keep its own address.
   * @returns The address.
   * @throws BadRequestException when no free candidate is found.
   */
  private async generateSlug(
    name: string,
    ownerUserId: string,
    exceptListId?: string,
  ): Promise<string> {
    const stem = normaliseToSlug(name) || LIST_SLUG_FALLBACK_STEM;

    for (let attempt = 0; attempt < MAX_LIST_SLUG_ATTEMPTS; attempt++) {
      const candidate = attempt === 0 ? stem : `${stem}-${attempt + 1}`;
      const taken = await this._listRepository.findOne({
        where: {
          ownerUserId,
          slug: candidate,
          deletedAt: IsNull(),
          ...(exceptListId ? { id: Not(exceptListId) } : {}),
        },
      });

      if (!taken) {
        return candidate;
      }
    }

    throw new BadRequestException(
      'You already have too many lists by that name.',
    );
  }

  /**
   * Refuses to list something nobody may read.
   *
   * @param targetType - Whether it is a Story or an Arc.
   * @param targetId - The thing.
   * @throws BadRequestException when it is not readable, or not listable.
   */
  private async assertReadable(
    targetType: StorytimeTargetType,
    targetId: string,
  ): Promise<void> {
    const found =
      targetType === StorytimeTargetType.STORY
        ? await this._storyService.findPublicByIds([targetId])
        : await this._arcService.findPublicByIds([targetId]);

    if (found.length === 0) {
      throw new BadRequestException(
        'That is not something anybody can read, so it cannot be listed.',
      );
    }
  }

  /**
   * Names the column identifying what an item points at.
   *
   * @param targetType - Whether it is a Story or an Arc.
   * @returns The column name.
   * @throws BadRequestException when that kind cannot be listed.
   */
  private columnFor(targetType: StorytimeTargetType): 'storyId' | 'arcId' {
    switch (targetType) {
      case StorytimeTargetType.STORY:
        return 'storyId';
      case StorytimeTargetType.ARC:
        return 'arcId';
      default:
        throw new BadRequestException('That cannot go on a reading list.');
    }
  }

  /**
   * Finds where the next thing added belongs.
   *
   * @param listId - The list.
   * @returns The index after the last one.
   */
  private async nextIndex(listId: string): Promise<number> {
    const last = await this._itemRepository.findOne({
      where: { readingListId: listId },
      order: { orderIndex: 'DESC' },
    });

    return last ? last.orderIndex + 1 : 0;
  }

  /**
   * Records how many things a list holds.
   *
   * Counted from the items rather than nudged, so that it cannot drift away
   * from the truth however the list was changed.
   *
   * @param list - The list.
   */
  private async recount(list: StorytimeReadingListEntity): Promise<void> {
    list.itemCount = await this._itemRepository.count({
      where: { readingListId: list.id },
    });

    await this._listRepository.save(list);
  }

  /**
   * Finds the readable Stories a list names.
   *
   * @param items - The items.
   * @returns The Stories, by identifier.
   */
  private async findStories(
    items: StorytimeReadingListItemEntity[],
  ): Promise<Map<string, StorytimeStoryEntity>> {
    const ids = items
      .map(item => item.storyId)
      .filter((id): id is string => id !== null);

    if (ids.length === 0) {
      return new Map();
    }

    const stories = await this._storyService.findPublicByIds(ids);

    return new Map(stories.map(story => [story.id, story]));
  }

  /**
   * Finds the readable Arcs a list names.
   *
   * @param items - The items.
   * @returns The Arcs, by identifier.
   */
  private async findArcs(
    items: StorytimeReadingListItemEntity[],
  ): Promise<Map<string, StorytimeArcEntity>> {
    const ids = items
      .map(item => item.arcId)
      .filter((id): id is string => id !== null);

    if (ids.length === 0) {
      return new Map();
    }

    const arcs = await this._arcService.findPublicByIds(ids);

    return new Map(arcs.map(arc => [arc.id, arc]));
  }
}
