import { Injectable } from '@nestjs/common';

import {
  canonicaliseTimezone,
  LocalTimeResolution,
  resolveLocalDateTime,
} from 'src/shared/utilities/timezone.utility';

import { ROSTER_ALLOWED_COLUMNS } from '../constants/roster-csv.constants';
import {
  HOURS_ON_A_CLOCK_FACE,
  ROSTER_CONTRIBUTION_PATTERN,
  ROSTER_LEVEL_PATTERN,
  ROSTER_PROFESSION_PATTERNS,
  ROSTER_STORED_TEXT_MAX_LENGTH,
  STO_DATE_PATTERN,
} from '../constants/roster-typed.constants';
import { RosterDateResolution } from '../enums/roster-date-resolution.enum';
import { RosterProfession } from '../enums/roster-profession.enum';
import { RosterRowRejectionCode } from '../enums/roster-row-rejection-code.enum';
import {
  normaliseRosterAccountHandle,
  normaliseRosterCharacterName,
} from '../utilities/roster-identity.utility';

/** One date column of one row, read as far as the file allows. */
export interface RosterDate {
  /** Which of the three states this date is in. */
  readonly resolution: RosterDateResolution;

  /**
   * The local wall-clock time exactly as the file wrote it, re-spelled as
   * `YYYY-MM-DDTHH:mm:ss`, or null when the column was empty.
   *
   * Kept alongside the instants rather than replaced by them. The local text
   * is what was observed; an instant is an interpretation of it through a zone
   * somebody supplied, and a zone supplied wrongly is a thing that has to be
   * correctable without the original being gone — plan section 3.4.
   */
  readonly local: string | null;

  /**
   * Every instant the local time could name, earliest first.
   *
   * None when the column was empty, one ordinarily, two on the morning a clock
   * went back. A date in a spring-forward gap never gets this far: it is
   * refused where it is read.
   */
  readonly candidates: readonly Date[];
}

/** One roster row, read into values rather than text. */
export interface RosterObservationRow {
  /** Which line of the sanitised file this came from, counting from one. */
  readonly line: number;

  /** The Character's name, exactly as exported. */
  readonly characterName: string;

  /** The account handle, exactly as exported. */
  readonly accountHandle: string;

  /** The Character's level. */
  readonly level: number;

  /** The Class value, exactly as exported. Never replaced by the profession. */
  readonly className: string;

  /** The profession read out of it, or null when none could be. */
  readonly profession: RosterProfession | null;

  /** The Fleet's own label for this member's rank, exactly as exported. */
  readonly guildRank: string;

  /** The cumulative contribution total. A running figure, never a delta. */
  readonly contributionTotal: number;

  /** When the game says this Character joined the Fleet. */
  readonly joinedAt: RosterDate;

  /** When the game says their rank last changed. */
  readonly rankChangedAt: RosterDate;

  /** When the game last saw them. */
  readonly lastActiveAt: RosterDate;

  /** The member's status text, exactly as exported. */
  readonly status: string;

  /** The member's public comment, exactly as exported. */
  readonly publicComment: string;

  /** When that comment was last edited. */
  readonly publicCommentEditedAt: RosterDate;
}

/** Something about a row that stops the export being read. */
export interface RosterRowProblem {
  /** What is wrong. Structural, never a value out of the file. */
  readonly code: RosterRowRejectionCode;

  /** Which line of the sanitised file, counting from one. */
  readonly line: number;

  /** Which column, named from the fixed header, or null for a whole row. */
  readonly column: string | null;
}

/** What the typed reader makes of a sanitised export. */
export interface TypedRoster {
  /** Every row that could be read. */
  readonly rows: readonly RosterObservationRow[];

  /** Everything that stopped a row being read, in file order. */
  readonly problems: readonly RosterRowProblem[];

  /** How many data rows the file held, whether or not they could be read. */
  readonly rowCount: number;

  /** How many readable rows carry a Class no profession could be read from. */
  readonly unknownClassCount: number;

  /** How many readable rows carry a date that names two instants. */
  readonly ambiguousDateCount: number;
}

/** Where each retained column sits in the canonical file. */
const COLUMN = {
  characterName: 0,
  accountHandle: 1,
  level: 2,
  className: 3,
  guildRank: 4,
  contributionTotal: 5,
  joinedAt: 6,
  rankChangedAt: 7,
  lastActiveAt: 8,
  status: 9,
  publicComment: 10,
  publicCommentEditedAt: 11,
} as const;

