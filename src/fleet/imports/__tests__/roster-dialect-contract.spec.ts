import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { RosterDateResolution } from '../enums/roster-date-resolution.enum';
import { RosterRowRejectionCode } from '../enums/roster-row-rejection-code.enum';
import { RosterCsvRejectedError } from '../errors/roster-csv-rejected.error';
import { RosterCsvPrivacyParserService } from '../services/roster-csv-privacy-parser.service';
import {
  RosterObservationRow,
  RosterTypedParserService,
} from '../services/roster-typed-parser.service';
import { readRosterFilename } from '../utilities/roster-filename.utility';

/**
 * The dialect contract, driven at the committed fixtures (FC-016).
 *
 * Every other spec in this module exercises one piece against inputs written
 * to exercise it. This one runs the whole reading — filename, privacy
 * boundary, typed reader — over the twenty-one synthetic exports in
 * `test/fixtures/fleet-community`, which were generated against the real
 * corpus of 1,199 files and 144,713 rows and whose shapes were verified to
 * match it.
 *
 * The manifest says of each file whether it should be accepted or refused, and
 * that is the contract: a change that makes a rejected fixture pass, or an
 * accepted one fail, is a change to what this application believes an STO
 * roster export is. It should be deliberate, and it should be visible here.
 *
 * The fixtures are entirely synthetic. No value in them is copied from the
 * real corpus, and the officer columns carry a token that exists so a separate
 * sweep can prove it never escapes.
 */

/** The repository root, four levels up from `src/fleet/imports/__tests__`. */
const ROOT = join(__dirname, '..', '..', '..', '..');

/** Where the committed fixtures live. */
const FIXTURES = join(ROOT, 'test', 'fixtures', 'fleet-community');

/** What the generator recorded about each fixture. */
interface ManifestEntry {
  readonly filename: string;
  readonly expectation: 'accept' | 'reject';
  readonly purpose: string;
}

const MANIFEST: { fixtures: ManifestEntry[] } = JSON.parse(
  readFileSync(join(FIXTURES, 'manifest.json'), 'utf8'),
) as { fixtures: ManifestEntry[] };

/**
 * The zone each fixture's exporter was sitting in.
 *
 * UTC by default, deliberately: it has no transitions, so a fixture that is
 * refused is refused for something in the file rather than for an accident of
 * whichever zone the test happened to pick. The three that name a zone name it
 * because the zone is the point of the fixture.
 */
const TIMEZONES: Record<string, string> = {
  'Fixture Timezone Fleet_20260824-011338.Csv': 'America/New_York',
  'Fixture Timezone Fleet_20260824-061342.Csv': 'Europe/London',
  'Fixture Dst Gap Fleet_20240310-030000.Csv': 'America/New_York',
};

const parser = new RosterCsvPrivacyParserService();
const typedParser = new RosterTypedParserService();

/** How far a fixture got, and what stopped it. */
interface Reading {
  /** True when the filename, the bytes and every row were readable. */
  readonly accepted: boolean;
  /** The refusal from the privacy boundary, if it got that far. */
  readonly csvRejection: RosterCsvRejectedError | null;
  /** The rows that could be read into values. */
  readonly rows: readonly RosterObservationRow[];
  /** What stopped the others. */
  readonly problems: readonly { code: RosterRowRejectionCode }[];
}

/**
 * Reads one fixture the way the importer would.
 *
 * @param filename - The fixture's name, which is also its evidence.
 * @returns How far it got.
 */
function read(filename: string): Reading {
  const timezone = TIMEZONES[filename] ?? 'UTC';
  const source = readFileSync(join(FIXTURES, filename));

  if (readRosterFilename(filename) === null) {
    return { accepted: false, csvRejection: null, rows: [], problems: [] };
  }

  let sanitised;

  try {
    sanitised = parser.sanitise(source);
  } catch (error) {
    if (!(error instanceof RosterCsvRejectedError)) {
      throw error;
    }

    return { accepted: false, csvRejection: error, rows: [], problems: [] };
  }

  const typed = typedParser.read(sanitised.csv, timezone);

  return {
    accepted: typed.problems.length === 0,
    csvRejection: null,
    rows: typed.rows,
    problems: typed.problems,
  };
}

