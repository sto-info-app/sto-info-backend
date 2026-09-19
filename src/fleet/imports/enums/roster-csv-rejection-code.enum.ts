/**
 * Why an upload was refused at the privacy boundary.
 *
 * Every value describes the *structure* of what arrived and none of them
 * describes its content. That is the property that makes it safe to hand the
 * code straight back to the uploader alongside a row number: it tells them
 * which line to look at and what is wrong with its shape, and it tells an
 * attacker nothing they did not already know about the file they just sent.
 *
 * ADR-0001: on a refusal the bytes are discarded and no raw sample is kept —
 * not in the response, not in the log, not in a dead-letter payload and not in
 * Sentry. The code and the row number are the entire record of the failure.
 */
export enum RosterCsvRejectionCode {
  /** The upload exceeds the largest file the parser will decode. */
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',

  /** The upload has no bytes at all. */
  FILE_EMPTY = 'FILE_EMPTY',

  /**
   * The filename is empty, too long, or holds a character it may not.
   *
   * The filename is never used to build a storage key — that comes from the
   * asset's own identifier — but it is stored as provenance and shown back to
   * people, so a control character or a path separator in one is refused
   * rather than cleaned up. Cleaning it up would mean the recorded filename
   * was not the filename, which defeats recording it.
   */
  FILENAME_UNUSABLE = 'FILENAME_UNUSABLE',

  /** The bytes are not valid UTF-8. A byte order mark is allowed. */
  ENCODING_NOT_UTF8 = 'ENCODING_NOT_UTF8',

  /** A line carries a control character that no roster field may contain. */
  CONTROL_CHARACTER = 'CONTROL_CHARACTER',

  /** A carriage return appears somewhere other than ending a CRLF line. */
  LINE_ENDING_UNSUPPORTED = 'LINE_ENDING_UNSUPPORTED',

  /** The header is neither the twelve-column nor the fifteen-column form. */
  HEADER_UNRECOGNISED = 'HEADER_UNRECOGNISED',

  /** The export holds more rows than the parser will accept. */
  TOO_MANY_ROWS = 'TOO_MANY_ROWS',

  /** A blank line appears somewhere other than at the end of the file. */
  BLANK_LINE = 'BLANK_LINE',

  /** A line is longer than the parser will accept. */
  LINE_TOO_LONG = 'LINE_TOO_LONG',

  /** A retained column holds more text than the parser will accept. */
  FIELD_TOO_LONG = 'FIELD_TOO_LONG',

  /** A line carries more quote characters than the parser will consider. */
  TOO_MANY_QUOTES = 'TOO_MANY_QUOTES',

  /**
   * The row has fewer than the nine leading commas the dialect requires.
   *
   * The left-hand anchor failed, so nothing to the right of it can be located
   * with any confidence either.
   */
  ROW_PREFIX_MALFORMED = 'ROW_PREFIX_MALFORMED',

  /** No reading of the row's tail satisfies the grammar. */
  ROW_UNPARSEABLE = 'ROW_UNPARSEABLE',

  /**
   * More than one reading of the row's tail satisfies the grammar.
   *
   * The one refusal the second acceptance criterion is written about. Two
   * readings mean the boundary between Public Comment and what follows it is
   * not determined by the bytes, and picking either one is how an officer note
   * ends up in a retained column. Plan section 3.3: detect multiple possible
   * tail interpretations and reject; never recover permissively.
   */
  ROW_AMBIGUOUS = 'ROW_AMBIGUOUS',

  /**
   * Finding the row's tail boundary would cost more than the parser will
   * spend.
   *
   * Indistinguishable, from the uploader's point of view, from a row that
   * cannot be parsed — and treated the same way. It is a separate code so that
   * an administrator reading the counts can tell a malformed export from an
   * attempt to make the parser work.
   */
  ROW_PARSE_BUDGET = 'ROW_PARSE_BUDGET',
}
