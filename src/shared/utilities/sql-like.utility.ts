const SQL_LIKE_ESCAPE = String.fromCodePoint(92);

/**
 * Lower-cases the term and escapes LIKE wildcard characters and
 * the escape character itself.
 */
export function escapeSqlLikeTerm(term: string): string {
  return term
    .toLowerCase()
    .replaceAll(SQL_LIKE_ESCAPE, SQL_LIKE_ESCAPE.repeat(2))
    .replaceAll('%', `${SQL_LIKE_ESCAPE}%`)
    .replaceAll('_', `${SQL_LIKE_ESCAPE}_`);
}