/** The header line of the canonical sanitised file, byte for byte. */
const CANONICAL_HEADER = ROSTER_ALLOWED_COLUMNS.map(
  column => `"${column}"`,
).join(',');

/** The groups {@link STO_DATE_PATTERN} captures, in order. */
const DATE_GROUP = {
  month: 1,
  day: 2,
  year: 3,
  hour: 4,
  minute: 5,
  second: 6,
  meridiem: 7,
} as const;

/**
 * Reads a sanitised roster export into typed observations.
 *
 * The layer above the privacy boundary, and the first thing in the feature
 * that has an opinion about what a roster *says*. Everything it reads comes
 * from the canonical twelve-column file this application wrote itself, so it
 * never sees an officer column and could not report one if it tried.
 *
 * It is also how a stored snapshot is read back. FC-017 fetches sanitised
 * bytes out of quarantine months after they arrived and has to make the same
 * values of them, so the reader is written against the canonical form rather
 * than against whatever the privacy parser happened to be holding in memory —
 * one reader, one answer, however long ago the file was accepted.
 *
 * ## Dates are the whole difficulty
 *
 * An export writes `4/1/2023 12:00:00pm` and does not say whose clock that
 * was. The uploader says, once, for the file; each row's own date is then
 * resolved through that zone against the rules in force *on that date*, never
 * against the offset that applied on the day of the export. Plan section 3.4
 * proves why with the controlled pair: the same 93 members exported from
 * New York and from London four seconds apart differ by five hours on 91 join
 * dates and by four on two others, and only the per-date reading makes all 93
 * agree.
 *
 * Twice a year that reading has no single answer, and both cases are handled
 * explicitly rather than averaged away:
 *
 * - **A local time the clock skipped** never happened, so the row is refused.
 *   Reading it as the hour after would record a moment nobody observed.
 * - **A local time the clock repeated** happened twice, and both instants are
 *   kept. Taking the earlier one silently is exactly the guess this feature
 *   is not allowed to make about somebody else's roster.
 *
 * ## Problems are collected, not thrown
 *
 * The privacy parser throws at the first refusal because it is deciding
 * whether to hold a file at all. This is deciding whether a file can be
 * believed, and somebody whose export has eleven unreadable dates should be
 * shown eleven. A row with any problem is left out of `rows` entirely, so
 * what comes back is either an observation or a reason there is not one.
 *
 * **Any problem at all stops the whole snapshot.** A roster is a statement
 * about a Fleet on a day, and a roster missing the four members whose rows
 * would not parse is a different statement — one that reads as four people
 * having left.
 */
@Injectable()
export class RosterTypedParserService {
  /**
   * Reads the canonical sanitised CSV into typed rows.
   *
   * @param sanitised - The canonical twelve-column file, as stored.
   * @param timezone - The IANA zone the export's wall-clock times were
   *   written in. Canonicalised by the caller; an identifier this runtime does
   *   not know is a fault in the caller rather than in the file.
   * @returns The rows that could be read, and everything that stopped the
   *   others.
   * @throws Error when the timezone is not one the runtime knows.
   */
  read(sanitised: Buffer, timezone: string): TypedRoster {
    const canonical = canonicaliseTimezone(timezone);

    if (canonical === null) {
      throw new Error(`Unknown timezone: ${timezone}`);
    }

    const lines = sanitised.toString('utf8').split('\n');

    // The trailing newline the serialiser writes yields one empty segment.
    if (lines[lines.length - 1] === '') {
      lines.pop();
    }

    if (lines[0] !== CANONICAL_HEADER) {
      return this.unreadable();
    }

    const problems: RosterRowProblem[] = [];
    const rows: RosterObservationRow[] = [];

    for (let index = 1; index < lines.length; index += 1) {
      const row = this.readRow(lines[index], index + 1, canonical, problems);

      if (row !== null) {
        rows.push(row);
      }
    }

    this.findDuplicateIdentities(rows, problems);

    return {
      rows,
      problems,
      rowCount: lines.length - 1,
      unknownClassCount: rows.filter(row => row.profession === null).length,
      ambiguousDateCount: rows.filter(row => this.hasAmbiguousDate(row)).length,
    };
  }

