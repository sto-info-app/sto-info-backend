/**
 * Why a row of a sanitised export cannot be read as an observation.
 *
 * The companion to {@link RosterCsvRejectionCode}, and deliberately a separate
 * enum. That one describes the *shape* of bytes somebody uploaded and is
 * answered before anything has been read; these describe values in a file this
 * application wrote itself, and are answered afterwards. Merging them would
 * put "this date does not exist" next to "this line has too many quotes" and
 * lose the distinction that makes either useful.
 *
 * Every value names a column or a rule and none quotes a value. A code and a
 * line number tell an uploader which row to look at; they tell anybody else
 * nothing they did not already have, which is what makes it safe to answer
 * with them. ADR-0001: no sample of a refused file is kept anywhere.
 *
 * Unlike the privacy parser's codes these are *collected* rather than thrown.
 * Somebody whose export has eleven bad dates should be shown eleven, not made
 * to fix one and upload again.
 */
export enum RosterRowRejectionCode {
  /**
   * The file is not the canonical sanitised form.
   *
   * Only reachable for bytes this application did not write, or did not write
   * in the shape it writes today: a stored source altered in the bucket, or a
   * file kept by an older serialiser. It is a code rather than an assertion
   * because the reader is also how FC-017 reads a snapshot back months later,
   * and by then "impossible" is an optimistic word.
   */
  SANITISED_MALFORMED = 'SANITISED_MALFORMED',

  /** The Character Name column is empty, so the row names nobody. */
  CHARACTER_NAME_EMPTY = 'CHARACTER_NAME_EMPTY',

  /** The Account Handle column is empty, so the row belongs to nobody. */
  ACCOUNT_HANDLE_EMPTY = 'ACCOUNT_HANDLE_EMPTY',

  /** The Level column is not a plain non-negative integer. */
  LEVEL_MALFORMED = 'LEVEL_MALFORMED',

  /** The Contribution Total column is not a plain non-negative integer. */
  CONTRIBUTION_MALFORMED = 'CONTRIBUTION_MALFORMED',

  /**
   * A date column is neither empty nor a well-formed STO date.
   *
   * Covers a value in the wrong shape and one in the right shape naming a day
   * that does not exist, such as the thirtieth of February. Both are the same
   * answer to the uploader: this column does not say when.
   */
  DATE_MALFORMED = 'DATE_MALFORMED',

  /**
   * A date column names a local time that never happened.
   *
   * The hour a clock skips going forward. Reading it as the hour after would
   * record a moment nobody observed, and there is no second candidate to
   * offer, so the row is refused — plan section 3.4.
   */
  DATE_NONEXISTENT = 'DATE_NONEXISTENT',

  /**
   * Two rows carry the same Character Name and Account Handle.
   *
   * Nothing the export writes can tell them apart, so neither can this
   * application. Keeping the later one would silently discard an observation
   * and keeping both would count somebody twice, which is why the whole
   * snapshot stops rather than the row.
   */
  DUPLICATE_IDENTITY = 'DUPLICATE_IDENTITY',
}
