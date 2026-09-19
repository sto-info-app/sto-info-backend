import { Injectable } from '@nestjs/common';

import {
  ROSTER_ALLOWED_COLUMNS,
  ROSTER_CSV_LIMITS,
  ROSTER_DATE_SEGMENTS,
  ROSTER_NORMAL_HEADER_LINE,
  ROSTER_OFFICER_HEADER_LINE,
  ROSTER_PARSER_VERSION,
  ROSTER_PREFIX_FIELD_COUNT,
} from '../constants/roster-csv.constants';
import { RosterCsvRejectionCode } from '../enums/roster-csv-rejection-code.enum';
import { RosterSourceHeaderShape } from '../enums/roster-source-header-shape.enum';
import { RosterCsvRejectedError } from '../errors/roster-csv-rejected.error';

/** What the parser hands back when it accepts an upload. */
export interface SanitisedRoster {
  /** The canonical twelve-column re-serialisation. The only retained bytes. */
  readonly csv: Buffer;
  /** Which header the upload arrived with. */
  readonly headerShape: RosterSourceHeaderShape;
  /** How many data rows it held. */
  readonly rowCount: number;
  /** How many of those rows carried an officer tail that was discarded. */
  readonly officerTailRowCount: number;
  /** The grammar and redaction version that produced the bytes. */
  readonly parserVersion: number;
}

/**
 * One way of reading a row's tail, held as positions rather than as text.
 *
 * Positions on purpose. A candidate reading that loses the ambiguity contest
 * is a reading whose "Public Comment" may have swallowed an officer note, and
 * the cheapest way to be sure no such string ever exists is never to cut one:
 * nothing is sliced out of a row until exactly one reading survives.
 */
interface TailReading {
  readonly statusStart: number;
  readonly statusEnd: number;
  readonly commentStart: number;
  readonly commentEnd: number;
  readonly dateStart: number;
  readonly dateEnd: number;
  readonly hasOfficerTail: boolean;
}

/** How much work one row has been allowed to cost so far. */
interface ParseBudget {
  steps: number;
}

/** Folds an ASCII letter's code point to lower case. */
const LOWERCASE_BIT = 0x20;

/** The code point of `a`. */
const LETTER_A = 0x61;

/** The code point of `m`. */
const LETTER_M = 0x6d;

/** The code point of `p`. */
const LETTER_P = 0x70;

/**
 * The privacy boundary: untrusted roster bytes in, sanitised roster bytes out.
 *
 * This is the first thing that touches an uploaded CSV and the only thing that
 * ever sees all fifteen columns. It runs before any DTO is built, before
 * anything is logged, before a job payload exists and before a byte is written
 * anywhere — which is the first acceptance criterion, and the reason it is a
 * separate class with no dependencies rather than a step inside an import
 * service. It has nothing injected into it, so there is nothing it could
 * accidentally tell.
 *
 * **Its only job is structure and redaction. It never evaluates content.**
 * Whether a level is a number, a date is real, a handle is known or a
 * Character appears twice are all questions for FC-016 and FC-017, working
 * from the sanitised file. Asking them here would mean two parsers with
 * overlapping opinions, and the one thing this parser must be is small enough
 * to reason about exhaustively.
 *
 * ## Why not a CSV library
 *
 * Because the corpus says no library can do it. Strict RFC 4180 parsing
 * rejected 714 of 1,199 real exports, because STO writes literal quotes inside
 * quoted free text without doubling them — `"Call me "Renn", not Renner"` is a
 * real shape. Permissive parsing produced thousands of wrong-width rows, and a
 * wrong-width row is precisely how an officer note slides into Public Comment.
 * Plan section 3.3 rules out both, and rules out padding, truncating and
 * zipping values to headers along with them.
 *
 * ## The grammar
 *
 * A row is anchored at both ends. The first nine fields are unquoted and
 * contain no comma — independently verified across all 144,713 corpus rows —
 * so the first nine commas are taken literally. What remains is one of two
 * shapes:
 *
 * ```text
 * "Status","Public Comment",EditDate
 * "Status","Public Comment",EditDate,"Officer Comment",Author,OfficerDate
 * ```
 *
 * The officer author and its date are **unquoted**, which the plan does not
 * record and which a parser assuming otherwise gets wrong on all 5,700 officer
 * rows in the corpus. The second shape is admissible only under the
 * fifteen-column header, and under that header the first shape stays
 * admissible too, because 868 officer-headed files contain rows with the tail
 * simply absent.
 *
 * The right-hand anchor is the trailing date. Every row ends in a field that
 * is empty or shaped `M/D/YYYY h:mm:ssam`, and requiring that is not a
 * nicety — it is what stops a *malformed* officer tail being re-read as a
 * twelve-field row whose Public Comment has swallowed the officer note. Free
 * text can hold anything, so without something at the end of the line that
 * cannot, the grammar has no way to tell one from the other.
 *
 * ## Ambiguity is a refusal, not a tie-break
 *
 * Every candidate boundary is enumerated and the row is accepted only if
 * exactly one reading satisfies the grammar. Two readings mean the bytes do
 * not determine where Public Comment ends, and choosing either is how officer
 * text ends up retained. The corpus contains no ambiguous row — all 144,713
 * match exactly one shape — but that is a fact about an export tool, not a
 * guarantee about a file somebody uploads on purpose.
 *
 * ## Bounded
 *
 * A quote cap and a per-row step budget. The officer shape nests three
 * searches over candidate quote positions, so a line made of nothing but
 * alternating quotes and commas would otherwise cost cubically. A real row
 * costs fewer than ten steps; anything costing more than
 * {@link ROSTER_CSV_LIMITS.maxParseSteps} is refused rather than ground
 * through.
 */
