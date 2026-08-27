import { Injectable } from '@nestjs/common';
import {
  MINIMUM_DIVISIBLE_GAP,
  ORDER_INDEX_GAP,
  ORDER_INDEX_START,
} from './storytime-ordering.constants';

/**
 * Where a new item should sit, and whether the collection must be renumbered
 * first.
 */
export interface OrderPlacement {
  /** The order index to give the item. */
  orderIndex: number;
  /**
   * Whether the surrounding collection has to be renumbered before this index
   * can be used, because no whole number was left between its neighbours.
   */
  requiresRenumber: boolean;
}

/**
 * Calculates positions for the ordered collections throughout Storytime:
 * Stories within an owner's collection, Chapters within a Story, Characters,
 * Stories within an Arc, and media within a Chapter.
 *
 * Positions are gapped integers rather than consecutive ones, so moving an item
 * between two neighbours writes a single row instead of renumbering everything
 * after it. That matters because reordering is a drag-and-drop action a creator
 * may perform repeatedly, and rewriting a whole Story's Chapters each time
 * would be both slow and a much larger surface for a concurrent edit to
 * conflict with.
 *
 * This service is pure arithmetic. Persisting a placement, locking the affected
 * rows and rejecting stale writes belong to the service that owns the
 * collection, because only it knows the scope being ordered.
 */
@Injectable()
export class StorytimeOrderingService {
  /**
   * Calculates the position for an item appended to the end of a collection.
   *
   * @param highestExistingIndex - The largest index currently in use, or null
   *   when the collection is empty.
   * @returns The index for the new item.
   */
  nextIndex(highestExistingIndex: number | null): number {
    if (highestExistingIndex === null) {
      return ORDER_INDEX_START;
    }

    return highestExistingIndex + ORDER_INDEX_GAP;
  }

  /**
   * Calculates the position for an item placed between two neighbours.
   *
   * Either neighbour may be null, meaning the item is going to the very start
   * or the very end of the collection.
   *
   * @param previousIndex - The index of the item it will follow, or null when
   *   it is moving to the front.
   * @param nextIndex - The index of the item it will precede, or null when it
   *   is moving to the end.
   * @returns The index to use, and whether a renumber is needed first.
   */
  placeBetween(
    previousIndex: number | null,
    nextIndex: number | null,
  ): OrderPlacement {
    if (previousIndex === null && nextIndex === null) {
      return { orderIndex: ORDER_INDEX_START, requiresRenumber: false };
    }

    if (previousIndex === null) {
      return this.placeBeforeFirst(nextIndex as number);
    }

    if (nextIndex === null) {
      return {
        orderIndex: previousIndex + ORDER_INDEX_GAP,
        requiresRenumber: false,
      };
    }

    return this.placeBetweenNeighbours(previousIndex, nextIndex);
  }

  /**
   * Renumbers a whole collection back onto even gaps.
   *
   * Used when two neighbours have closed to the point where nothing fits
   * between them. The caller supplies the identifiers in their intended order
   * and receives the index each should be given.
   *
   * @param orderedIds - The item identifiers, in the order they should end up.
   * @returns Each identifier paired with its new index.
   */
  renumber(orderedIds: string[]): { id: string; orderIndex: number }[] {
    return orderedIds.map((id, position) => ({
      id,
      orderIndex: ORDER_INDEX_START + position * ORDER_INDEX_GAP,
    }));
  }

  /**
   * Calculates the position for an item moving to the front of a collection.
   *
   * @param nextIndex - The index of the item it will precede.
   * @returns The index to use, and whether a renumber is needed first.
   */
  private placeBeforeFirst(nextIndex: number): OrderPlacement {
    // Halving keeps the item ahead of its neighbour without disturbing anything
    // else, until the first position is so close to zero that there is no whole
    // number left below it.
    if (nextIndex < MINIMUM_DIVISIBLE_GAP) {
      return { orderIndex: 0, requiresRenumber: true };
    }

    return {
      orderIndex: Math.floor(nextIndex / 2),
      requiresRenumber: false,
    };
  }

  /**
   * Calculates the position for an item placed between two existing items.
   *
   * @param previousIndex - The index of the item it will follow.
   * @param nextIndex - The index of the item it will precede.
   * @returns The index to use, and whether a renumber is needed first.
   */
  private placeBetweenNeighbours(
    previousIndex: number,
    nextIndex: number,
  ): OrderPlacement {
    const gap = nextIndex - previousIndex;

    if (gap < MINIMUM_DIVISIBLE_GAP) {
      // Nothing fits. The midpoint is reported anyway so the caller has a
      // sensible target to re-derive the position from once it has renumbered.
      return { orderIndex: previousIndex, requiresRenumber: true };
    }

    return {
      orderIndex: previousIndex + Math.floor(gap / 2),
      requiresRenumber: false,
    };
  }
}