describe('the STO roster dialect, against the committed fixtures', () => {
  it('has fixtures to run', () => {
    expect(MANIFEST.fixtures.length).toBeGreaterThan(0);
  });

  it.each(MANIFEST.fixtures.map(entry => [entry.expectation, entry.filename]))(
    'reads %s: %s',
    (expectation, filename) => {
      expect(read(filename).accepted).toBe(expectation === 'accept');
    },
  );

  // Criterion 2, and the evidence for it. The same 93 members exported from
  // New York and from London four seconds apart differ by five hours on most
  // dates and four on the rest, because the two zones change their clocks on
  // different days. Only reading each date against the rules in force on that
  // date makes them agree.
  describe('the controlled pair', () => {
    const eastern = read('Fixture Timezone Fleet_20260824-011338.Csv');
    const british = read('Fixture Timezone Fleet_20260824-061342.Csv');

    it('reads both files', () => {
      expect(eastern.rows.length).toBeGreaterThan(0);
      expect(british.rows).toHaveLength(eastern.rows.length);
    });

    it('normalises every matching date to the same instant', () => {
      for (const [index, row] of eastern.rows.entries()) {
        const counterpart = british.rows[index];

        expect(counterpart.characterName).toBe(row.characterName);
        expect(counterpart.joinedAt.candidates).toEqual(
          row.joinedAt.candidates,
        );
        expect(counterpart.rankChangedAt.candidates).toEqual(
          row.rankChangedAt.candidates,
        );
        expect(counterpart.lastActiveAt.candidates).toEqual(
          row.lastActiveAt.candidates,
        );
      }
    });

    // The raw text differs by five hours in winter and four in the week the
    // two zones are out of step, which is the whole reason the pair exists.
    it('read different local times to get there', () => {
      const locals = eastern.rows.map(row => row.joinedAt.local);
      const counterparts = british.rows.map(row => row.joinedAt.local);

      expect(locals).not.toEqual(counterparts);
    });

    it('reads the two filename stamps four seconds apart', () => {
      expect(
        readRosterFilename('Fixture Timezone Fleet_20260824-011338.Csv'),
      ).toMatchObject({ localStamp: '2026-08-24T01:13:38' });
      expect(
        readRosterFilename('Fixture Timezone Fleet_20260824-061342.Csv'),
      ).toMatchObject({ localStamp: '2026-08-24T06:13:42' });
    });
  });

  describe('why each refused fixture is refused', () => {
    it('refuses an export naming the same member twice', () => {
      expect(
        read('Fixture Duplicate Fleet_20240105-120000.Csv').problems,
      ).toEqual([
        expect.objectContaining({
          code: RosterRowRejectionCode.DUPLICATE_IDENTITY,
        }),
      ]);
    });

    it('refuses a date in an hour the clock skipped', () => {
      expect(
        read('Fixture Dst Gap Fleet_20240310-030000.Csv').problems,
      ).toEqual([
        expect.objectContaining({
          code: RosterRowRejectionCode.DATE_NONEXISTENT,
        }),
      ]);
    });

    it('refuses a manually annotated filename', () => {
      expect(
        readRosterFilename(
          'Fixture Suffixed Fleet_20240109-120000 - Steve Export.Csv',
        ),
      ).toBeNull();
    });

    it('refuses a header the game does not write', () => {
      expect(
        read('Fixture Bad Header Fleet_20240110-120000.Csv').csvRejection?.code,
      ).toBe('HEADER_UNRECOGNISED');
    });

    it('refuses a row whose tail could be read two ways', () => {
      expect(
        read('Fixture Ambiguous Fleet_20240108-120000.Csv').csvRejection?.code,
      ).toBe('ROW_AMBIGUOUS');
    });
  });

  describe('what the accepted fixtures prove', () => {
    it('keeps a Fleet label exactly, whatever punctuation it carries', () => {
      const labels = MANIFEST.fixtures
        .map(entry => readRosterFilename(entry.filename)?.fleetLabel)
        .filter((label): label is string => label !== undefined);

      expect(labels).toContain('.Fixture Dotted Fleet.');
      expect(labels).toContain('« Fixture Guillemet Fleet »');
      expect(labels).toContain('- Fixture Hyphen Fleet -');
      expect(labels).toContain("Fixture qa'Hom Fleet");
    });

    it('reads a file that begins with a byte order mark', () => {
      expect(
        read('Fixture Bom Fleet_20240107-120000.Csv').rows.length,
      ).toBeGreaterThan(0);
    });

    // Two rows in the analysed corpus carry a ship name where a profession
    // should be. The value is kept and the profession is simply not known.
    it('keeps a Class it can read no profession from', () => {
      const rows = read('Fixture Quoting Fleet_20240104-120000.Csv').rows;
      const unknown = rows.filter(row => row.profession === null);

      expect(unknown).toHaveLength(1);
      expect(unknown[0].className).not.toBe('');
    });

    // An officer-headed export loses its three officer columns at the privacy
    // boundary, so nothing downstream can report one. What survives is the
    // count of how many rows had them.
    it('reads an officer-headed export as twelve columns', () => {
      const rows = read('Fixture Officer Fleet_20240102-120000.Csv').rows;

      expect(rows.length).toBeGreaterThan(0);
      expect(
        rows.every(
          row => row.joinedAt.resolution !== RosterDateResolution.ABSENT,
        ),
      ).toBe(true);
    });
  });
});
