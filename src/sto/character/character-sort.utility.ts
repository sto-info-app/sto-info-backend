/**
 * Ordering of an account's own captain list.
 *
 * The list is ordered in memory rather than in SQL because most of the fields
 * a user may sort by — species, faction and class — live on joined lookup
 * tables, and ordering by them in SQL would force the join set to drive the
 * query shape. An account's captain list is small and returned whole, so
 * sorting the materialised result is equivalent.
 */

/** A field a captain list may be ordered by. */
export enum CharacterSortBy {
  Handle = 'handle',
  Level = 'level',
  CreatedDate = 'createdDate',
  Species = 'species',
  Faction = 'faction',
  Class = 'class',
}

/** Direction a captain list is ordered in. */
export enum CharacterSortOrder {
  Asc = 'ASC',
  Desc = 'DESC',
}

/** The default ordering, applied when the client asks for none. */
export const DEFAULT_CHARACTER_SORT_BY = CharacterSortBy.Handle;

/** The default direction, applied when the client asks for none. */
export const DEFAULT_CHARACTER_SORT_ORDER = CharacterSortOrder.Asc;

/** A lookup relation a captain is ordered by, as far as ordering cares. */
interface SortableNamed {
  name?: string | null;
}

/** The fields of a captain that take part in ordering. */
export interface SortableCharacter {
  handle: string;
  level?: number | null;
  createdDate: Date | null;
  pinnedAt: Date | null;
  species?: SortableNamed | null;
  faction?: SortableNamed | null;
  class?: SortableNamed | null;
}

/**
 * Compares two handles case-insensitively.
 *
 * @param a - The first captain.
 * @param b - The second captain.
 * @returns A negative number, zero, or a positive number.
 */
function compareHandles(a: SortableCharacter, b: SortableCharacter): number {
  return a.handle.localeCompare(b.handle, undefined, { sensitivity: 'base' });
}

/**
 * Compares two captains by pinned state, putting pinned captains first.
 *
 * Pinning only groups: the chosen sort still orders the captains within each
 * group, so a pinned captain's position among other pinned captains is decided
 * by the same field as everything else.
 *
 * @param a - The first captain.
 * @param b - The second captain.
 * @returns A negative number, zero, or a positive number.
 */
function comparePinned(a: SortableCharacter, b: SortableCharacter): number {
  return (b.pinnedAt ? 1 : 0) - (a.pinnedAt ? 1 : 0);
}

/**
 * Compares two optional values, sorting the absent ones last in both
 * directions: the field is optional, and reversing the order should not
 * promote the captains that are missing it to the top.
 *
 * @param a - The first value, or null when not recorded.
 * @param b - The second value, or null when not recorded.
 * @param compare - Compares two present values.
 * @returns A negative number, zero, or a positive number.
 */
function compareOptional<T>(
  a: T | null | undefined,
  b: T | null | undefined,
  compare: (a: T, b: T) => number,
): number {
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;

  if (aMissing || bMissing) {
    if (aMissing && bMissing) {
      return 0;
    }

    return aMissing ? 1 : -1;
  }

  return compare(a, b);
}

/**
 * Compares two lookup names case-insensitively, absent names last.
 *
 * @param a - The first captain's relation.
 * @param b - The second captain's relation.
 * @param direction - `1` ascending, `-1` descending.
 * @returns A negative number, zero, or a positive number.
 */
function compareNames(
  a: SortableNamed | null | undefined,
  b: SortableNamed | null | undefined,
  direction: number,
): number {
  return compareOptional(
    a?.name ?? null,
    b?.name ?? null,
    (aName, bName) =>
      direction *
      aName.localeCompare(bName, undefined, { sensitivity: 'base' }),
  );
}

/**
 * Compares two captains by the requested field.
 *
 * @param a - The first captain.
 * @param b - The second captain.
 * @param sortBy - The field to compare.
 * @param direction - `1` ascending, `-1` descending.
 * @returns A negative number, zero, or a positive number.
 */
function compareField(
  a: SortableCharacter,
  b: SortableCharacter,
  sortBy: CharacterSortBy,
  direction: number,
): number {
  switch (sortBy) {
    case CharacterSortBy.Level:
      return compareOptional(
        a.level ?? null,
        b.level ?? null,
        (aLevel, bLevel) => direction * (aLevel - bLevel),
      );
    case CharacterSortBy.CreatedDate:
      return compareOptional(
        a.createdDate,
        b.createdDate,
        (aDate, bDate) => direction * (aDate.getTime() - bDate.getTime()),
      );
    case CharacterSortBy.Species:
      return compareNames(a.species, b.species, direction);
    case CharacterSortBy.Faction:
      return compareNames(a.faction, b.faction, direction);
    case CharacterSortBy.Class:
      return compareNames(a.class, b.class, direction);
    default:
      return direction * compareHandles(a, b);
  }
}

/**
 * Orders an account's captains: pinned first, then by the requested field,
 * then by handle so the result is total and does not shift between identical
 * requests.
 *
 * @param characters - The captains to order.
 * @param sortBy - The field to order by.
 * @param sortOrder - The direction to order in.
 * @returns A new, ordered array. The input is not modified.
 */
export function sortCharacters<T extends SortableCharacter>(
  characters: T[],
  sortBy: CharacterSortBy = DEFAULT_CHARACTER_SORT_BY,
  sortOrder: CharacterSortOrder = DEFAULT_CHARACTER_SORT_ORDER,
): T[] {
  const direction = sortOrder === CharacterSortOrder.Desc ? -1 : 1;

  return [...characters].sort((a, b) => {
    const byPinned = comparePinned(a, b);
    if (byPinned !== 0) {
      return byPinned;
    }

    const byField = compareField(a, b, sortBy, direction);
    if (byField !== 0) {
      return byField;
    }

    return compareHandles(a, b);
  });
}
