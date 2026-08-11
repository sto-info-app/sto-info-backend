import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

interface QueryBuilderWithOptionalJoinAndSelect<T extends ObjectLiteral> {
  innerJoinAndSelect?: (
    property: string,
    alias: string,
  ) => SelectQueryBuilder<T>;
  innerJoin: (property: string, alias: string) => SelectQueryBuilder<T>;
  addSelect: (
    selection: string,
    selectionAliasName?: string,
  ) => SelectQueryBuilder<T>;
}

/**
 * Uses `innerJoinAndSelect` when available, otherwise joins and explicitly
 * selects the fallback field needed by callers.
 */
export function joinWithOptionalSelect<T extends ObjectLiteral>(
  queryBuilder: SelectQueryBuilder<T>,
  property: string,
  alias: string,
  fallbackSelect: string,
): SelectQueryBuilder<T> {
  const queryBuilderWithOptionalJoinAndSelect =
    queryBuilder as unknown as QueryBuilderWithOptionalJoinAndSelect<T>;

  if (
    typeof queryBuilderWithOptionalJoinAndSelect.innerJoinAndSelect ===
    'function'
  ) {
    return queryBuilderWithOptionalJoinAndSelect.innerJoinAndSelect(
      property,
      alias,
    );
  }

  return queryBuilderWithOptionalJoinAndSelect
    .innerJoin(property, alias)
    .addSelect(fallbackSelect);
}
