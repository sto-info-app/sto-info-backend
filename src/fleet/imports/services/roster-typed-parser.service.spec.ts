import { ROSTER_ALLOWED_COLUMNS } from '../constants/roster-csv.constants';
import { ROSTER_STORED_TEXT_MAX_LENGTH } from '../constants/roster-typed.constants';
import { RosterDateResolution } from '../enums/roster-date-resolution.enum';
import { RosterProfession } from '../enums/roster-profession.enum';
import { RosterRowRejectionCode } from '../enums/roster-row-rejection-code.enum';
import {
  RosterObservationRow,
  RosterTypedParserService,
} from './roster-typed-parser.service';

const LONDON = 'Europe/London';
const NEW_YORK = 'America/New_York';

/** The twelve columns, in order, with something unremarkable in each. */
const BASELINE: Record<string, string> = {
  'Character Name': 'Vex Loran',
  'Account Handle': '@vexloran',
  Level: '65',
  Class: 'Starfleet Tactical Officer',
  'Guild Rank': 'Member',
  'Contribution Total': '5000',
  'Join Date': '4/1/2023 12:00:00pm',
  'Rank Change Date': '',
  'Last Active Date': '1/5/2024 1:00:00pm',
  Status: 'Offline',
  'Public Comment': '',
  'Public Comment Last Edit Date': '',
};

/**
 * Writes a row in the canonical sanitised form: every field quoted, internal
 * quotes doubled.
 *
 * @param overrides - Columns to change, by their exported name.
 * @returns The line, without its terminator.
 */
function line(overrides: Record<string, string> = {}): string {
  const values = { ...BASELINE, ...overrides };

  return ROSTER_ALLOWED_COLUMNS.map(
    column => `"${values[column].replaceAll('"', '""')}"`,
  ).join(',');
}

/** The canonical header, as the serialiser writes it. */
const HEADER = ROSTER_ALLOWED_COLUMNS.map(column => `"${column}"`).join(',');

/**
 * Assembles a canonical file.
 *
 * @param rows - The data lines.
 * @returns The bytes, with the trailing newline the serialiser writes.
 */
function file(...rows: string[]): Buffer {
  return Buffer.from(`${[HEADER, ...rows].join('\n')}\n`, 'utf8');
}