  /**
   * The answer for a file that is not the canonical form at all.
   *
   * @returns A reading with one problem and nothing else.
   */
  private unreadable(): TypedRoster {
    return {
      rows: [],
      problems: [
        {
          code: RosterRowRejectionCode.SANITISED_MALFORMED,
          line: 1,
          column: null,
        },
      ],
      rowCount: 0,
      unknownClassCount: 0,
      ambiguousDateCount: 0,
    };
  }

  /**
   * Reads one line into an observation, or records why it cannot be.
   *
   * @param line - The line, without its terminator.
   * @param lineNumber - Its line number in the file, counting from one.
   * @param timezone - The canonical zone the export was written in.
   * @param problems - Collected in place.
   * @returns The observation, or null when anything about the row was wrong.
   */
  private readRow(
    line: string,
    lineNumber: number,
    timezone: string,
    problems: RosterRowProblem[],
  ): RosterObservationRow | null {
    const values = this.readCanonicalLine(line);

    if (values === null) {
      problems.push({
        code: RosterRowRejectionCode.SANITISED_MALFORMED,
        line: lineNumber,
        column: null,
      });

      return null;
    }

    const characterName = this.readRequiredText(
      values[COLUMN.characterName],
      RosterRowRejectionCode.CHARACTER_NAME_EMPTY,
      COLUMN.characterName,
      lineNumber,
      problems,
    );
    const accountHandle = this.readRequiredText(
      values[COLUMN.accountHandle],
      RosterRowRejectionCode.ACCOUNT_HANDLE_EMPTY,
      COLUMN.accountHandle,
      lineNumber,
      problems,
    );
    const level = this.readInteger(
      values[COLUMN.level],
      ROSTER_LEVEL_PATTERN,
      RosterRowRejectionCode.LEVEL_MALFORMED,
      COLUMN.level,
      lineNumber,
      problems,
    );
    const contributionTotal = this.readInteger(
      values[COLUMN.contributionTotal],
      ROSTER_CONTRIBUTION_PATTERN,
      RosterRowRejectionCode.CONTRIBUTION_MALFORMED,
      COLUMN.contributionTotal,
      lineNumber,
      problems,
    );

    const className = this.readStorableText(
      values[COLUMN.className],
      COLUMN.className,
      lineNumber,
      problems,
    );
    const guildRank = this.readStorableText(
      values[COLUMN.guildRank],
      COLUMN.guildRank,
      lineNumber,
      problems,
    );
    const status = this.readStorableText(
      values[COLUMN.status],
      COLUMN.status,
      lineNumber,
      problems,
    );

    const dates = {
      joinedAt: this.readDate(
        values,
        COLUMN.joinedAt,
        lineNumber,
        timezone,
        problems,
      ),
      rankChangedAt: this.readDate(
        values,
        COLUMN.rankChangedAt,
        lineNumber,
        timezone,
        problems,
      ),
      lastActiveAt: this.readDate(
        values,
        COLUMN.lastActiveAt,
        lineNumber,
        timezone,
        problems,
      ),
      publicCommentEditedAt: this.readDate(
        values,
        COLUMN.publicCommentEditedAt,
        lineNumber,
        timezone,
        problems,
      ),
    };

    // Every column above is read before any of them is allowed to abandon the
    // row, so one bad date does not hide the three after it from somebody
    // fixing an export.
    if (
      characterName === null ||
      accountHandle === null ||
      className === null ||
      guildRank === null ||
      status === null ||
      level === null ||
      contributionTotal === null ||
      dates.joinedAt === null ||
      dates.rankChangedAt === null ||
      dates.lastActiveAt === null ||
      dates.publicCommentEditedAt === null
    ) {
      return null;
    }

    return {
      line: lineNumber,
      characterName,
      accountHandle,
      level,
      className,
      profession: this.readProfession(className),
      guildRank,
      contributionTotal,
      joinedAt: dates.joinedAt,
      rankChangedAt: dates.rankChangedAt,
      lastActiveAt: dates.lastActiveAt,
      publicCommentEditedAt: dates.publicCommentEditedAt,
      status,
      publicComment: values[COLUMN.publicComment],
    };
  }

