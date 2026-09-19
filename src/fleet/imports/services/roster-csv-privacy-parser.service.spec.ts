import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import {
  ROSTER_CSV_LIMITS,
  ROSTER_NORMAL_HEADER_LINE,
  ROSTER_OFFICER_HEADER_LINE,
  ROSTER_PARSER_VERSION,
} from '../constants/roster-csv.constants';
import { RosterCsvRejectionCode } from '../enums/roster-csv-rejection-code.enum';
import { RosterSourceHeaderShape } from '../enums/roster-source-header-shape.enum';
import { RosterCsvRejectedError } from '../errors/roster-csv-rejected.error';
import { RosterCsvPrivacyParserService } from './roster-csv-privacy-parser.service';

/**
 * The privacy boundary (FC-009).
 *
 * The officer assertions here are written as absences. A test that checks the
 * twelve retained values are right would pass just as happily if a thirteenth
 * were also present, so every officer case additionally asserts that the
 * canary token appears nowhere in the sanitised bytes.
 */

const FIXTURE_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'test',
  'fixtures',
  'fleet-community',
);

/** The token FC-001 wrote into every fixture's officer columns. */
const CANARY = ['OFFICER', 'CANARY'].join('-');

/** Nine unquoted, comma-free fields: the row's left-hand anchor. */
const PREFIX =
  'Kell Marr,@fixture001,65,Starfleet Tactical Officer,Member,1000,' +
  '1/1/2022 1:00:00am,2/2/2023 2:00:00pm,3/3/2024 3:00:00am';

/**
 * Builds an upload from a header and some tails.
 *
 * @param header - The header line to use.
 * @param tails - Everything after each row's ninth comma.
 * @returns The upload, CRLF-terminated as STO writes it.
 */
function build(header: string, ...tails: string[]): Buffer {
  const lines = [header, ...tails.map(tail => `${PREFIX},${tail}`)];

  return Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8');
}

/**
 * Builds a twelve-column upload.
 *
 * @param tails - Everything after each row's ninth comma.
 * @returns The upload.
 */
function normal(...tails: string[]): Buffer {
  return build(ROSTER_NORMAL_HEADER_LINE, ...tails);
}

/**
 * Builds a fifteen-column upload.
 *
 * @param tails - Everything after each row's ninth comma.
 * @returns The upload.
 */
function officer(...tails: string[]): Buffer {
  return build(ROSTER_OFFICER_HEADER_LINE, ...tails);
}

/**
 * Reads a committed corpus fixture.
 *
 * @param filename - The fixture's filename.
 * @returns Its bytes.
 */
function fixture(filename: string): Buffer {
  return readFileSync(join(FIXTURE_DIR, filename));
}

