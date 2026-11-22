import * as fc from 'fast-check';

import {
  ROSTER_ALLOWED_COLUMNS,
  ROSTER_CSV_LIMITS,
  ROSTER_NORMAL_HEADER_LINE,
  ROSTER_OFFICER_HEADER_LINE,
} from 'src/fleet/imports/constants/roster-csv.constants';
import { RosterCsvRejectedError } from 'src/fleet/imports/errors/roster-csv-rejected.error';
import { RosterCsvPrivacyParserService } from 'src/fleet/imports/services/roster-csv-privacy-parser.service';

/**
 * Fuzzing the privacy boundary (FC-009).
 *
 * The plan asks for quote, comma and delimiter injection and for resource
 * limits, and this is where that happens. The properties are chosen so that
 * each one fails loudly for a different kind of mistake:
 *
 * 1. Whatever arrives, the only way out is a sanitised file or a
 *    {@link RosterCsvRejectedError}. No other exception, ever — because any
 *    other exception is an unhandled path, and an unhandled path in an ingress
 *    parser is a 500 that somebody can trigger on purpose.
 * 2. Nothing a person can type into an officer note reaches the output.
 * 3. Nothing a person can type into a public comment changes how many columns
 *    the output has. This is the injection property: if quoting were minimal
 *    rather than uniform, a comment containing a comma would be the bug.
 * 4. The output is strict RFC 4180 and round-trips, unlike its input.
 */

const CANARY = ['OFFICER', 'CANARY'].join('-');

/** Text a person might plausibly get into a free-text field, and worse. */
const NASTY_TEXT = fc.oneof(
  fc.string({ maxLength: 40 }),
  fc.constantFrom(
    '',
    'plain',
    'with, a comma',
    'with "quotes"',
    'Call me "Renn", not Renner',
    '","',
    '",',
    ',"',
    '"',
    '""',
    'a","b',
    'a",b,"c',
    '=cmd|calc',
    'ends with a quote"',
    '"starts with a quote',
    '\t tabbed',
    'unicode «guillemets» and qa’Hom',
  ),
);

/** A date STO would write, or the empty string it writes instead. */
const STO_DATE = fc.oneof(
  fc.constant(''),
  fc.constantFrom(
    '1/1/2024 1:00:00am',
    '12/31/2023 11:59:59pm',
    '3/9/2021 7:05:00AM',
  ),
);

/** Nine unquoted, comma-free fields. */
const PREFIX =
  'Kell Marr,@fixture001,65,Starfleet Tactical Officer,Member,1000,' +
  '1/1/2022 1:00:00am,2/2/2023 2:00:00pm,3/3/2024 3:00:00am';

/**
 * Reads a strict RFC 4180 record, which the sanitised output always is.
 *
 * Deliberately a different implementation from the one under test: using the
 * parser to check its own output would prove only that it is self-consistent.
 *
 * @param line - One line of the sanitised file.
 * @returns The fields it holds.
 */
function readStrictCsvLine(line: string): string[] {
  const fields: string[] = [];

  let current = '';
  let inQuotes = false;
  let index = 0;

  while (index < line.length) {
    const character = line[index];

    if (inQuotes) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 2;
          continue;
        }

        inQuotes = false;
        index += 1;
        continue;
      }

      current += character;
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }

    if (character === ',') {
      fields.push(current);
      current = '';
      index += 1;
      continue;
    }

    current += character;
    index += 1;
  }

  fields.push(current);

  return fields;
}

