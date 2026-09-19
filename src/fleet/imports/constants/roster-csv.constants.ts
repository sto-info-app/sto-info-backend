/**
 * The STO roster dialect, and the bounds the privacy parser works to (FC-009).
 *
 * Every figure here is either an observation about the analysed corpus or a
 * limit chosen against one, and the corpus is 1,199 exports and 144,713 rows.
 * They are constants rather than configuration on purpose: a limit an operator
 * can raise at three in the morning is a limit that gets raised, and these
 * bound how much work an unauthenticated-shaped payload can make the process
 * do before anything has decided it is legitimate.
 */

/**
 * The twelve columns every STO export carries, in the exact order it writes
 * them.
 *
 * This is also the shape of the sanitised file. ADR-0001: the retained
 * artefact is a re-serialisation of these and nothing else, so an export that
 * arrived with the officer columns is byte-shaped identically to one that
 * never had them.
 */
export const ROSTER_ALLOWED_COLUMNS = [
  'Character Name',
  'Account Handle',
  'Level',
  'Class',
  'Guild Rank',
  'Contribution Total',
  'Join Date',
  'Rank Change Date',
  'Last Active Date',
  'Status',
  'Public Comment',
  'Public Comment Last Edit Date',
] as const;

/**
 * The three columns an officer-visible export appends.
 *
 * Named here so the header can be recognised, and for no other purpose. No
 * value from any of them is ever copied into a variable, a log line, a DTO or
 * a stored byte — R10, and the point of this whole module.
 */
export const ROSTER_OFFICER_COLUMNS = [
  'Officer Comment',
  'Officer Comment Author',
  'Officer Comment Last Edit Date',
] as const;

/** The header line of a twelve-column export, byte for byte. */
export const ROSTER_NORMAL_HEADER_LINE = ROSTER_ALLOWED_COLUMNS.join(',');

/** The header line of a fifteen-column export, byte for byte. */
export const ROSTER_OFFICER_HEADER_LINE = [
  ...ROSTER_ALLOWED_COLUMNS,
  ...ROSTER_OFFICER_COLUMNS,
].join(',');

/**
 * How many leading fields are unquoted and contain no comma.
 *
 * Character Name, Account Handle, Level, Class, Guild Rank, Contribution
 * Total, Join Date, Rank Change Date and Last Active Date. Independently
 * checked across all 144,713 corpus rows: none of them contains a comma or a
 * quote. That is what makes the left-hand end of a row an anchor rather than a
 * guess, and it is why the parser takes the first nine commas literally
 * instead of running a general CSV reader at the problem.
 */
export const ROSTER_PREFIX_FIELD_COUNT = 9;

/**
 * The version of the grammar and the redaction, recorded against every
 * accepted upload.
 *
 * Bump it when the parser's behaviour changes in a way that would give a
 * different sanitised file from the same bytes. Plan section 3.3 is explicit
 * that a new locale or line-break form is a new parser version and a new set
 * of fixtures, never an automatic guess at run time.
 */
export const ROSTER_PARSER_VERSION = 1;

/**
 * The shape of an STO date, as digit runs and the separator that follows each.
 *
 * `M/D/YYYY h:mm:ss` and then a meridiem. STO writes this in all three date
 * columns and in both of the discarded officer ones, and the corpus's 144,713
 * rows hold nothing else.
 *
 * The parser checks this shape and asks nothing further of it — not whether
 * the date exists, not which timezone it is in and not whether 31 February is
 * a day. Those are FC-016's, from the sanitised file. The shape is here
 * because it is load-bearing structure rather than content: a tail field that
 * is neither empty nor date-shaped is the signal that a row's boundaries have
 * been read wrongly, and it is what stops a malformed officer tail from being
 * re-read as a very long public comment.
 */
export const ROSTER_DATE_SEGMENTS: readonly {
  /** Fewest digits the run may hold. */
  readonly minDigits: number;
  /** Most digits the run may hold. */
  readonly maxDigits: number;
  /** The character that must follow it, or null at the end. */
  readonly separator: string | null;
}[] = [
  { minDigits: 1, maxDigits: 2, separator: '/' },
  { minDigits: 1, maxDigits: 2, separator: '/' },
  { minDigits: 4, maxDigits: 4, separator: ' ' },
  { minDigits: 1, maxDigits: 2, separator: ':' },
  { minDigits: 2, maxDigits: 2, separator: ':' },
  { minDigits: 2, maxDigits: 2, separator: null },
];

/**
 * What the parser refuses to exceed.
 *
 * The corpus's largest file is 79,165 bytes and its largest roster is 500
 * members, so these sit roughly twenty-five and four times above anything
 * observed — enough that a Fleet growing or an export gaining a column does
 * not start failing, tight enough that one request cannot make the process do
 * unbounded work.
 */
export const ROSTER_CSV_LIMITS = {
  /** The largest upload the parser will decode, in bytes. */
  maxSourceBytes: 2 * 1024 * 1024,

  /** The most data rows a single export may contain. */
  maxRows: 2000,

  /** The longest single physical line, in characters. */
  maxLineLength: 64 * 1024,

  /** The longest value any retained column may hold, in characters. */
  maxFieldLength: 4 * 1024,

  /**
   * The most quote characters one line may contain.
   *
   * A well-formed row carries four of them, or six with an officer tail, plus
   * whatever a player typed into a comment — 4,694 corpus rows have at least
   * one. Every quote is a place the tail boundary might fall, so this is the
   * first of the two bounds on how much the ambiguity search can cost, and it
   * is set well above anything a person would type so that the second bound is
   * the one that usually bites.
   */
  maxQuotesPerLine: 48,

  /**
   * The most tail interpretations the parser will consider for one row.
   *
   * The second bound, and the one that actually holds. Because literal quotes
   * inside a free-text field are not escaped, the boundary between Status,
   * Public Comment and whatever follows is found by trying candidate splits,
   * and the officer shape nests three such searches. A real row costs fewer
   * than ten steps. A line of forty-eight alternating quotes and commas —
   * within the quote cap, and the worst case found — costs fifteen thousand,
   * so the two bounds deliberately overlap and this is the one that refuses
   * it.
   */
  maxParseSteps: 4096,
} as const;