describe('RosterTypedParserService', () => {
  let service: RosterTypedParserService;

  beforeEach(() => {
    service = new RosterTypedParserService();
  });

  describe('reading a well-formed export', () => {
    it('reads every column into a value', () => {
      const { rows, problems } = service.read(file(line()), LONDON);

      expect(problems).toEqual([]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        line: 2,
        characterName: 'Vex Loran',
        accountHandle: '@vexloran',
        level: 65,
        className: 'Starfleet Tactical Officer',
        profession: RosterProfession.TACTICAL,
        guildRank: 'Member',
        contributionTotal: 5000,
        status: 'Offline',
        publicComment: '',
      });
    });

    it('counts the rows the file held', () => {
      const roster = service.read(
        file(line(), line({ 'Character Name': 'B' })),
        LONDON,
      );

      expect(roster.rowCount).toBe(2);
    });

    it('reads a file that does not end in a newline', () => {
      const bytes = Buffer.from(`${HEADER}\n${line()}`, 'utf8');

      expect(service.read(bytes, LONDON).rows).toHaveLength(1);
    });

    it('reads a header with no rows after it', () => {
      const roster = service.read(file(), LONDON);

      expect(roster).toMatchObject({ rows: [], problems: [], rowCount: 0 });
    });

    // The canonical form doubles an internal quote, and a player who typed one
    // into a comment gets it back as they typed it.
    it('undoubles a quote inside a value', () => {
      const roster = service.read(
        file(line({ 'Public Comment': 'Call me "Renn"' })),
        LONDON,
      );

      expect(roster.rows[0].publicComment).toBe('Call me "Renn"');
    });

    it('keeps a comma inside a value', () => {
      const roster = service.read(
        file(line({ Status: 'Away, back Monday' })),
        LONDON,
      );

      expect(roster.rows[0].status).toBe('Away, back Monday');
    });
  });

  describe('dates', () => {
    /**
     * Reads one row and returns its join date.
     *
     * @param value - The Join Date column's value.
     * @param timezone - The zone the export was written in.
     * @returns The row's reading of that date, if the row could be read.
     */
    function joinDate(
      value: string,
      timezone = LONDON,
    ): RosterObservationRow['joinedAt'] | undefined {
      return service.read(file(line({ 'Join Date': value })), timezone).rows[0]
        ?.joinedAt;
    }

    it('resolves an afternoon time through the export timezone', () => {
      expect(joinDate('4/1/2023 12:00:00pm')).toEqual({
        resolution: RosterDateResolution.EXACT,
        local: '2023-04-01T12:00:00',
        candidates: [new Date('2023-04-01T11:00:00.000Z')],
      });
    });

    // Midnight and midday are the two the twelve-hour clock gets wrong if it
    // is folded arithmetically without thinking about them.
    it('reads twelve in the morning as midnight', () => {
      expect(joinDate('4/1/2023 12:30:00am')?.local).toBe(
        '2023-04-01T00:30:00',
      );
    });

    it('reads twelve in the afternoon as midday', () => {
      expect(joinDate('4/1/2023 12:30:00pm')?.local).toBe(
        '2023-04-01T12:30:00',
      );
    });

    it('reads a single-digit hour in the afternoon', () => {
      expect(joinDate('4/1/2023 1:05:09pm')?.local).toBe('2023-04-01T13:05:09');
    });

    it('accepts either case of the meridiem', () => {
      expect(joinDate('4/1/2023 1:05:09PM')?.local).toBe('2023-04-01T13:05:09');
    });

    it('reports an empty date as absent', () => {
      expect(joinDate('')).toEqual({
        resolution: RosterDateResolution.ABSENT,
        local: null,
        candidates: [],
      });
    });

    it('refuses a value that is not an STO date at all', () => {
      const roster = service.read(
        file(line({ 'Join Date': '2023-04-01T12:00:00Z' })),
        LONDON,
      );

      expect(roster.problems).toEqual([
        {
          code: RosterRowRejectionCode.DATE_MALFORMED,
          line: 2,
          column: 'Join Date',
        },
      ]);
      expect(roster.rows).toEqual([]);
    });

    // The shape is right and the day is not: February has no thirtieth in any
    // year, so there is no instant to resolve it to.
    it('refuses a date-shaped value naming a day that does not exist', () => {
      expect(joinDate('2/30/2024 9:00:00am')).toBeUndefined();
    });

    // `13:00:00am` matches the digits the pattern asks for. Folding it into a
    // twenty-four-hour clock would quietly make it one in the morning.
    it('refuses an hour the twelve-hour clock does not have', () => {
      expect(joinDate('4/1/2023 13:00:00am')).toBeUndefined();
    });

    it('refuses an hour of zero', () => {
      expect(joinDate('4/1/2023 0:30:00am')).toBeUndefined();
    });

    // Half past two does not exist in New York on 10 March 2024: the clock
    // goes from two to three. Reading it as half past three would record a
    // moment nobody observed. This is the roster fixture's own case.
    it('refuses a local time inside a spring-forward gap', () => {
      const roster = service.read(
        file(line({ 'Join Date': '3/10/2024 2:30:00am' })),
        NEW_YORK,
      );

      expect(roster.problems).toEqual([
        {
          code: RosterRowRejectionCode.DATE_NONEXISTENT,
          line: 2,
          column: 'Join Date',
        },
      ]);
    });

    // Half past one happens twice on the morning the clocks go back. Both are
    // real, and choosing between them is not this application's to do.
    it('keeps both instants of a repeated autumn hour', () => {
      expect(joinDate('10/25/2026 1:30:00am')).toEqual({
        resolution: RosterDateResolution.AMBIGUOUS,
        local: '2026-10-25T01:30:00',
        candidates: [
          new Date('2026-10-25T00:30:00.000Z'),
          new Date('2026-10-25T01:30:00.000Z'),
        ],
      });
    });

    it('counts the rows holding an ambiguous date', () => {
      const roster = service.read(
        file(
          line({ 'Join Date': '10/25/2026 1:30:00am' }),
          line({
            'Character Name': 'Other',
            'Last Active Date': '10/25/2026 1:45:00am',
          }),
          line({ 'Character Name': 'Third' }),
        ),
        LONDON,
      );

      expect(roster.ambiguousDateCount).toBe(2);
    });

    // A date is a row's own local time, read against the rules in force on
    // that date. The controlled corpus pair only agrees because of this: an
    // export taken in August carries join dates from every month of the year.
    it('applies the offset in force on each date, not on the export day', () => {
      const winter = joinDate('1/15/2023 12:00:00pm');
      const summer = joinDate('7/15/2023 12:00:00pm');

      expect(winter?.candidates[0]).toEqual(
        new Date('2023-01-15T12:00:00.000Z'),
      );
      expect(summer?.candidates[0]).toEqual(
        new Date('2023-07-15T11:00:00.000Z'),
      );
    });

    it('reads the same wall-clock time to different instants in two zones', () => {
      expect(joinDate('4/1/2023 12:00:00pm', NEW_YORK)?.candidates[0]).toEqual(
        new Date('2023-04-01T16:00:00.000Z'),
      );
    });

    it.each([
      ['Rank Change Date', 'rankChangedAt'],
      ['Last Active Date', 'lastActiveAt'],
      ['Public Comment Last Edit Date', 'publicCommentEditedAt'],
    ])('refuses a malformed %s as well', column => {
      const roster = service.read(
        file(line({ [column]: 'not a date' })),
        LONDON,
      );

      expect(roster.problems).toEqual([
        { code: RosterRowRejectionCode.DATE_MALFORMED, line: 2, column },
      ]);
    });

    it('reports every unreadable date on a row, not just the first', () => {
      const roster = service.read(
        file(line({ 'Join Date': 'no', 'Last Active Date': 'no' })),
        LONDON,
      );

      expect(roster.problems).toHaveLength(2);
    });
  });

  describe('required and numeric columns', () => {
    it('refuses a row that names nobody', () => {
      const roster = service.read(
        file(line({ 'Character Name': '  ' })),
        LONDON,
      );

      expect(roster.problems).toEqual([
        {
          code: RosterRowRejectionCode.CHARACTER_NAME_EMPTY,
          line: 2,
          column: 'Character Name',
        },
      ]);
    });

    it('refuses a row that belongs to nobody', () => {
      const roster = service.read(file(line({ 'Account Handle': '' })), LONDON);

      expect(roster.problems).toEqual([
        {
          code: RosterRowRejectionCode.ACCOUNT_HANDLE_EMPTY,
          line: 2,
          column: 'Account Handle',
        },
      ]);
    });

    it.each(['', 'sixty-five', '-1', '65.5', ' 65', '12345'])(
      'refuses a level of %p',
      value => {
        const roster = service.read(file(line({ Level: value })), LONDON);

        expect(roster.problems).toEqual([
          {
            code: RosterRowRejectionCode.LEVEL_MALFORMED,
            line: 2,
            column: 'Level',
          },
        ]);
      },
    );

    it.each(['', '1,000', '-5', '1234567890123456'])(
      'refuses a contribution total of %p',
      value => {
        const roster = service.read(
          file(line({ 'Contribution Total': value })),
          LONDON,
        );

        expect(roster.problems).toEqual([
          {
            code: RosterRowRejectionCode.CONTRIBUTION_MALFORMED,
            line: 2,
            column: 'Contribution Total',
          },
        ]);
      },
    );

    // The largest figure in the analysed corpus, and a reset to zero, which is
    // a discontinuity rather than a withdrawal and has to be readable as one.
    it.each(['0', '164858584'])('accepts a contribution total of %p', value => {
      const roster = service.read(
        file(line({ 'Contribution Total': value })),
        LONDON,
      );

      expect(roster.rows[0].contributionTotal).toBe(Number(value));
    });
  });

  describe('the Class column', () => {
    it.each([
      ['Starfleet Tactical Officer', RosterProfession.TACTICAL],
      ['KDF Engineering Officer', RosterProfession.ENGINEERING],
      ['Starfleet Science Officer', RosterProfession.SCIENCE],
      ['RRF Tactical Officer', RosterProfession.TACTICAL],
    ])('reads the profession out of %p', (className, profession) => {
      const roster = service.read(file(line({ Class: className })), LONDON);

      expect(roster.rows[0].profession).toBe(profession);
    });

    // Two rows in the analysed corpus carry a ship name in this column. The
    // value is kept exactly and the profession is simply not known.
    it('keeps a Class it cannot read a profession from', () => {
      const roster = service.read(
        file(line({ Class: "B'rel Bird-of-Prey" })),
        LONDON,
      );

      expect(roster.rows[0]).toMatchObject({
        className: "B'rel Bird-of-Prey",
        profession: null,
      });
      expect(roster.problems).toEqual([]);
      expect(roster.unknownClassCount).toBe(1);
    });

    // Naming two professions names neither. Guessing which was meant is how a
    // Character ends up filed under a career they do not have.
    it('reads no profession from a value naming two', () => {
      const roster = service.read(
        file(line({ Class: 'Tactical Science Officer' })),
        LONDON,
      );

      expect(roster.rows[0].profession).toBeNull();
    });

    it('does not read a profession out of a longer word', () => {
      const roster = service.read(file(line({ Class: 'Sciences' })), LONDON);

      expect(roster.rows[0].profession).toBeNull();
    });
  });

  describe('a value too long to store', () => {
    /*
     * The observation columns are varchar(255). A value that would not fit
     * is refused where it is read, so that whoever uploaded it is told the
     * line and the column rather than handed a database error from an insert
     * three services later.
     */
    const TOO_LONG = 'x'.repeat(ROSTER_STORED_TEXT_MAX_LENGTH + 1);

    it.each([
      ['Character Name', 'Character Name'],
      ['Account Handle', 'Account Handle'],
      ['Class', 'Class'],
      ['Guild Rank', 'Guild Rank'],
      ['Status', 'Status'],
    ])('refuses a %s that would not fit', (column, reported) => {
      const roster = service.read(file(line({ [column]: TOO_LONG })), LONDON);

      expect(roster.rows).toEqual([]);
      expect(roster.problems).toEqual([
        {
          code: RosterRowRejectionCode.VALUE_TOO_LONG,
          line: 2,
          column: reported,
        },
      ]);
    });

    it('accepts a value exactly as long as the column is wide', () => {
      const roster = service.read(
        file(
          line({
            'Guild Rank': 'x'.repeat(ROSTER_STORED_TEXT_MAX_LENGTH),
          }),
        ),
        LONDON,
      );

      expect(roster.problems).toEqual([]);
      expect(roster.rows).toHaveLength(1);
    });

    // The one column with no width to exceed. A member's comment is where a
    // long value is something somebody wrote rather than a sign of tampering,
    // and the privacy parser has already bounded it at four kilobytes.
    it('accepts a public comment longer than the other columns allow', () => {
      const roster = service.read(
        file(line({ 'Public Comment': TOO_LONG })),
        LONDON,
      );

      expect(roster.problems).toEqual([]);
      expect(roster.rows[0].publicComment).toBe(TOO_LONG);
    });
  });

  describe('identity', () => {
    it('refuses an export naming the same member twice', () => {
      const roster = service.read(file(line(), line()), LONDON);

      expect(roster.problems).toEqual([
        {
          code: RosterRowRejectionCode.DUPLICATE_IDENTITY,
          line: 3,
          column: null,
        },
      ]);
    });

    // One account's alts share a handle and are different people. Refusing
    // them would refuse most real rosters.
    it('accepts two Characters on one account', () => {
      const roster = service.read(
        file(line(), line({ 'Character Name': 'Vex Toran' })),
        LONDON,
      );

      expect(roster.problems).toEqual([]);
      expect(roster.rows).toHaveLength(2);
    });

    it('accepts one name held on two accounts', () => {
      const roster = service.read(
        file(line(), line({ 'Account Handle': '@someoneelse' })),
        LONDON,
      );

      expect(roster.problems).toEqual([]);
    });

    it('sees through a difference of case alone', () => {
      const roster = service.read(
        file(
          line(),
          line({
            'Character Name': 'VEX LORAN',
            'Account Handle': '@VexLoran',
          }),
        ),
        LONDON,
      );

      expect(roster.problems).toHaveLength(1);
    });

    // A leading space is not decoration in this game: it is how two things are
    // deliberately told apart, so it is a real difference here as it is in a
    // Fleet's name.
    it('treats a leading space as a real difference', () => {
      const roster = service.read(
        file(line(), line({ 'Character Name': ' Vex Loran' })),
        LONDON,
      );

      expect(roster.problems).toEqual([]);
    });
  });

  describe('bytes that are not the canonical form', () => {
    it('refuses a file whose header is not the one the serialiser writes', () => {
      const bytes = Buffer.from(`Character Name,Account Handle\n`, 'utf8');

      expect(service.read(bytes, LONDON)).toEqual({
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
      });
    });

    it.each([
      ['a line that does not open with a quote', 'Vex Loran,@vexloran'],
      ['a field whose quote is never closed', '"Vex Loran'],
      ['junk where a delimiter should be', `${line()}x"extra"`],
      ['too few columns', '"one","two"'],
    ])('refuses %s', (_case, row) => {
      const roster = service.read(file(row), LONDON);

      expect(roster.problems).toEqual([
        {
          code: RosterRowRejectionCode.SANITISED_MALFORMED,
          line: 2,
          column: null,
        },
      ]);
    });

    it('refuses a timezone the runtime does not know', () => {
      expect(() => service.read(file(line()), 'Middle/Earth')).toThrow(
        'Unknown timezone: Middle/Earth',
      );
    });

    it('accepts a timezone spelled in the wrong case', () => {
      expect(service.read(file(line()), 'europe/london').rows).toHaveLength(1);
    });
  });
});