describe('Roster CSV privacy parser fuzz tests', () => {
  const numRuns = Number(process.env['FUZZ_NUM_RUNS']) || 100;
  const parser = new RosterCsvPrivacyParserService();

  it('answers arbitrary bytes with a sanitised file or a refusal, never anything else', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ maxLength: 512 }),
        (bytes: Uint8Array): void => {
          try {
            parser.sanitise(Buffer.from(bytes));
          } catch (error) {
            expect(error).toBeInstanceOf(RosterCsvRejectedError);
          }
        },
      ),
      { numRuns: numRuns * 5 },
    );
  });

  it('answers an arbitrary line under a real header the same way', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(ROSTER_NORMAL_HEADER_LINE, ROSTER_OFFICER_HEADER_LINE),
        fc.string({ maxLength: 200 }),
        (header: string, line: string): void => {
          try {
            parser.sanitise(Buffer.from(`${header}\r\n${line}\r\n`, 'utf8'));
          } catch (error) {
            expect(error).toBeInstanceOf(RosterCsvRejectedError);
          }
        },
      ),
      { numRuns: numRuns * 5 },
    );
  });

  it('never lets officer text out, whatever the note says', () => {
    fc.assert(
      fc.property(
        NASTY_TEXT,
        NASTY_TEXT,
        NASTY_TEXT,
        STO_DATE,
        STO_DATE,
        (
          status: string,
          comment: string,
          note: string,
          editDate: string,
          officerDate: string,
        ): void => {
          const marked = `${CANARY}${note}${CANARY}`;
          const line =
            `${PREFIX},"${status}","${comment}",${editDate},` +
            `"${marked}",${CANARY}-AUTHOR,${officerDate}`;
          const source = Buffer.from(
            `${ROSTER_OFFICER_HEADER_LINE}\r\n${line}\r\n`,
            'utf8',
          );

          let sanitised: string;

          try {
            sanitised = parser.sanitise(source).csv.toString('utf8');
          } catch (error) {
            expect(error).toBeInstanceOf(RosterCsvRejectedError);

            return;
          }

          expect(sanitised).not.toContain(CANARY);
        },
      ),
      { numRuns: numRuns * 5 },
    );
  });

  it('gives twelve fields per row whatever a comment contains', () => {
    fc.assert(
      fc.property(
        NASTY_TEXT,
        NASTY_TEXT,
        STO_DATE,
        (status: string, comment: string, editDate: string): void => {
          const line = `${PREFIX},"${status}","${comment}",${editDate}`;
          const source = Buffer.from(
            `${ROSTER_NORMAL_HEADER_LINE}\r\n${line}\r\n`,
            'utf8',
          );

          let sanitised: string;

          try {
            sanitised = parser.sanitise(source).csv.toString('utf8');
          } catch (error) {
            expect(error).toBeInstanceOf(RosterCsvRejectedError);

            return;
          }

          const lines = sanitised.split('\n').filter(entry => entry.length > 0);

          expect(lines).toHaveLength(2);

          for (const entry of lines) {
            expect(readStrictCsvLine(entry)).toHaveLength(
              ROSTER_ALLOWED_COLUMNS.length,
            );
          }

          expect(readStrictCsvLine(lines[0])).toEqual([
            ...ROSTER_ALLOWED_COLUMNS,
          ]);
        },
      ),
      { numRuns: numRuns * 5 },
    );
  });

  it('stays inside its bounds however many quotes a line holds', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 80 }), (repeats: number): void => {
        const line = `${PREFIX},${'","'.repeat(repeats)}`;
        const source = Buffer.from(
          `${ROSTER_OFFICER_HEADER_LINE}\r\n${line}\r\n`,
          'utf8',
        );
        const started = Date.now();

        try {
          parser.sanitise(source);
        } catch (error) {
          expect(error).toBeInstanceOf(RosterCsvRejectedError);
        }

        // A generous ceiling. The point is that the cost does not grow with
        // the adversary's effort, not that any particular millisecond count
        // is meaningful on a busy machine.
        expect(Date.now() - started).toBeLessThan(1000);
      }),
      { numRuns },
    );
  });

  it('refuses anything over its size limit without decoding it', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4096 }), (excess: number): void => {
        const source = Buffer.alloc(
          ROSTER_CSV_LIMITS.maxSourceBytes + excess,
          0x41,
        );

        expect(() => parser.sanitise(source)).toThrow(RosterCsvRejectedError);
      }),
      { numRuns: Math.min(numRuns, 10) },
    );
  });
});