@Injectable()
export class RosterCsvPrivacyParserService {
  /**
   * Reads an uploaded export and returns the sanitised form of it.
   *
   * @param source - The bytes as received. Not retained, not copied and not
   *   returned; the caller disposes of them.
   * @returns The sanitised CSV and what is worth recording about the source.
   * @throws RosterCsvRejectedError when the upload does not satisfy the
   *   grammar or exceeds a limit. The error carries a code and a line number
   *   and no content.
   */
  sanitise(source: Buffer): SanitisedRoster {
    const lines = this.splitLines(this.decode(source));

    this.assertLineIsSafe(lines[0], 1);

    const headerShape = this.readHeaderShape(lines[0]);
    const rows: string[][] = [];

    let officerTailRowCount = 0;

    for (let index = 1; index < lines.length; index += 1) {
      const lineNumber = index + 1;
      const line = lines[index];

      if (line.length === 0) {
        throw new RosterCsvRejectedError(
          RosterCsvRejectionCode.BLANK_LINE,
          lineNumber,
        );
      }

      if (rows.length === ROSTER_CSV_LIMITS.maxRows) {
        throw new RosterCsvRejectedError(
          RosterCsvRejectionCode.TOO_MANY_ROWS,
          lineNumber,
        );
      }

      this.assertLineIsSafe(line, lineNumber);

      const row = this.readRow(line, lineNumber, headerShape);

      rows.push(row.values);

      if (row.hasOfficerTail) {
        officerTailRowCount += 1;
      }
    }

    return {
      csv: this.serialise(rows),
      headerShape,
      rowCount: rows.length,
      officerTailRowCount,
      parserVersion: ROSTER_PARSER_VERSION,
    };
  }

