/**
 * Ordering of a user's own STO account list.
 *
 * The list is ordered in memory rather than in SQL because two of the fields a
 * user may sort by — `characterCount` and `endeavourTotalNodes` — are TypeORM
 * virtual columns, which `Repository.find` cannot order by. The alternative
 * would be restating their subqueries in an `ORDER BY`, duplicating the
 * definitions that already live on the entity. A user's account list is small
 * and returned whole, so sorting the materialised result is equivalent.
 */

/** A field the user's account list may be ordered by. */
export enum AccountSortBy {
  Handle = 'handle',
  CharacterCount = 'characterCount',
  EndeavourTotalNodes = 'endeavourTotalNodes',
  AccountCreatedDate = 'accountCreatedDate',
}

/** Direction an account list is ordered in. */
export enum AccountSortOrder {
  Asc = 'ASC',
  Desc = 'DESC',
}

/** The default ordering, applied when the client asks for none. */
export const DEFAULT_ACCOUNT_SORT_BY = AccountSortBy.Handle;

/** The default direction, applied when the client asks for none. */
export const DEFAULT_ACCOUNT_SORT_ORDER = AccountSortOrder.Asc;

/** The fields of an account that take part in ordering. */
export interface SortableAccount {
  handle: string;
  characterCount: number;
  endeavourTotalNodes: number;
  accountCreatedDate: Date | null;
  pinnedAt: Date | null;
}

/**
 * Compares two handles case-insensitively.
 *
 * @param a - The first account.
 * @param b - The second account.
 * @returns A negative number, zero, or a positive number.
 */
function compareHandles(a: SortableAccount, b: SortableAccount): number {
  return a.handle.localeCompare(b.handle, undefined, { sensitivity: 'base' });
}

/**
 * Compares two accounts by pinned state, putting pinned accounts first.
 *
 * Pinning only groups: the chosen sort still orders the accounts within each
 * group, so a pinned account's position among other pinned accounts is decided
 * by the same field as everything else.
 *
 * @param a - The first account.
 * @param b - The second account.
 * @returns A negative number, zero, or a positive number.
 */
function comparePinned(a: SortableAccount, b: SortableAccount): number {
  return (b.pinnedAt ? 1 : 0) - (a.pinnedAt ? 1 : 0);
}

/**
 * Compares two accounts by the date their owner recorded for the STO account.
 *
 * Accounts with no recorded date sort last in both directions: the date is
 * optional, and reversing the order should not promote the accounts that are
 * missing it to the top.
 *
 * @param a - The first account.
 * @param b - The second account.
 * @param direction - `1` ascending, `-1` descending.
 * @returns A negative number, zero, or a positive number.
 */
function compareCreatedDates(
  a: SortableAccount,
  b: SortableAccount,
  direction: number,
): number {
  const aDate = a.accountCreatedDate;
  const bDate = b.accountCreatedDate;

  if (!aDate || !bDate) {
    if (!aDate && !bDate) {
      return 0;
    }

    return aDate ? -1 : 1;
  }

  return direction * (aDate.getTime() - bDate.getTime());
}

/**
 * Compares two accounts by the requested field.
 *
 * @param a - The first account.
 * @param b - The second account.
 * @param sortBy - The field to compare.
 * @param direction - `1` ascending, `-1` descending.
 * @returns A negative number, zero, or a positive number.
 */
function compareField(
  a: SortableAccount,
  b: SortableAccount,
  sortBy: AccountSortBy,
  direction: number,
): number {
  switch (sortBy) {
    case AccountSortBy.CharacterCount:
      return direction * (a.characterCount - b.characterCount);
    case AccountSortBy.EndeavourTotalNodes:
      return direction * (a.endeavourTotalNodes - b.endeavourTotalNodes);
    case AccountSortBy.AccountCreatedDate:
      return compareCreatedDates(a, b, direction);
    default:
      return direction * compareHandles(a, b);
  }
}

/**
 * Orders a user's accounts: pinned first, then by the requested field, then by
 * handle so the result is total and does not shift between identical requests.
 *
 * @param accounts - The accounts to order.
 * @param sortBy - The field to order by.
 * @param sortOrder - The direction to order in.
 * @returns A new, ordered array. The input is not modified.
 */
export function sortAccounts<T extends SortableAccount>(
  accounts: T[],
  sortBy: AccountSortBy = DEFAULT_ACCOUNT_SORT_BY,
  sortOrder: AccountSortOrder = DEFAULT_ACCOUNT_SORT_ORDER,
): T[] {
  const direction = sortOrder === AccountSortOrder.Desc ? -1 : 1;

  return [...accounts].sort((a, b) => {
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