describe('RosterCsvPrivacyParserService', () => {
  const parser = new RosterCsvPrivacyParserService();

  /**
   * Asserts that an upload is refused with a particular code and line.
   *
   * @param source - The upload.
   * @param code - The expected rejection code.
   * @param line - The expected physical line number.
   */
  function expectRejection(
    source: Buffer,
    code: RosterCsvRejectionCode,
    line: number | null,
  ): void {
    let caught: unknown;

    try {
      parser.sanitise(source);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RosterCsvRejectedError);
    expect((caught as RosterCsvRejectedError).code).toBe(code);
    expect((caught as RosterCsvRejectedError).line).toBe(line);
  }

  describe('the officer columns', () => {
    it('discards the officer tail from every row that carries one', () => {
      const result = parser.sanitise(
        officer(
          `"Offline","Main tank",2/2/2023 3:00:00pm,"${CANARY}-01",${CANARY}-AUTHOR-01,3/3/2023 4:00:00pm`,
        ),
      );

      const text = result.csv.toString('utf8');

      expect(text).not.toContain(CANARY);
      expect(text).not.toContain('Officer Comment');
      expect(result.officerTailRowCount).toBe(1);
      expect(result.headerShape).toBe(RosterSourceHeaderShape.OFFICER);
    });

    it('keeps the twelve allowed values from a row whose tail it discarded', () => {
      const result = parser.sanitise(
        officer(
          `"Offline","Main tank",2/2/2023 3:00:00pm,"${CANARY}-01",${CANARY}-AUTHOR-01,3/3/2023 4:00:00pm`,
        ),
      );

      expect(result.csv.toString('utf8')).toBe(
        '"Character Name","Account Handle","Level","Class","Guild Rank",' +
          '"Contribution Total","Join Date","Rank Change Date",' +
          '"Last Active Date","Status","Public Comment",' +
          '"Public Comment Last Edit Date"\n' +
          '"Kell Marr","@fixture001","65","Starfleet Tactical Officer",' +
          '"Member","1000","1/1/2022 1:00:00am","2/2/2023 2:00:00pm",' +
          '"3/3/2024 3:00:00am","Offline","Main tank","2/2/2023 3:00:00pm"\n',
      );
    });

    it('produces the same twelve-column shape whichever header arrived', () => {
      const fromNormal = parser.sanitise(
        normal('"Offline","Main tank",2/2/2023 3:00:00pm'),
      );
      const fromOfficer = parser.sanitise(
        officer(
          `"Offline","Main tank",2/2/2023 3:00:00pm,"${CANARY}-01",${CANARY}-AUTHOR-01,3/3/2023 4:00:00pm`,
        ),
      );

      expect(fromOfficer.csv.equals(fromNormal.csv)).toBe(true);
      expect(fromNormal.headerShape).toBe(RosterSourceHeaderShape.NORMAL);
      expect(fromNormal.officerTailRowCount).toBe(0);
    });

    it('accepts a fifteen-column export whose rows omit the tail', () => {
      const result = parser.sanitise(
        officer(
          '"Offline","No officer note here",2/2/2023 3:00:00pm',
          `"Away","With one",,"${CANARY}-02",${CANARY}-AUTHOR-02,`,
        ),
      );

      expect(result.rowCount).toBe(2);
      expect(result.officerTailRowCount).toBe(1);
      expect(result.csv.toString('utf8')).not.toContain(CANARY);
    });

    it('refuses an officer tail under a twelve-column header', () => {
      expectRejection(
        normal(
          `"Offline","Main tank",2/2/2023 3:00:00pm,"${CANARY}-01",${CANARY}-AUTHOR-01,3/3/2023 4:00:00pm`,
        ),
        RosterCsvRejectionCode.ROW_UNPARSEABLE,
        2,
      );
    });
  });

  describe('the committed corpus fixtures', () => {
    it.each([
      ['Fixture Basic Fleet_20240101-120000.Csv', 2, 0],
      ['Fixture Officer Fleet_20240102-120000.Csv', 2, 2],
      ['Fixture Officer Fleet_20240103-120000.Csv', 3, 1],
      ['Fixture Quoting Fleet_20240104-120000.Csv', 3, 2],
      ['Fixture Duplicate Fleet_20240105-120000.Csv', 3, 0],
      ['Fixture Bom Fleet_20240107-120000.Csv', 1, 0],
      ['Fixture Suffixed Fleet_20240109-120000 - Steve Export.Csv', 1, 0],
      ['Fixture Dst Gap Fleet_20240310-030000.Csv', 1, 0],
      ['Fixture Timezone Fleet_20260824-011338.Csv', 4, 0],
      ['Fixture Timezone Fleet_20260824-061342.Csv', 4, 0],
      ['Fixture Reset Fleet_20220328-035909.Csv', 1, 0],
      ['Fixture Reset Fleet_20220426-230735.Csv', 1, 0],
      ['Fixture Rename Fleet_20211221-034426.Csv', 1, 0],
      ['Fixture Rename Fleet_20220112-014309.Csv', 1, 0],
      ['Fixture Account Rename Fleet_20230604-021823.Csv', 1, 0],
      ['Fixture Account Rename Fleet_20230715-001404.Csv', 1, 0],
      ['.Fixture Dotted Fleet._20240111-120000.Csv', 1, 0],
      ['- Fixture Hyphen Fleet -_20240113-120000.Csv', 1, 0],
      ['« Fixture Guillemet Fleet »_20240112-120000.Csv', 1, 0],
      ["Fixture qa'Hom Fleet_20240114-120000.Csv", 1, 0],
    ])('sanitises %s', (filename, rowCount, officerTailRowCount) => {
      const result = parser.sanitise(fixture(filename));

      expect(result.rowCount).toBe(rowCount);
      expect(result.officerTailRowCount).toBe(officerTailRowCount);
      expect(result.csv.toString('utf8')).not.toContain(CANARY);
      expect(result.parserVersion).toBe(ROSTER_PARSER_VERSION);
    });

    it('keeps the literal quotes a real public comment contains', () => {
      const result = parser.sanitise(
        fixture('Fixture Quoting Fleet_20240104-120000.Csv'),
      );

      // The corpus shape that defeats strict RFC 4180: an unescaped quote
      // inside a quoted field. It survives, doubled, into the sanitised file.
      expect(result.csv.toString('utf8')).toContain(
        '"Call me ""Renn"", not Renner"',
      );
      expect(result.csv.toString('utf8')).toContain('"Away, back Monday"');
    });

    it('refuses the ambiguous-tail fixture rather than guessing', () => {
      expectRejection(
        fixture('Fixture Ambiguous Fleet_20240108-120000.Csv'),
        RosterCsvRejectionCode.ROW_AMBIGUOUS,
        2,
      );
    });

    it('refuses the bad-header fixture rather than parsing permissively', () => {
      expectRejection(
        fixture('Fixture Bad Header Fleet_20240110-120000.Csv'),
        RosterCsvRejectionCode.HEADER_UNRECOGNISED,
        1,
      );
    });
  });

  describe('what it deliberately does not judge', () => {
    it('accepts a duplicate Character and handle, which FC-016 rejects', () => {
      const result = parser.sanitise(
        fixture('Fixture Duplicate Fleet_20240105-120000.Csv'),
      );

      expect(result.rowCount).toBe(3);
    });

    it('accepts a date that does not exist, which FC-016 rejects', () => {
      const result = parser.sanitise(
        fixture('Fixture Dst Gap Fleet_20240310-030000.Csv'),
      );

      expect(result.rowCount).toBe(1);
    });

    it('accepts a research filename, which FC-016 rejects', () => {
      const result = parser.sanitise(
        fixture('Fixture Suffixed Fleet_20240109-120000 - Steve Export.Csv'),
      );

      expect(result.rowCount).toBe(1);
    });

    it('accepts a date of the right shape that is not a real date', () => {
      const result = parser.sanitise(
        normal('"Offline","",99/99/2024 99:99:99pm'),
      );

      expect(result.csv.toString('utf8')).toContain('"99/99/2024 99:99:99pm"');
    });
  });

  describe('the whole file', () => {
    it('refuses an empty upload', () => {
      expectRejection(Buffer.alloc(0), RosterCsvRejectionCode.FILE_EMPTY, null);
    });

    it('refuses an upload above the size limit', () => {
      expectRejection(
        Buffer.alloc(ROSTER_CSV_LIMITS.maxSourceBytes + 1, 0x41),
        RosterCsvRejectionCode.FILE_TOO_LARGE,
        null,
      );
    });

    it('refuses bytes that are not UTF-8', () => {
      expectRejection(
        Buffer.from([0xff, 0xfe, 0x41]),
        RosterCsvRejectionCode.ENCODING_NOT_UTF8,
        null,
      );
    });

    it('accepts a byte order mark and does not retain it', () => {
      const result = parser.sanitise(
        Buffer.concat([
          Buffer.from([0xef, 0xbb, 0xbf]),
          normal('"Offline","",'),
        ]),
      );

      expect(result.rowCount).toBe(1);
      expect(result.csv[0]).toBe('"'.charCodeAt(0));
    });

    it('accepts LF line endings as well as CRLF', () => {
      const source = Buffer.from(
        `${ROSTER_NORMAL_HEADER_LINE}\n${PREFIX},"Offline","",\n`,
        'utf8',
      );

      expect(parser.sanitise(source).rowCount).toBe(1);
    });

    it('accepts a file with no terminating newline', () => {
      const source = Buffer.from(
        `${ROSTER_NORMAL_HEADER_LINE}\n${PREFIX},"Offline","",`,
        'utf8',
      );

      expect(parser.sanitise(source).rowCount).toBe(1);
    });

    it('accepts a header with no rows', () => {
      const result = parser.sanitise(
        Buffer.from(ROSTER_NORMAL_HEADER_LINE, 'utf8'),
      );

      expect(result.rowCount).toBe(0);
      expect(result.csv.toString('utf8').split('\n')).toHaveLength(2);
    });

    it('refuses a blank line in the middle of a file', () => {
      const source = Buffer.from(
        `${ROSTER_NORMAL_HEADER_LINE}\n\n${PREFIX},"Offline","",\n`,
        'utf8',
      );

      expectRejection(source, RosterCsvRejectionCode.BLANK_LINE, 2);
    });

    it('refuses a header it does not recognise exactly', () => {
      const source = Buffer.from(
        `${ROSTER_NORMAL_HEADER_LINE.toLowerCase()}\n`,
        'utf8',
      );

      expectRejection(source, RosterCsvRejectionCode.HEADER_UNRECOGNISED, 1);
    });

    it('refuses more rows than the limit allows', () => {
      const tails = Array<string>(ROSTER_CSV_LIMITS.maxRows + 1).fill(
        '"Offline","",',
      );

      expectRejection(
        normal(...tails),
        RosterCsvRejectionCode.TOO_MANY_ROWS,
        ROSTER_CSV_LIMITS.maxRows + 2,
      );
    });
  });

  describe('the line', () => {
    it('refuses a line longer than the limit allows', () => {
      const comment = 'a'.repeat(ROSTER_CSV_LIMITS.maxLineLength);

      expectRejection(
        normal(`"Offline","${comment}",`),
        RosterCsvRejectionCode.LINE_TOO_LONG,
        2,
      );
    });

    it('refuses a carriage return that does not end a line', () => {
      expectRejection(
        normal('"Offline","two\rlines",'),
        RosterCsvRejectionCode.LINE_ENDING_UNSUPPORTED,
        2,
      );
    });

    it('refuses a NUL byte', () => {
      expectRejection(
        normal('"Offline","na\u0000me",'),
        RosterCsvRejectionCode.CONTROL_CHARACTER,
        2,
      );
    });

    it('refuses a delete character', () => {
      expectRejection(
        normal('"Offline","na\u007fme",'),
        RosterCsvRejectionCode.CONTROL_CHARACTER,
        2,
      );
    });

    it('allows a tab, which is ordinary text', () => {
      const result = parser.sanitise(normal('"Offline","a\tb",'));

      expect(result.csv.toString('utf8')).toContain('"a\tb"');
    });

    it('refuses a line with more quotes than it will consider', () => {
      const quotes = '"'.repeat(ROSTER_CSV_LIMITS.maxQuotesPerLine + 1);

      expectRejection(
        normal(`"Offline","${quotes}",`),
        RosterCsvRejectionCode.TOO_MANY_QUOTES,
        2,
      );
    });

    it('refuses a retained value longer than the limit allows', () => {
      const comment = 'a'.repeat(ROSTER_CSV_LIMITS.maxFieldLength + 1);

      expectRejection(
        normal(`"Offline","${comment}",`),
        RosterCsvRejectionCode.FIELD_TOO_LONG,
        2,
      );
    });
  });

  describe('the row prefix', () => {
    it('refuses a row with fewer than nine leading commas', () => {
      const source = Buffer.from(
        `${ROSTER_NORMAL_HEADER_LINE}\nNot,enough,fields\n`,
        'utf8',
      );

      expectRejection(source, RosterCsvRejectionCode.ROW_PREFIX_MALFORMED, 2);
    });

    it('asks nothing of the nine beyond their being comma-free', () => {
      const source = Buffer.from(
        `${ROSTER_NORMAL_HEADER_LINE}\n` +
          `Ke"ll,@h,not a level,C,R,x,a,b,c,"Offline","",\n`,
        'utf8',
      );

      expect(parser.sanitise(source).rowCount).toBe(1);
    });
  });

  describe('the tail', () => {
    const DATE = '1/1/2024 1:00:00am';
    const OTHER_DATE = '2/2/2024 2:00:00pm';

    it('refuses a tail that does not open with a quoted Status', () => {
      expectRejection(
        normal('Offline,"",'),
        RosterCsvRejectionCode.ROW_UNPARSEABLE,
        2,
      );
    });

    it('refuses a tail with no Status boundary at all', () => {
      expectRejection(
        normal('"Offline no end'),
        RosterCsvRejectionCode.ROW_UNPARSEABLE,
        2,
      );
    });

    it('takes a later boundary when an earlier one leaves an impossible date', () => {
      // The first candidate closing quote leaves `b,"c",` as the edit date,
      // which is neither empty nor date-shaped; the second leaves nothing.
      const result = parser.sanitise(normal('"S","a",b,"c",'));

      expect(result.csv.toString('utf8')).toContain('"a"",b,""c"');
    });

    it('accepts either case of meridiem', () => {
      expect(
        parser.sanitise(normal('"S","c",1/2/2024 3:04:05AM')).rowCount,
      ).toBe(1);
    });

    it('refuses a row two readings satisfy', () => {
      expectRejection(
        normal('"S","a","b",'),
        RosterCsvRejectionCode.ROW_AMBIGUOUS,
        2,
      );
    });

    it('refuses a row two readings satisfy through the officer tail', () => {
      expectRejection(
        officer(`"S","C",,"X",${DATE},"Z",W,${OTHER_DATE}`),
        RosterCsvRejectionCode.ROW_AMBIGUOUS,
        2,
      );
    });

    it('refuses a malformed officer tail rather than absorbing it', () => {
      // Without the date anchor this parses as a twelve-field row whose
      // Public Comment has swallowed the officer note.
      expectRejection(
        officer('"S","C",d,"OFFICER NOTE",A'),
        RosterCsvRejectionCode.ROW_UNPARSEABLE,
        2,
      );
    });

    it('refuses an officer tail whose edit date holds a comma', () => {
      expectRejection(
        officer(`"S","C",x,y,"O",A,${DATE}`),
        RosterCsvRejectionCode.ROW_UNPARSEABLE,
        2,
      );
    });

    it('refuses an officer comment that is never closed', () => {
      expectRejection(
        officer('"S","C",,"O'),
        RosterCsvRejectionCode.ROW_UNPARSEABLE,
        2,
      );
    });

    it('refuses an officer tail with no author separator', () => {
      expectRejection(
        officer('"S","C",,"O",A'),
        RosterCsvRejectionCode.ROW_UNPARSEABLE,
        2,
      );
    });

    it('refuses a row whose tail would cost more than its budget', () => {
      // Thirty-two quotes, which is within the quote cap, arranged so that
      // every one of them is a candidate boundary and none of the readings
      // they suggest is valid. Without the step budget this is quadratic.
      expectRejection(
        officer(`${'",'.repeat(ROSTER_CSV_LIMITS.maxQuotesPerLine)}X`),
        RosterCsvRejectionCode.ROW_PARSE_BUDGET,
        2,
      );
    });

    it('refuses an officer date that is not date-shaped', () => {
      expectRejection(
        officer('"S","C",,"O",A,not a date'),
        RosterCsvRejectionCode.ROW_UNPARSEABLE,
        2,
      );
    });

    it.each([
      ['a month with three digits', '111/1/2024 1:00:00am'],
      ['a year with two digits', '1/1/24 1:00:00am'],
      ['a missing separator', '1/1/2024 1-00-00am'],
      ['a missing meridiem', '1/1/2024 1:00:00'],
      ['an unknown meridiem', '1/1/2024 1:00:00xm'],
      ['trailing text', '1/1/2024 1:00:00amm'],
      ['no digits at all', 'not a date at all'],
    ])('refuses an edit date with %s', (_description, date) => {
      expectRejection(
        normal(`"S","c",${date}`),
        RosterCsvRejectionCode.ROW_UNPARSEABLE,
        2,
      );
    });
  });

  describe('the sanitised bytes', () => {
    it('quotes every field and doubles internal quotes', () => {
      const result = parser.sanitise(normal('"He said ""hi""","plain",'));

      expect(result.csv.toString('utf8')).toContain(
        '"He said """"hi""""","plain",""',
      );
    });

    it('ends every line with LF and nothing else', () => {
      const text = parser
        .sanitise(normal('"Offline","",'))
        .csv.toString('utf8');

      expect(text).not.toContain('\r');
      expect(text.endsWith('\n')).toBe(true);
    });

    it('keeps rows in source order', () => {
      const result = parser.sanitise(
        normal('"First","",', '"Second","",', '"Third","",'),
      );
      const text = result.csv.toString('utf8');

      expect(text.indexOf('"First"')).toBeLessThan(text.indexOf('"Second"'));
      expect(text.indexOf('"Second"')).toBeLessThan(text.indexOf('"Third"'));
    });
  });
});
