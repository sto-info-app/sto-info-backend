import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

/**
 * Inventory and anonymisation check for the committed Fleet Community CSV
 * fixtures (FC-001).
 *
 * This runs in CI and needs no access to the private roster corpus. It proves
 * three things:
 *
 *  1. The committed fixtures still match their manifest.
 *  2. They contain only synthetic identities, so nothing derived from real
 *     player data has leaked into the repository.
 *  3. They still exercise every case FC-001 requires, and the observed STO
 *     dialect still parses them the way the plan says it should.
 *
 * Regenerate with: NODE_ENV=local npm run fixtures:fleet-corpus
 */

const FIXTURE_DIR = join(__dirname, 'fixtures', 'fleet-community');

const NORMAL_HEADER =
  'Character Name,Account Handle,Level,Class,Guild Rank,' +
  'Contribution Total,Join Date,Rank Change Date,Last Active Date,' +
  'Status,Public Comment,Public Comment Last Edit Date';

const OFFICER_HEADER =
  NORMAL_HEADER +
  ',Officer Comment,Officer Comment Author,Officer Comment Last Edit Date';

const STO_DATE = String.raw`\d{1,2}/\d{1,2}/\d{4} \d{1,2}:\d{2}:\d{2}[apAP][mM]`;
const PREFIX_NINE = Array<string>(9).fill('[^,]*').join(',');

const NO_TAIL = new RegExp(
  `^${PREFIX_NINE},"(?<status>.*)","(?<publicComment>.*)",(?<edited>${STO_DATE}|)$`,
);
const WITH_TAIL = new RegExp(
  `^${PREFIX_NINE},"(?<status>.*)","(?<publicComment>.*)",(?<edited>${STO_DATE}|),` +
    `"(?<officerComment>.*)",(?<officerAuthor>[^,]*),(?<officerEdited>${STO_DATE}|)$`,
);

const STANDARD_FILENAME =
  /^(?<fleet>.+)_(?<date>\d{8})-(?<time>\d{6})\.[Cc][Ss][Vv]$/;

const OFFICER_CANARY = 'OFFICER-CANARY';
const BOM = '﻿';

interface ManifestEntry {
  filename: string;
  expectation: 'accept' | 'reject';
  purpose: string;
  bom: boolean;
  bytes: number;
}

const manifest = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'manifest.json'), 'utf8'),
) as { fixtures: ManifestEntry[] };

function read(filename: string): string {
  const text = readFileSync(join(FIXTURE_DIR, filename), 'utf8');
  return text.startsWith(BOM) ? text.slice(BOM.length) : text;
}

function rowsOf(filename: string): { header: string; rows: string[] } {
  const lines = read(filename)
    .split('\n')
    .map(line => (line.endsWith('\r') ? line.slice(0, -1) : line));
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return { header: lines[0], rows: lines.slice(1) };
}

/** Resolves an observed `M/D/YYYY h:mm:ssam` local time in a named zone. */
function toUtc(local: string, timeZone: string): number {
  const parsed =
    /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2})([ap])m$/i.exec(
      local,
    );
  if (!parsed) {
    throw new Error(`not an STO date: ${local}`);
  }
  const [, month, day, year, hour12, minute, second, meridiem] = parsed;
  let hour = Number(hour12) % 12;
  if (meridiem.toLowerCase() === 'p') {
    hour += 12;
  }

  // Guess UTC, then correct by the zone's offset at that instant.
  const guess = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    hour,
    Number(minute),
    Number(second),
  );
  const offset = (candidate: number): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date(candidate));
    const get = (type: string): number =>
      Number(parts.find(part => part.type === type)?.value);
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') % 24,
      get('minute'),
      get('second'),
    );
    return asUtc - candidate;
  };
  return guess - offset(guess - offset(guess));
}

