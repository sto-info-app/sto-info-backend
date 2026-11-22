import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

import { FleetDirectoryStatusFilter } from '../enums/fleet-directory-status-filter.enum';
import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';
import {
  applyDirectoryStatus,
  applyExactGameNameSearch,
  DEFAULT_DIRECTORY_PAGE_SIZE,
  MAX_DIRECTORY_PAGE_SIZE,
  resolveDirectoryPage,
  resolveDirectoryPageSize,
  toDuplicateKey,
} from './directory-query.utility';

/** A query builder that records the conditions put on it. */
interface RecordingBuilder {
  andWhere: jest.Mock;
}

/**
 * Builds a query-builder double that only records `andWhere`.
 *
 * @returns The double.
 */
function createBuilder(): RecordingBuilder {
  const builder = {} as RecordingBuilder;

  builder.andWhere = jest.fn(() => builder);

  return builder;
}

/**
 * Hands the double over as the type the utilities expect.
 *
 * @param builder - The recording double.
 * @returns The same object, typed for the call.
 */
function asQueryBuilder(
  builder: RecordingBuilder,
): SelectQueryBuilder<ObjectLiteral> {
  return builder as unknown as SelectQueryBuilder<ObjectLiteral>;
}

describe('resolveDirectoryPage', () => {
  it('reads the page asked for', () => {
    expect(resolveDirectoryPage(4)).toBe(4);
  });

  it('starts at the first page when none was asked for', () => {
    expect(resolveDirectoryPage()).toBe(1);
  });

  /**
   * The query DTO already refuses a page below one, so this is not a second
   * line of defence — it is what keeps the offset arithmetic from producing
   * a negative `skip` if the DTO is ever bypassed.
   */
  it('starts at the first page for a number no page could have', () => {
    expect(resolveDirectoryPage(-3)).toBe(1);
    expect(resolveDirectoryPage(0)).toBe(1);
  });
});

describe('resolveDirectoryPageSize', () => {
  it('reads the size asked for', () => {
    expect(resolveDirectoryPageSize(7)).toBe(7);
  });

  it('falls back to the default when none was asked for', () => {
    expect(resolveDirectoryPageSize()).toBe(DEFAULT_DIRECTORY_PAGE_SIZE);
  });

  it('falls back to the default for a size no page could have', () => {
    expect(resolveDirectoryPageSize(0)).toBe(DEFAULT_DIRECTORY_PAGE_SIZE);
    expect(resolveDirectoryPageSize(-10)).toBe(DEFAULT_DIRECTORY_PAGE_SIZE);
  });

  it('caps a page however many were asked for', () => {
    expect(resolveDirectoryPageSize(5000)).toBe(MAX_DIRECTORY_PAGE_SIZE);
  });
});

describe('applyDirectoryStatus', () => {
  it('asks for the operating records when nothing was said', () => {
    const builder = createBuilder();

    applyDirectoryStatus(asQueryBuilder(builder), 'fleet');

    expect(builder.andWhere).toHaveBeenCalledWith(
      'fleet.status = :directoryStatus',
      { directoryStatus: FleetScopeStatus.ACTIVE },
    );
  });

  it('asks for the closed ones when a reader is checking a name', () => {
    const builder = createBuilder();

    applyDirectoryStatus(
      asQueryBuilder(builder),
      'armada',
      FleetDirectoryStatusFilter.CLOSED,
    );

    expect(builder.andWhere).toHaveBeenCalledWith(
      'armada.status = :directoryStatus',
      { directoryStatus: FleetScopeStatus.CLOSED },
    );
  });

  /**
   * The only route by which a suspended record is ever listed. There is no
   * filter value naming suspension, so no directory page can be asked to
   * show which scopes are administratively held.
   */
  it('adds no condition at all for every record', () => {
    const builder = createBuilder();

    applyDirectoryStatus(
      asQueryBuilder(builder),
      'community',
      FleetDirectoryStatusFilter.ANY,
    );

    expect(builder.andWhere).not.toHaveBeenCalled();
  });
});

describe('applyExactGameNameSearch', () => {
  it('folds the case the same way the stored column does', () => {
    const builder = createBuilder();

    applyExactGameNameSearch(asQueryBuilder(builder), 'fleet', 'OMEGA');

    expect(builder.andWhere).toHaveBeenCalledWith(
      'fleet.exactGameNameNormalized LIKE :nameSearch',
      { nameSearch: '%omega%' },
    );
  });

  /**
   * Case is folded and whitespace never is, matching the stored column. A
   * search that trimmed its term would find `'Omega'` for somebody who typed
   * `' Omega'`, and an edge space may be the only thing telling two Fleets
   * apart — ADR-0003.
   */
  it('keeps an edge space, that being what distinguishes two Fleets', () => {
    const builder = createBuilder();

    applyExactGameNameSearch(asQueryBuilder(builder), 'fleet', ' Omega');

    expect(builder.andWhere).toHaveBeenCalledWith(
      'fleet.exactGameNameNormalized LIKE :nameSearch',
      { nameSearch: '% omega%' },
    );
  });

  it('escapes a wildcard rather than matching everything', () => {
    const builder = createBuilder();
    const backslash = String.fromCodePoint(92);

    applyExactGameNameSearch(asQueryBuilder(builder), 'fleet', '50%_off');

    expect(builder.andWhere).toHaveBeenCalledWith(
      'fleet.exactGameNameNormalized LIKE :nameSearch',
      { nameSearch: `%50${backslash}%${backslash}_off%` },
    );
  });

  it.each([[undefined], ['']])('adds nothing for %p', search => {
    const builder = createBuilder();

    applyExactGameNameSearch(asQueryBuilder(builder), 'fleet', search);

    expect(builder.andWhere).not.toHaveBeenCalled();
  });
});

describe('toDuplicateKey', () => {
  it('holds a count under its platform and its name together', () => {
    const key = toDuplicateKey('platform-1', 'omega command');

    expect(key).toContain('platform-1');
    expect(key).toContain('omega command');
  });

  /**
   * The same words on two platforms are two different Fleets, so the two
   * keys must differ. A separator a name could itself contain would let one
   * name's count be reported against another's.
   */
  it('tells one platform’s name from another’s', () => {
    expect(toDuplicateKey('a', 'b')).not.toBe(toDuplicateKey('a-b', ''));
  });
});
