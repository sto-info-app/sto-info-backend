import { Injectable } from '@nestjs/common';

import {
  ReadingListDetailDto,
  ReadingListDto,
  ReadingListItemDto,
} from './dto/reading-list.dto';
import { StorytimeReadingListEntity } from './entities/storytime-reading-list.entity';
import { ReadingListEntry } from './storytime-reading-list.service';

/**
 * Turns reading lists into the shape the API returns.
 *
 * An item is flattened to the title, address and summary of whatever it points
 * at, because that is all a list needs to show and it saves every caller
 * learning the difference between the two kinds.
 */
@Injectable()
export class StorytimeReadingListMapper {
  /**
   * Maps a list.
   *
   * @param list - The list.
   * @returns The list as a reader sees it.
   */
  toDto(list: StorytimeReadingListEntity): ReadingListDto {
    return {
      id: list.id,
      ownerUserId: list.ownerUserId,
      name: list.name,
      slug: list.slug,
      description: list.description,
      isPublic: list.isPublic,
      itemCount: list.itemCount,
      updatedAt: list.updatedAt,
    };
  }

  /**
   * Maps several lists.
   *
   * @param lists - The lists.
   * @returns The lists.
   */
  toDtos(lists: StorytimeReadingListEntity[]): ReadingListDto[] {
    return lists.map(list => this.toDto(list));
  }

  /**
   * Maps a list and what is on it.
   *
   * @param list - The list.
   * @param entries - What is on it.
   * @returns The list with its items.
   */
  toDetailDto(
    list: StorytimeReadingListEntity,
    entries: ReadingListEntry[],
  ): ReadingListDetailDto {
    return {
      ...this.toDto(list),
      items: entries.map(entry => this.toItemDto(entry)),
    };
  }

  /**
   * Maps one thing on a list.
   *
   * @param entry - The item and what it points at.
   * @returns The item as a reader sees it.
   */
  toItemDto(entry: ReadingListEntry): ReadingListItemDto {
    return {
      id: entry.item.id,
      targetType: entry.targetType,
      targetId: entry.content.id,
      title: entry.content.title,
      slug: entry.content.slug,
      shortDescription: entry.content.shortDescription,
      note: entry.item.note,
      orderIndex: entry.item.orderIndex,
    };
  }
}