  /**
   * Turns the received bytes into text, or refuses them.
   *
   * A byte order mark is explicitly allowed and is consumed by the decoder, so
   * it never reaches the header comparison and never reaches the sanitised
   * file. Anything that is not valid UTF-8 is refused outright rather than
   * repaired: a replacement character is a silent change to somebody's name.
   *
   * @param source - The bytes as received.
   * @returns The decoded text.
   * @throws RosterCsvRejectedError when the upload is empty, too large or not
   *   UTF-8.
   */
  private decode(source: Buffer): string {
    if (source.length === 0) {
      throw new RosterCsvRejectedError(RosterCsvRejectionCode.FILE_EMPTY);
    }

    if (source.length > ROSTER_CSV_LIMITS.maxSourceBytes) {
      throw new RosterCsvRejectedError(RosterCsvRejectionCode.FILE_TOO_LARGE);
    }

    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(source);
    } catch {
      throw new RosterCsvRejectedError(
        RosterCsvRejectionCode.ENCODING_NOT_UTF8,
      );
    }
  }

  /**
   * Splits text into physical lines.
   *
   * One row is one physical line: the corpus's 144,713 rows were verified
   * against its physical line count, so no field spans a newline and the
   * parser does not have to support one. CRLF and LF both end a line; a
   * carriage return anywhere else survives into the line and is refused by
   * {@link assertLineIsSafe}, because a new line-break form is a new parser
   * version and a new set of fixtures rather than a guess.
   *
   * @param text - The decoded upload.
   * @returns The lines, without their terminators.
   */
  private splitLines(text: string): string[] {
    const lines = text.split('\n');

    // A file that ends with a newline yields one trailing empty segment. That
    // is the terminator, not a line. A second one is a blank line and is
    // refused by the caller.
    if (lines.length > 1 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    return lines.map(line => (line.endsWith('\r') ? line.slice(0, -1) : line));
  }

  /**
   * Recognises the header, exactly.
   *
   * Byte-for-byte against the two known forms. No case folding, no whitespace
   * trimming, no column reordering and no "close enough": the header is the
   * one part of the file that says how to read the rest of it, and it is
   * supplied by whoever is uploading.
   *
   * @param headerLine - The first line of the upload.
   * @returns Which export shape this is.
   * @throws RosterCsvRejectedError when it is neither known header.
   */
  private readHeaderShape(headerLine: string): RosterSourceHeaderShape {
    if (headerLine === ROSTER_NORMAL_HEADER_LINE) {
      return RosterSourceHeaderShape.NORMAL;
    }

    if (headerLine === ROSTER_OFFICER_HEADER_LINE) {
      return RosterSourceHeaderShape.OFFICER;
    }

    throw new RosterCsvRejectedError(
      RosterCsvRejectionCode.HEADER_UNRECOGNISED,
      1,
    );
  }

  /**
   * Refuses a line that is too long, too quoted or carries a control
   * character.
   *
   * Control characters are refused rather than stripped. A roster field holds
   * a name, a rank or something a player typed into a comment box, and none of
   * those contains a NUL, a backspace or an escape — but a log line, a
   * terminal and a CSV opened in a spreadsheet all treat them as instructions.
   * A tab is allowed because it is ordinary text.
   *
   * @param line - The line.
   * @param lineNumber - Its physical line number, counting from one.
   * @throws RosterCsvRejectedError when the line is not safe to parse.
   */
  private assertLineIsSafe(line: string, lineNumber: number): void {
    if (line.length > ROSTER_CSV_LIMITS.maxLineLength) {
      throw new RosterCsvRejectedError(
        RosterCsvRejectionCode.LINE_TOO_LONG,
        lineNumber,
      );
    }

    let quotes = 0;

    for (let index = 0; index < line.length; index += 1) {
      const code = line.charCodeAt(index);

      if (code === 0x0d) {
        throw new RosterCsvRejectedError(
          RosterCsvRejectionCode.LINE_ENDING_UNSUPPORTED,
          lineNumber,
        );
      }

      if ((code < 0x20 && code !== 0x09) || code === 0x7f) {
        throw new RosterCsvRejectedError(
          RosterCsvRejectionCode.CONTROL_CHARACTER,
          lineNumber,
        );
      }

      if (code === 0x22) {
        quotes += 1;
      }
    }

    if (quotes > ROSTER_CSV_LIMITS.maxQuotesPerLine) {
      throw new RosterCsvRejectedError(
        RosterCsvRejectionCode.TOO_MANY_QUOTES,
        lineNumber,
      );
    }
  }

  /**
   * Reads one data row down to its twelve retained values.
   *
   * @param line - The line.
   * @param lineNumber - Its physical line number, counting from one.
   * @param headerShape - Which tail shapes are admissible.
   * @returns The twelve allowed values, and whether an officer tail was
   *   discarded.
   * @throws RosterCsvRejectedError when the row cannot be read, can be read
   *   more than one way, or holds an over-long value.
   */
  private readRow(
    line: string,
    lineNumber: number,
    headerShape: RosterSourceHeaderShape,
  ): { values: string[]; hasOfficerTail: boolean } {
    const prefix: string[] = [];

    let cursor = 0;

    for (let field = 0; field < ROSTER_PREFIX_FIELD_COUNT; field += 1) {
      const comma = line.indexOf(',', cursor);

      // Fewer than nine commas means there is no tenth field, so the
      // left-hand anchor has failed and nothing to the right of it can be
      // located either. Each of the nine is comma-free by construction, and
      // the corpus says nothing more about them, so nothing more is asked.
      if (comma === -1) {
        throw new RosterCsvRejectedError(
          RosterCsvRejectionCode.ROW_PREFIX_MALFORMED,
          lineNumber,
        );
      }

      prefix.push(line.slice(cursor, comma));
      cursor = comma + 1;
    }

    const remainder = line.slice(cursor);
    const readings = this.readTail(remainder, headerShape, lineNumber);

    if (readings.length === 0) {
      throw new RosterCsvRejectedError(
        RosterCsvRejectionCode.ROW_UNPARSEABLE,
        lineNumber,
      );
    }

    if (readings.length > 1) {
      throw new RosterCsvRejectedError(
        RosterCsvRejectionCode.ROW_AMBIGUOUS,
        lineNumber,
      );
    }

    const reading = readings[0];
    const values = [
      ...prefix,
      remainder.slice(reading.statusStart, reading.statusEnd),
      remainder.slice(reading.commentStart, reading.commentEnd),
      remainder.slice(reading.dateStart, reading.dateEnd),
    ];

    for (const value of values) {
      if (value.length > ROSTER_CSV_LIMITS.maxFieldLength) {
        throw new RosterCsvRejectedError(
          RosterCsvRejectionCode.FIELD_TOO_LONG,
          lineNumber,
        );
      }
    }

    return { values, hasOfficerTail: reading.hasOfficerTail };
  }

  /**
   * Enumerates every reading of a row's tail that satisfies the grammar.
   *
   * Stops at two, because two is already a refusal and there is no reason to
   * find a third. Everything it returns is a set of positions: no substring of
   * the officer comment, the officer author or the officer date is ever cut
   * out of the line, not even transiently and not even for a reading that is
   * about to be discarded.
   *
   * @param remainder - Everything after the ninth comma.
   * @param headerShape - Which tail shapes are admissible.
   * @param lineNumber - The physical line number, for the budget's refusal.
   * @returns Up to two satisfying readings.
   * @throws RosterCsvRejectedError when the search exceeds its step budget.
   */
  private readTail(
    remainder: string,
    headerShape: RosterSourceHeaderShape,
    lineNumber: number,
  ): TailReading[] {
    const readings: TailReading[] = [];

    // Status is always quoted, so a tail that does not open with a quote is
    // not a tail.
    if (!remainder.startsWith('"')) {
      return readings;
    }

    const officerAllowed = headerShape === RosterSourceHeaderShape.OFFICER;
    const budget: ParseBudget = { steps: 0 };

    for (
      let statusEnd = remainder.indexOf('","', 1);
      statusEnd !== -1;
      statusEnd = remainder.indexOf('","', statusEnd + 1)
    ) {
      const commentStart = statusEnd + 3;

      for (
        let commentEnd = remainder.indexOf('",', commentStart);
        commentEnd !== -1;
        commentEnd = remainder.indexOf('",', commentEnd + 1)
      ) {
        this.spend(budget, lineNumber);

        const dateStart = commentEnd + 2;
        const shared = { statusStart: 1, statusEnd, commentStart, commentEnd };

        // The row stops after the public comment's edit date. Admissible under
        // either header: 868 officer-headed files contain rows with no tail.
        if (this.isDateField(remainder, dateStart, remainder.length)) {
          readings.push({
            ...shared,
            dateStart,
            dateEnd: remainder.length,
            hasOfficerTail: false,
          });

          if (readings.length > 1) {
            return readings;
          }
        }

        if (!officerAllowed) {
          continue;
        }

        if (
          this.readOfficerTail(
            remainder,
            dateStart,
            shared,
            readings,
            budget,
            lineNumber,
          )
        ) {
          return readings;
        }
      }
    }

    return readings;
  }

  /**
   * Looks for an officer tail after the public comment's edit date.
   *
   * The shape is `,"Officer Comment",Author,OfficerDate` with the author and
   * the date unquoted. Each part is validated in place by scanning a range;
   * none of the three is ever copied.
   *
   * @param remainder - Everything after the ninth comma.
   * @param dateStart - Where the public comment's edit date begins.
   * @param shared - The status and comment positions this reading shares.
   * @param readings - The readings found so far, appended to in place.
   * @param budget - How much work this row has cost.
   * @param lineNumber - The physical line number, for the budget's refusal.
   * @returns True when the caller should stop searching, because a second
   *   reading has been found and the row is already ambiguous.
   * @throws RosterCsvRejectedError when the search exceeds its step budget.
   */
  private readOfficerTail(
    remainder: string,
    dateStart: number,
    shared: Pick<
      TailReading,
      'statusStart' | 'statusEnd' | 'commentStart' | 'commentEnd'
    >,
    readings: TailReading[],
    budget: ParseBudget,
    lineNumber: number,
  ): boolean {
    for (
      let dateEnd = remainder.indexOf(',"', dateStart);
      dateEnd !== -1;
      dateEnd = remainder.indexOf(',"', dateEnd + 1)
    ) {
      this.spend(budget, lineNumber);

      if (!this.isDateField(remainder, dateStart, dateEnd)) {
        continue;
      }

      for (
        let officerEnd = remainder.indexOf('",', dateEnd + 2);
        officerEnd !== -1;
        officerEnd = remainder.indexOf('",', officerEnd + 1)
      ) {
        this.spend(budget, lineNumber);

        // The author is comma-free, so the first comma after it is the
        // separator and the range before that comma needs no further check.
        // What follows has to be the officer's own edit date, and if it is
        // not then this was never an officer tail.
        const authorEnd = remainder.indexOf(',', officerEnd + 2);

        if (
          authorEnd === -1 ||
          !this.isDateField(remainder, authorEnd + 1, remainder.length)
        ) {
          continue;
        }

        readings.push({ ...shared, dateStart, dateEnd, hasOfficerTail: true });

        if (readings.length > 1) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Charges one step against a row's budget.
   *
   * @param budget - How much work this row has cost.
   * @param lineNumber - The physical line number.
   * @throws RosterCsvRejectedError when the budget is exhausted.
   */
  private spend(budget: ParseBudget, lineNumber: number): void {
    budget.steps += 1;

    if (budget.steps > ROSTER_CSV_LIMITS.maxParseSteps) {
      throw new RosterCsvRejectedError(
        RosterCsvRejectionCode.ROW_PARSE_BUDGET,
        lineNumber,
      );
    }
  }

  /**
   * Reports whether a range is empty or holds an STO date.
   *
   * The three tail fields that are not free text — the public comment's edit
   * date, and the officer author's date — are each one or the other, and this
   * is what makes the right-hand end of a row an anchor rather than a guess.
   * A row whose trailing field is neither has been read wrongly, and refusing
   * it is what keeps a malformed officer tail from being re-read as a very
   * long public comment.
   *
   * It asks about the shape and nothing else. Whether the date exists, which
   * timezone it belongs to and whether it falls in a daylight-saving gap are
   * all FC-016's, decided later from the sanitised file.
   *
   * Scanned in place rather than sliced, so that asking the question about a
   * range of officer text does not create a string containing it.
   *
   * @param text - The line's remainder.
   * @param start - Where the range begins, inclusive.
   * @param end - Where it ends, exclusive.
   * @returns True when the range is empty or date-shaped.
   */
  private isDateField(text: string, start: number, end: number): boolean {
    if (start === end) {
      return true;
    }

    let cursor = start;

    for (const segment of ROSTER_DATE_SEGMENTS) {
      const from = cursor;

      while (cursor < end && text[cursor] >= '0' && text[cursor] <= '9') {
        cursor += 1;
      }

      const digits = cursor - from;

      if (digits < segment.minDigits || digits > segment.maxDigits) {
        return false;
      }

      if (segment.separator !== null) {
        if (text[cursor] !== segment.separator) {
          return false;
        }

        cursor += 1;
      }
    }

    // Exactly `am` or `pm`, in either case, and then the field ends.
    if (end - cursor !== 2) {
      return false;
    }

    const meridiem = text.charCodeAt(cursor) | LOWERCASE_BIT;
    const marker = text.charCodeAt(cursor + 1) | LOWERCASE_BIT;

    return (
      (meridiem === LETTER_A || meridiem === LETTER_P) && marker === LETTER_M
    );
  }

  /**
   * Writes the retained rows out as the canonical sanitised CSV.
   *
   * Twelve columns, every field quoted whether it needs it or not, internal
   * quotes doubled, LF line endings, no byte order mark. Uniform quoting is
   * the decision that makes the output's shape provable rather than argued:
   * there is no value a player could type that changes how many columns the
   * file has, because the delimiter is the only unquoted comma in it. It is
   * also strict RFC 4180, so unlike its input it can be read by anything.
   *
   * @param rows - The retained values, in source order.
   * @returns The sanitised bytes.
   */
  private serialise(rows: string[][]): Buffer {
    const lines = [
      ROSTER_ALLOWED_COLUMNS.map(column => this.quoteField(column)).join(','),
      ...rows.map(row => row.map(value => this.quoteField(value)).join(',')),
    ];

    return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
  }

  /**
   * Quotes one field for the sanitised file.
   *
   * @param value - The retained value.
   * @returns The value, quoted, with internal quotes doubled.
   */
  private quoteField(value: string): string {
    return `"${value.replaceAll('"', '""')}"`;
  }
}