describe('Fleet Community CSV fixtures', () => {
  describe('inventory', () => {
    it('manifest and directory contents agree', () => {
      const onDisk = readdirSync(FIXTURE_DIR)
        .filter(name => name !== 'manifest.json')
        .sort();
      const listed = manifest.fixtures.map(f => f.filename).sort();
      expect(onDisk).toEqual(listed);
    });

    it('every fixture matches its recorded byte length', () => {
      for (const fixture of manifest.fixtures) {
        const bytes = readFileSync(join(FIXTURE_DIR, fixture.filename)).length;
        expect({ name: fixture.filename, bytes }).toEqual({
          name: fixture.filename,
          bytes: fixture.bytes,
        });
      }
    });

    it('every fixture states a purpose and an expectation', () => {
      for (const fixture of manifest.fixtures) {
        expect(fixture.purpose.length).toBeGreaterThan(20);
        expect(['accept', 'reject']).toContain(fixture.expectation);
      }
    });
  });

  describe('anonymisation', () => {
    const identityFixtures = manifest.fixtures.filter(
      f => f.filename !== 'manifest.json',
    );

    it('every account handle is synthetic', () => {
      for (const fixture of identityFixtures) {
        const { header, rows } = rowsOf(fixture.filename);
        if (header !== NORMAL_HEADER && header !== OFFICER_HEADER) {
          continue;
        }
        for (const row of rows) {
          const handle = row.split(',')[1];
          expect(handle).toMatch(/^@fixture[0-9a-z]+$/);
        }
      }
    });

    it('no fixture contains an email address or a URL', () => {
      for (const fixture of identityFixtures) {
        const text = read(fixture.filename);
        expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
        expect(text).not.toMatch(/https?:\/\//);
      }
    });

    it('officer canaries appear only where an officer tail is expected', () => {
      const withCanary = identityFixtures
        .filter(f => read(f.filename).includes(OFFICER_CANARY))
        .map(f => f.filename)
        .sort();

      expect(withCanary).toEqual([
        'Fixture Officer Fleet_20240102-120000.Csv',
        'Fixture Officer Fleet_20240103-120000.Csv',
        'Fixture Quoting Fleet_20240104-120000.Csv',
      ]);
    });
  });

  describe('the observed STO dialect', () => {
    it('parses every row of each accepted fixture unambiguously', () => {
      const accepted = manifest.fixtures.filter(
        f => f.expectation === 'accept',
      );
      expect(accepted.length).toBeGreaterThan(0);

      for (const fixture of accepted) {
        const { header, rows } = rowsOf(fixture.filename);
        expect(header === NORMAL_HEADER || header === OFFICER_HEADER).toBe(
          true,
        );
        const officerFile = header === OFFICER_HEADER;

        for (const [index, row] of rows.entries()) {
          const withTail = officerFile ? WITH_TAIL.exec(row) : null;
          const noTail = NO_TAIL.exec(row);
          const where = `${fixture.filename} row ${index + 1}`;

          expect(`${where}: parses`).toBe(
            (withTail ?? noTail) ? `${where}: parses` : `${where}: FAILED`,
          );
          // A row that reads both ways has no unique tail boundary.
          expect(`${where}: unambiguous`).toBe(
            withTail && noTail
              ? `${where}: AMBIGUOUS`
              : `${where}: unambiguous`,
          );
        }
      }
    });

    it('accepts an officer header whose rows omit the officer tail', () => {
      const { rows } = rowsOf('Fixture Officer Fleet_20240103-120000.Csv');
      const tails = rows.map(row => WITH_TAIL.test(row));
      expect(tails).toContain(true);
      expect(tails).toContain(false);
    });

    it('keeps embedded quotes and commas inside their own fields', () => {
      const { rows } = rowsOf('Fixture Quoting Fleet_20240104-120000.Csv');

      const quoted = WITH_TAIL.exec(rows[0]);
      expect(quoted?.groups?.publicComment).toContain('"');
      expect(quoted?.groups?.officerComment).toContain(OFFICER_CANARY);

      const commaStatus = WITH_TAIL.exec(rows[1]);
      expect(commaStatus?.groups?.status).toContain(',');
      expect(commaStatus?.groups?.publicComment).toContain(',');

      // The Class field is the anomalous corpus value: a ship, not a profession.
      expect(rows[2].split(',')[3]).toBe("B'rel Bird-of-Prey");
    });

    it('rejects a row whose officer tail boundary is not unique', () => {
      const { rows } = rowsOf('Fixture Ambiguous Fleet_20240108-120000.Csv');
      for (const row of rows) {
        expect(WITH_TAIL.test(row) && NO_TAIL.test(row)).toBe(true);
      }
    });

    it('rejects an unknown header outright', () => {
      const { header } = rowsOf('Fixture Bad Header Fleet_20240110-120000.Csv');
      expect(header).not.toBe(NORMAL_HEADER);
      expect(header).not.toBe(OFFICER_HEADER);
    });
  });

  describe('the filename contract', () => {
    it('accepts standard names and captures the label before the final stamp', () => {
      const cases: Record<string, string> = {
        'Fixture Basic Fleet_20240101-120000.Csv': 'Fixture Basic Fleet',
        '.Fixture Dotted Fleet._20240111-120000.Csv': '.Fixture Dotted Fleet.',
        '« Fixture Guillemet Fleet »_20240112-120000.Csv':
          '« Fixture Guillemet Fleet »',
        '- Fixture Hyphen Fleet -_20240113-120000.Csv':
          '- Fixture Hyphen Fleet -',
        "Fixture qa'Hom Fleet_20240114-120000.Csv": "Fixture qa'Hom Fleet",
      };
      for (const [filename, label] of Object.entries(cases)) {
        expect(STANDARD_FILENAME.exec(filename)?.groups?.fleet).toBe(label);
      }
    });

    it('rejects a manually suffixed export name', () => {
      const suffixed =
        'Fixture Suffixed Fleet_20240109-120000 - Steve Export.Csv';
      expect(manifest.fixtures.map(f => f.filename)).toContain(suffixed);
      expect(STANDARD_FILENAME.test(suffixed)).toBe(false);
    });
  });

  describe('the paired export', () => {
    const eastern = 'Fixture Timezone Fleet_20260824-011338.Csv';
    const uk = 'Fixture Timezone Fleet_20260824-061342.Csv';

    it('normalises both filename stamps to the same four seconds apart', () => {
      expect(toUtc('8/24/2026 1:13:38am', 'America/New_York')).toBe(
        Date.parse('2026-08-24T05:13:38Z'),
      );
      expect(toUtc('8/24/2026 6:13:42am', 'Europe/London')).toBe(
        Date.parse('2026-08-24T05:13:42Z'),
      );
    });

    it('resolves every matching row date to an identical instant', () => {
      const easternRows = rowsOf(eastern).rows;
      const ukRows = rowsOf(uk).rows;
      expect(easternRows).toHaveLength(ukRows.length);

      for (const [index, easternRow] of easternRows.entries()) {
        const easternFields = easternRow.split(',');
        const ukFields = ukRows[index].split(',');
        expect(easternFields[0]).toBe(ukFields[0]);

        // Join Date, Rank Change Date and Last Active Date.
        for (const field of [6, 7, 8]) {
          expect({
            row: index,
            field,
            utc: toUtc(easternFields[field], 'America/New_York'),
          }).toEqual({
            row: index,
            field,
            utc: toUtc(ukFields[field], 'Europe/London'),
          });
        }
      }
    });

    it('covers both the five-hour and the four-hour raw difference', () => {
      const easternRows = rowsOf(eastern).rows;
      const ukRows = rowsOf(uk).rows;

      const differences = easternRows.map((row, index) => {
        const naive = (value: string): number =>
          toUtc(value, 'UTC') as unknown as number;
        return (
          (naive(ukRows[index].split(',')[6]) - naive(row.split(',')[6])) /
          3_600_000
        );
      });

      expect(differences).toContain(5);
      expect(differences).toContain(4);
    });
  });

  describe('longitudinal anomalies', () => {
    it('models a contribution reset as a new episode, not a negative delta', () => {
      const before = rowsOf('Fixture Reset Fleet_20220328-035909.Csv').rows[0];
      const after = rowsOf('Fixture Reset Fleet_20220426-230735.Csv').rows[0];

      const beforeFields = before.split(',');
      const afterFields = after.split(',');

      expect(beforeFields[0]).toBe(afterFields[0]);
      expect(beforeFields[1]).toBe(afterFields[1]);
      expect(Number(afterFields[5])).toBeLessThan(Number(beforeFields[5]));
      // The join date also changed, which is what makes this a rejoin.
      expect(afterFields[6]).not.toBe(beforeFields[6]);
    });

    it('models a Character rename candidate', () => {
      const before = rowsOf(
        'Fixture Rename Fleet_20211221-034426.Csv',
      ).rows[0].split(',');
      const after = rowsOf(
        'Fixture Rename Fleet_20220112-014309.Csv',
      ).rows[0].split(',');

      expect(after[0]).not.toBe(before[0]);
      expect(after[1]).toBe(before[1]);
      expect(after[6]).toBe(before[6]);
      expect(after[3]).toBe(before[3]);
      // Contribution changed, which must not disqualify the candidate.
      expect(after[5]).not.toBe(before[5]);
    });

    it('models an account rename candidate', () => {
      const before = rowsOf(
        'Fixture Account Rename Fleet_20230604-021823.Csv',
      ).rows[0].split(',');
      const after = rowsOf(
        'Fixture Account Rename Fleet_20230715-001404.Csv',
      ).rows[0].split(',');

      expect(after[0]).toBe(before[0]);
      expect(after[1]).not.toBe(before[1]);
      expect(after[6]).toBe(before[6]);
      expect(after[3]).toBe(before[3]);
    });

    it('models a duplicate identity within a single export', () => {
      const { rows } = rowsOf('Fixture Duplicate Fleet_20240105-120000.Csv');
      const keys = rows.map(row => row.split(',').slice(0, 2).join('|'));
      expect(new Set(keys).size).toBeLessThan(keys.length);
    });
  });

  describe('FC-001 coverage', () => {
    it('covers every case the ticket requires', () => {
      const byPurpose = manifest.fixtures.map(f => f.purpose.toLowerCase());
      const required = [
        'omitted',
        'embedded quotes',
        'twice in one export',
        'america/new_york',
        'europe/london',
        'reset',
        'rename',
        'utf-8 bom',
        'ambiguous',
      ];
      for (const needle of required) {
        expect({
          needle,
          covered: byPurpose.some(purpose => purpose.includes(needle)),
        }).toEqual({ needle, covered: true });
      }
    });
  });
});
