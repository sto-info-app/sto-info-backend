/**
 * Reads the rows out of what `query()` returns: PostgreSQL gives `[rows,
 * count]` for an UPDATE or DELETE with RETURNING, and the rows alone for a
 * SELECT or INSERT.
 *
 * @param result - What `query()` returned.
 * @returns The rows.
 */
export function rowsOf<T>(result: unknown): T[] {
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
  ) {
    return result[0] as T[];
  }

  return (Array.isArray(result) ? result : []) as T[];
}
