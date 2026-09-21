import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

import { escapeSqlLikeTerm } from 'src/shared/utilities/sql-like.utility';

import { FleetDirectoryStatusFilter } from '../enums/fleet-directory-status-filter.enum';
import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';
import { toNormalisedExactGameName } from './exact-game-name.utility';

/**
 * The parts of a directory query that are the same for all three scopes.
 *
 * Paging defaults, the lifecycle filter and the name search read identically
 * whether a Community, a Fleet or an Armada is being listed, and three copies
 * of a default is a default that will eventually disagree with itself. What
 * each scope has of its own — a platform, a recruitment posture, a roster —
 * stays in its own service.
 */

/**
 * The separator inside a duplicate-count lookup key.
 *
 * A null byte, because a platform identifier is a UUID and a name is
 * anything at all: any printable separator is a character a Fleet could
 * legitimately be called, and two keys colliding would report one name's
 * duplicates against another's. Written as a code point for the reason
 * `sql-like.utility.ts` writes its backslash that way — an escape in a
 * string literal is a thing tooling rewrites.
 */
const DUPLICATE_KEY_SEPARATOR = String.fromCodePoint(0);

/** Records per page when the caller does not say. */
export const DEFAULT_DIRECTORY_PAGE_SIZE = 20;

/** The most records one page may carry. */
export const MAX_DIRECTORY_PAGE_SIZE = 50;

/**
 * Resolves the page number to read.
 *
 * @param page - The requested page, if any.
 * @returns A page number of at least one.
 */
export function resolveDirectoryPage(page?: number): number {
  return page && page > 0 ? page : 1;
}

/**
 * Resolves how many records a page carries.
 *
 * @param pageSize - The requested size, if any.
 * @returns A size between one and {@link MAX_DIRECTORY_PAGE_SIZE}.
 */
export function resolveDirectoryPageSize(pageSize?: number): number {
  if (!pageSize || pageSize < 1) {
    return DEFAULT_DIRECTORY_PAGE_SIZE;
  }

  return Math.min(pageSize, MAX_DIRECTORY_PAGE_SIZE);
}

/**
 * Restricts a listing to the lifecycle states the caller asked for.
 *
 * Active alone unless they said otherwise, because a directory is mostly read
 * by somebody looking for a scope that still exists. `ANY` adds no condition
 * at all, which is the only way a suspended record is ever listed.
 *
 * @param builder - The query being built.
 * @param alias - The alias the scope is selected under.
 * @param status - What the caller asked for, if anything.
 */
export function applyDirectoryStatus<T extends ObjectLiteral>(
  builder: SelectQueryBuilder<T>,
  alias: string,
  status?: FleetDirectoryStatusFilter,
): void {
  const wanted = status ?? FleetDirectoryStatusFilter.ACTIVE;

  if (wanted === FleetDirectoryStatusFilter.ANY) {
    return;
  }

  builder.andWhere(`${alias}.status = :directoryStatus`, {
    directoryStatus:
      wanted === FleetDirectoryStatusFilter.CLOSED
        ? FleetScopeStatus.CLOSED
        : FleetScopeStatus.ACTIVE,
  });
}

/**
 * Restricts a listing to records whose in-game name contains a term.
 *
 * Matched against the folded column rather than the stored name, and folded
 * the same way it was — case only, whitespace never. A search box that
 * trimmed its term would find a Fleet called `"Omega"` when the reader typed
 * `" Omega"`, and the leading space is exactly the thing that tells those two
 * Fleets apart.
 *
 * The term is escaped before it reaches `LIKE`, so a reader searching for
 * `100%` finds a Fleet called that instead of matching everything.
 *
 * @param builder - The query being built.
 * @param alias - The alias the scope is selected under.
 * @param search - The term, if the caller gave one.
 */
export function applyExactGameNameSearch<T extends ObjectLiteral>(
  builder: SelectQueryBuilder<T>,
  alias: string,
  search?: string,
): void {
  if (!search) {
    return;
  }

  const term = escapeSqlLikeTerm(toNormalisedExactGameName(search));

  builder.andWhere(`${alias}.exactGameNameNormalized LIKE :nameSearch`, {
    nameSearch: `%${term}%`,
  });
}

/**
 * Builds the lookup key a duplicate count is held under.
 *
 * Both parts, because a name only means the same Fleet on one platform: the
 * same words on Windows and on Xbox are two Fleets, and counting them
 * together would tell each of them it has a duplicate it does not have.
 *
 * @param platformId - The platform the record is on.
 * @param normalisedName - The folded in-game name.
 * @returns The key.
 */
export function toDuplicateKey(
  platformId: string,
  normalisedName: string,
): string {
  return `${platformId}${DUPLICATE_KEY_SEPARATOR}${normalisedName}`;
}