  /**
   * Reads one line of the canonical file into its twelve values.
   *
   * Strict, and written out rather than delegated to a CSV library, because
   * the canonical form is narrow enough to state exactly: every field is
   * quoted whether it needs it or not, an internal quote is doubled, and the
   * only unquoted comma in the line is a delimiter. Anything else is a file
   * this application did not write.
   *
   * @param line - The line, without its terminator.
   * @returns The values, or null when the line is not the canonical form.
   */
  private readCanonicalLine(line: string): string[] | null {
    const values: string[] = [];

    let cursor = 0;

    for (;;) {
      if (line[cursor] !== '"') {
        return null;
      }

      cursor += 1;

      let value = '';

      for (;;) {
        const quote = line.indexOf('"', cursor);

        if (quote === -1) {
          return null;
        }

        value += line.slice(cursor, quote);
        cursor = quote + 1;

        if (line[cursor] !== '"') {
          break;
        }

        value += '"';
        cursor += 1;
      }

      values.push(value);

      if (cursor === line.length) {
        return values.length === ROSTER_ALLOWED_COLUMNS.length ? values : null;
      }

      if (line[cursor] !== ',') {
        return null;
      }

      cursor += 1;
    }
  }

  /**
   * Reads a column that has to say something.
   *
   * @param value - The column's value.
   * @param code - What to record when it says nothing.
   * @param column - Which column, as an index into the fixed header.
   * @param lineNumber - The line number, counting from one.
   * @param problems - Collected in place.
   * @returns The value, or null when it was empty.
   */
  private readRequiredText(
    value: string,
    code: RosterRowRejectionCode,
    column: number,
    lineNumber: number,
    problems: RosterRowProblem[],
  ): string | null {
    if (value.trim() === '') {
      problems.push({ code, line: lineNumber, column: this.name(column) });

      return null;
    }

    return this.readStorableText(value, column, lineNumber, problems);
  }

  /**
   * Reads a column that may say anything, so long as it will fit.
   *
   * The public comment is not read through this: it is stored as text and
   * has no width to exceed, and a member's comment is the one column where a
   * long value is a thing somebody wrote rather than a sign of tampering.
   *
   * @param value - The column's value.
   * @param column - Which column, as an index into the fixed header.
   * @param lineNumber - The line number, counting from one.
   * @param problems - Collected in place.
   * @returns The value, or null when it is too long to store.
   */
  private readStorableText(
    value: string,
    column: number,
    lineNumber: number,
    problems: RosterRowProblem[],
  ): string | null {
    if (value.length > ROSTER_STORED_TEXT_MAX_LENGTH) {
      problems.push({
        code: RosterRowRejectionCode.VALUE_TOO_LONG,
        line: lineNumber,
        column: this.name(column),
      });

      return null;
    }

    return value;
  }

  /**
   * Reads a column that has to be a plain non-negative integer.
   *
   * @param value - The column's value.
   * @param pattern - The digits the column allows.
   * @param code - What to record when it is something else.
   * @param column - Which column, as an index into the fixed header.
   * @param lineNumber - The line number, counting from one.
   * @param problems - Collected in place.
   * @returns The number, or null when the column could not be read.
   */
  private readInteger(
    value: string,
    pattern: RegExp,
    code: RosterRowRejectionCode,
    column: number,
    lineNumber: number,
    problems: RosterRowProblem[],
  ): number | null {
    if (!pattern.test(value)) {
      problems.push({ code, line: lineNumber, column: this.name(column) });

      return null;
    }

    return Number(value);
  }

  /**
   * Reads a date column through the export's timezone.
   *
   * @param values - The row's twelve values.
   * @param column - Which column, as an index into the fixed header.
   * @param lineNumber - The line number, counting from one.
   * @param timezone - The canonical zone the export was written in.
   * @param problems - Collected in place.
   * @returns What the column says, or null when it could not be read.
   */
  private readDate(
    values: string[],
    column: number,
    lineNumber: number,
    timezone: string,
    problems: RosterRowProblem[],
  ): RosterDate | null {
    const raw = values[column];

    if (raw === '') {
      return {
        resolution: RosterDateResolution.ABSENT,
        local: null,
        candidates: [],
      };
    }

    const local = this.toLocalDateTime(raw);

    // Either the value is not an STO date, or it is one naming a day that does
    // not exist. The same answer to whoever has to fix it: this does not say
    // when.
    const resolved =
      local === null ? null : resolveLocalDateTime(local, timezone);

    if (local === null || resolved === null) {
      problems.push({
        code: RosterRowRejectionCode.DATE_MALFORMED,
        line: lineNumber,
        column: this.name(column),
      });

      return null;
    }

    if (resolved.resolution === LocalTimeResolution.NONEXISTENT) {
      problems.push({
        code: RosterRowRejectionCode.DATE_NONEXISTENT,
        line: lineNumber,
        column: this.name(column),
      });

      return null;
    }

    return {
      resolution:
        resolved.resolution === LocalTimeResolution.AMBIGUOUS
          ? RosterDateResolution.AMBIGUOUS
          : RosterDateResolution.EXACT,
      local,
      candidates: resolved.candidates,
    };
  }

  /**
   * Re-spells an STO date as the shared timezone utility's local form.
   *
   * The twelve-hour clock is range-checked here because it cannot be checked
   * anywhere else: `13:00:00am` matches the digits the pattern asks for, and
   * folding it into a twenty-four-hour clock would quietly make it one in the
   * morning.
   *
   * @param raw - The column's value.
   * @returns `YYYY-MM-DDTHH:mm:ss`, or null when the value is not an STO date.
   */
  private toLocalDateTime(raw: string): string | null {
    const match = STO_DATE_PATTERN.exec(raw);

    if (!match) {
      return null;
    }

    const hour = Number(match[DATE_GROUP.hour]);

    if (hour < 1 || hour > HOURS_ON_A_CLOCK_FACE) {
      return null;
    }

    const isAfternoon = match[DATE_GROUP.meridiem].toLowerCase() === 'pm';
    const hours =
      (hour % HOURS_ON_A_CLOCK_FACE) +
      (isAfternoon ? HOURS_ON_A_CLOCK_FACE : 0);

    const pad = (value: string): string => value.padStart(2, '0');

    return (
      `${match[DATE_GROUP.year]}-${pad(match[DATE_GROUP.month])}-` +
      `${pad(match[DATE_GROUP.day])}T${pad(String(hours))}:` +
      `${match[DATE_GROUP.minute]}:${match[DATE_GROUP.second]}`
    );
  }

  /**
   * Reads a profession out of a Class value, or reports that it cannot.
   *
   * @param className - The Class value, exactly as exported.
   * @returns The profession, or null when the value names none or more
   *   than one.
   */
  private readProfession(className: string): RosterProfession | null {
    const matched = ROSTER_PROFESSION_PATTERNS.filter(candidate =>
      candidate.pattern.test(className),
    );

    return matched.length === 1 ? matched[0].profession : null;
  }

  /**
   * Records every pair of rows nothing in the export can tell apart.
   *
   * The handle is compared as the rest of the site compares handles, and the
   * Character name on its NFC form with its case folded — the same rule a
   * Fleet's exact name is matched by, and for the same reason: a name typed
   * with a combining accent and one typed precomposed are the same name, and
   * a leading space is not decoration, it is how two things in this game are
   * deliberately told apart.
   *
   * Both together, never either alone. One account's alts share a handle and
   * are different people; two Characters sharing a name are told apart by the
   * handle, which is what the handle is for. Rows agreeing on both carry
   * nothing that distinguishes them.
   *
   * @param rows - The rows that could be read.
   * @param problems - Collected in place.
   */
  private findDuplicateIdentities(
    rows: readonly RosterObservationRow[],
    problems: RosterRowProblem[],
  ): void {
    const seen = new Set<string>();

    for (const row of rows) {
      const identity = [
        normaliseRosterAccountHandle(row.accountHandle),
        normaliseRosterCharacterName(row.characterName),
      ].join('\0');

      if (seen.has(identity)) {
        problems.push({
          code: RosterRowRejectionCode.DUPLICATE_IDENTITY,
          line: row.line,
          column: null,
        });
      }

      seen.add(identity);
    }
  }

  /**
   * Reports whether any of a row's dates names two instants.
   *
   * @param row - The row.
   * @returns True when at least one date is ambiguous.
   */
  private hasAmbiguousDate(row: RosterObservationRow): boolean {
    return [
      row.joinedAt,
      row.rankChangedAt,
      row.lastActiveAt,
      row.publicCommentEditedAt,
    ].some(date => date.resolution === RosterDateResolution.AMBIGUOUS);
  }

  /**
   * Names a column from the fixed header.
   *
   * @param column - The column's index.
   * @returns Its name, as the export writes it.
   */
  private name(column: number): string {
    return ROSTER_ALLOWED_COLUMNS[column];
  }
}
