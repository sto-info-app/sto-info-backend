import { readFileSync } from 'fs';
import { join } from 'path';

import { RosterCsvPrivacyParserService } from '../../imports/services/roster-csv-privacy-parser.service';
import { RosterTypedParserService } from '../../imports/services/roster-typed-parser.service';
import {
  normaliseRosterAccountHandle,
  normaliseRosterCharacterName,
} from '../../imports/utilities/roster-identity.utility';
import { RosterIdentityCandidateKind } from '../enums/roster-identity-candidate-kind.enum';
import { RosterIdentityCollisionReason } from '../enums/roster-identity-collision-reason.enum';
import { RosterIdentityConfidence } from '../enums/roster-identity-confidence.enum';
import { RosterIdentitySignal } from '../enums/roster-identity-signal.enum';
import {
  candidateKey,
  MatchedCandidate,
  rosterAliasKey,
  RosterIdentityMatch,
  RosterIdentityMatcher,
  RosterIdentityRow,
  RosterIdentitySnapshot,
} from './roster-identity-matcher';

/** Where the committed corpus fixtures live. */
const FIXTURES = join(__dirname, '../../../../test/fixtures/fleet-community');

/** Wednesday 4 January 2023, the join instant most hand-built rows share. */
const JOINED = new Date('2023-01-04T18:00:00.000Z');

/**
 * Builds a row, as the recompute would read it out of an observation.
 *
 * @param name - The Character name.
 * @param handle - The account handle.
 * @param overrides - Anything else that differs.
 * @returns The row.
 */
function row(
  name: string,
  handle: string,
  overrides: Partial<RosterIdentityRow> = {},
): RosterIdentityRow {
  return {
    characterName: name,
    characterNameNormalised: normaliseRosterCharacterName(name),
    accountHandle: handle,
    accountHandleNormalised: normaliseRosterAccountHandle(handle),
    level: 65,
    className: 'Starfleet Tactical Officer',
    contributionTotal: '1000',
    joinedAt: JOINED,
    joinedAtAmbiguous: false,
    rankChangedAt: null,
    rankChangedAtAmbiguous: false,
    ...overrides,
  };
}

/**
 * Builds an export.
 *
 * @param importId - Which import it is.
 * @param exportedAt - When it was taken.
 * @param rows - Its rows.
 * @returns The export.
 */
function snapshot(
  importId: string,
  exportedAt: string,
  rows: RosterIdentityRow[],
): RosterIdentitySnapshot {
  return { importId, exportedAt: new Date(exportedAt), rows, complete: true };
}

/**
 * Runs the matcher over some exports, in the order given.
 *
 * @param snapshots - The exports.
 * @returns What they amount to.
 */
function match(...snapshots: RosterIdentitySnapshot[]): RosterIdentityMatch {
  const matcher = new RosterIdentityMatcher();

  for (const each of snapshots) {
    matcher.add(each);
  }

  return matcher.result();
}

/**
 * Reads a committed fixture through the real privacy and typed readers, as
 * an upload is read.
 *
 * @param filename - The fixture's file name.
 * @param importId - The import to say it came from.
 * @param exportedAt - When to say it was taken.
 * @returns The export.
 */
function fixture(
  filename: string,
  importId: string,
  exportedAt: string,
): RosterIdentitySnapshot {
  const sanitised = new RosterCsvPrivacyParserService().sanitise(
    readFileSync(join(FIXTURES, filename)),
  );
  const typed = new RosterTypedParserService().read(sanitised.csv, 'UTC');

  expect(typed.problems).toEqual([]);

  return snapshot(
    importId,
    exportedAt,
    typed.rows.map(parsed => ({
      characterName: parsed.characterName,
      characterNameNormalised: normaliseRosterCharacterName(
        parsed.characterName,
      ),
      accountHandle: parsed.accountHandle,
      accountHandleNormalised: normaliseRosterAccountHandle(
        parsed.accountHandle,
      ),
      level: parsed.level,
      className: parsed.className,
      contributionTotal: String(parsed.contributionTotal),
      joinedAt: parsed.joinedAt.candidates[0] ?? null,
      joinedAtAmbiguous: parsed.joinedAt.candidates.length > 1,
      rankChangedAt: parsed.rankChangedAt.candidates[0] ?? null,
      rankChangedAtAmbiguous: parsed.rankChangedAt.candidates.length > 1,
    })),
  );
}

/**
 * The only candidate a match found.
 *
 * @param found - The match.
 * @returns Its single candidate.
 */
function only(found: RosterIdentityMatch): MatchedCandidate {
  expect(found.candidates.size).toBe(1);

  return [...found.candidates.values()][0];
}

/**
 * How one corroborating check came out on a candidate.
 *
 * @param candidate - The candidate.
 * @param signal - The check.
 * @returns Whether it held, or null.
 */
function held(
  candidate: MatchedCandidate,
  signal: RosterIdentitySignal,
): boolean | null {
  return candidate.signals.find(each => each.signal === signal)!.held;
}

describe('RosterIdentityMatcher', () => {
  describe('the two shapes the corpus holds', () => {
    // House of MidNite, December 2021 to January 2022, anonymised.
    it('proposes the Character rename, with its contribution changed', () => {
      const candidate = only(
        match(
          fixture(
            'Fixture Rename Fleet_20211221-034426.Csv',
            'import-1',
            '2021-12-21T03:44:26Z',
          ),
          fixture(
            'Fixture Rename Fleet_20220112-014309.Csv',
            'import-2',
            '2022-01-12T01:43:09Z',
          ),
        ),
      );

      expect(candidate).toMatchObject({
        kind: RosterIdentityCandidateKind.CHARACTER_RENAME,
        fromAliasKey: rosterAliasKey('gorn telak', '@fixture016'),
        toAliasKey: rosterAliasKey('telak of qamar', '@fixture016'),
        fromHandleNormalised: null,
        toHandleNormalised: null,
        earlierImportId: 'import-1',
        laterImportId: 'import-2',
        confidence: RosterIdentityConfidence.HIGH,
        collisionReasons: [],
      });
      expect(candidate.links).toEqual([
        {
          fromKey: rosterAliasKey('gorn telak', '@fixture016'),
          toKey: rosterAliasKey('telak of qamar', '@fixture016'),
        },
      ]);
    });

    // The Elite Stellar Alliance, June to July 2023, anonymised. One alt is
    // all the corpus has, so it is a medium-confidence proposal and no more.
    it('proposes the account rename, resting on one Character', () => {
      const candidate = only(
        match(
          fixture(
            'Fixture Account Rename Fleet_20230604-021823.Csv',
            'import-1',
            '2023-06-04T02:18:23Z',
          ),
          fixture(
            'Fixture Account Rename Fleet_20230715-001404.Csv',
            'import-2',
            '2023-07-15T00:14:04Z',
          ),
        ),
      );

      expect(candidate).toMatchObject({
        kind: RosterIdentityCandidateKind.ACCOUNT_RENAME,
        fromAliasKey: null,
        toAliasKey: null,
        fromHandleNormalised: '@fixture017old',
        toHandleNormalised: '@fixture017new',
        confidence: RosterIdentityConfidence.MEDIUM,
        collisionReasons: [],
      });
      expect(candidate.links).toEqual([
        {
          fromKey: rosterAliasKey('ilan rho', '@fixture017old'),
          toKey: rosterAliasKey('ilan rho', '@fixture017new'),
        },
      ]);
    });

    // A changed join date on the same name and handle is the same alias
    // carrying on. Whether it is a new episode is FC-019's question.
    it('proposes nothing for a rejoin under the same name', () => {
      const found = match(
        fixture(
          'Fixture Reset Fleet_20220328-035909.Csv',
          'import-1',
          '2022-03-28T03:59:09Z',
        ),
        fixture(
          'Fixture Reset Fleet_20220426-230735.Csv',
          'import-2',
          '2022-04-26T23:07:35Z',
        ),
      );

      expect(found.candidates.size).toBe(0);
    });
  });

  describe('refusing to merge on too little', () => {
    const earlier = (rows: RosterIdentityRow[]): RosterIdentitySnapshot =>
      snapshot('import-1', '2024-01-01T00:00:00Z', rows);
    const later = (rows: RosterIdentityRow[]): RosterIdentitySnapshot =>
      snapshot('import-2', '2024-02-01T00:00:00Z', rows);

    it.each([
      ['a join date alone', row('Kira', '@one'), row('Odo', '@two')],
      [
        'a name alone',
        row('Kira', '@one'),
        row('Kira', '@two', { joinedAt: new Date('2023-02-01T00:00:00Z') }),
      ],
      [
        'a handle alone',
        row('Kira', '@one'),
        row('Nerys', '@one', { joinedAt: new Date('2023-02-01T00:00:00Z') }),
      ],
      [
        'a different Class',
        row('Kira', '@one'),
        row('Nerys', '@one', { className: 'Starfleet Science Officer' }),
      ],
      [
        'a join instant that was one of two',
        row('Kira', '@one', { joinedAtAmbiguous: true }),
        row('Nerys', '@one', { joinedAtAmbiguous: true }),
      ],
      [
        'no join date at all',
        row('Kira', '@one', { joinedAt: null }),
        row('Nerys', '@one', { joinedAt: null }),
      ],
    ])('proposes nothing on %s', (_case, gone, arrived) => {
      expect(match(earlier([gone]), later([arrived])).candidates.size).toBe(0);
    });

    it('compares only consecutive exports', () => {
      const found = match(
        snapshot('import-1', '2024-01-01T00:00:00Z', [row('Kira', '@one')]),
        snapshot('import-2', '2024-02-01T00:00:00Z', []),
        snapshot('import-3', '2024-03-01T00:00:00Z', [row('Nerys', '@one')]),
      );

      expect(found.candidates.size).toBe(0);
    });

    it('proposes nothing for somebody who leaves and comes back unchanged', () => {
      const found = match(
        snapshot('import-1', '2024-01-01T00:00:00Z', [row('Kira', '@one')]),
        snapshot('import-2', '2024-02-01T00:00:00Z', []),
        snapshot('import-3', '2024-03-01T00:00:00Z', [row('Kira', '@one')]),
      );

      expect(found.candidates.size).toBe(0);
      expect(found.aliases.size).toBe(1);
    });

    it('ignores a row present in both exports', () => {
      const found = match(
        earlier([row('Kira', '@one'), row('Odo', '@two')]),
        later([row('Kira', '@one'), row('Nerys', '@one')]),
      );

      expect(found.candidates.size).toBe(0);
    });
  });

  describe('leaving collisions unresolved', () => {
    const earlier = (rows: RosterIdentityRow[]): RosterIdentitySnapshot =>
      snapshot('import-1', '2024-01-01T00:00:00Z', rows);
    const later = (rows: RosterIdentityRow[]): RosterIdentitySnapshot =>
      snapshot('import-2', '2024-02-01T00:00:00Z', rows);

    // Two alts of one account, joined together and of one Class, both
    // renamed at once. Any of four pairings fits and none may be chosen.
    it('reports every pairing of two alts renamed together, none resolvable', () => {
      const found = match(
        earlier([row('Kira', '@one'), row('Nerys', '@one')]),
        later([row('Ro', '@one'), row('Laren', '@one')]),
      );

      expect(found.candidates.size).toBe(4);

      for (const candidate of found.candidates.values()) {
        expect(candidate.collisionReasons).toEqual([
          RosterIdentityCollisionReason.SEVERAL_PARTNERS,
        ]);
      }
    });

    it('reports one row that fits two as unresolvable both ways', () => {
      const found = match(
        earlier([row('Kira', '@one')]),
        later([row('Ro', '@one'), row('Laren', '@one')]),
      );

      expect(
        [...found.candidates.values()].map(each => each.collisionReasons),
      ).toEqual([
        [RosterIdentityCollisionReason.SEVERAL_PARTNERS],
        [RosterIdentityCollisionReason.SEVERAL_PARTNERS],
      ]);
    });

    // One row that fits a Character rename and an account rename at once.
    it('counts partners across both kinds of rename', () => {
      const found = match(
        earlier([row('Kira', '@one')]),
        later([row('Nerys', '@one'), row('Kira', '@two')]),
      );

      expect(found.candidates.size).toBe(2);

      for (const candidate of found.candidates.values()) {
        expect(candidate.collisionReasons).toContain(
          RosterIdentityCollisionReason.SEVERAL_PARTNERS,
        );
      }
    });

    it.each([
      [
        'the old handle is still in use',
        [row('Kira', '@one'), row('Odo', '@one')],
        [row('Kira', '@two'), row('Odo', '@one')],
        [RosterIdentityCollisionReason.OLD_HANDLE_STILL_PRESENT],
      ],
      [
        'the new handle was already in use',
        [row('Kira', '@one'), row('Odo', '@two')],
        [row('Kira', '@two'), row('Odo', '@two')],
        [RosterIdentityCollisionReason.NEW_HANDLE_ALREADY_PRESENT],
      ],
    ])(
      'refuses an account rename where %s',
      (_case, before, after, reasons) => {
        expect(only(match(earlier(before), later(after)))).toMatchObject({
          kind: RosterIdentityCandidateKind.ACCOUNT_RENAME,
          collisionReasons: reasons,
        });
      },
    );

    it('refuses an account whose Characters split between two handles', () => {
      const found = match(
        earlier([
          row('Kira', '@one'),
          row('Odo', '@one', { className: 'Starfleet Science Officer' }),
        ]),
        later([
          row('Kira', '@two'),
          row('Odo', '@three', { className: 'Starfleet Science Officer' }),
        ]),
      );

      expect(
        [...found.candidates.values()].map(each => each.collisionReasons),
      ).toEqual([
        [RosterIdentityCollisionReason.HANDLE_SPLIT],
        [RosterIdentityCollisionReason.HANDLE_SPLIT],
      ]);
    });

    it('refuses two handles whose Characters land on one', () => {
      const found = match(
        earlier([
          row('Kira', '@one'),
          row('Odo', '@two', { className: 'Starfleet Science Officer' }),
        ]),
        later([
          row('Kira', '@three'),
          row('Odo', '@three', { className: 'Starfleet Science Officer' }),
        ]),
      );

      expect(
        [...found.candidates.values()].map(each => each.collisionReasons),
      ).toEqual([
        [RosterIdentityCollisionReason.HANDLE_MERGE],
        [RosterIdentityCollisionReason.HANDLE_MERGE],
      ]);
    });
  });

  describe('grading the corroboration', () => {
    const pair = (
      before: Partial<RosterIdentityRow>,
      after: Partial<RosterIdentityRow>,
    ): MatchedCandidate =>
      only(
        match(
          snapshot('import-1', '2024-01-01T00:00:00Z', [
            row('Kira', '@one', before),
          ]),
          snapshot('import-2', '2024-02-01T00:00:00Z', [
            row('Nerys', '@one', after),
          ]),
        ),
      );

    it('is high when every check that could be made held', () => {
      const candidate = pair(
        { rankChangedAt: new Date('2023-06-01T00:00:00Z') },
        { rankChangedAt: new Date('2023-06-01T00:00:00Z'), level: 66 },
      );

      expect(candidate.confidence).toBe(RosterIdentityConfidence.HIGH);
      expect(candidate.signals).toEqual([
        { signal: RosterIdentitySignal.LEVEL_NOT_LOWER, held: true },
        { signal: RosterIdentitySignal.CONTRIBUTION_NOT_LOWER, held: true },
        { signal: RosterIdentitySignal.RANK_CHANGE_NOT_EARLIER, held: true },
      ]);
    });

    it('is medium when one check failed', () => {
      const candidate = pair({ level: 65 }, { level: 50 });

      expect(held(candidate, RosterIdentitySignal.LEVEL_NOT_LOWER)).toBe(false);
      expect(candidate.confidence).toBe(RosterIdentityConfidence.MEDIUM);
    });

    it('is low when two checks failed, and still proposes it', () => {
      const candidate = pair(
        { level: 65, contributionTotal: '90000000000000000' },
        { level: 50, contributionTotal: '10' },
      );

      expect(held(candidate, RosterIdentitySignal.CONTRIBUTION_NOT_LOWER)).toBe(
        false,
      );
      expect(candidate.confidence).toBe(RosterIdentityConfidence.LOW);
    });

    // Compared as bigints, not numbers: a total past 2^53 would otherwise
    // round, and two different totals could compare equal.
    it('compares contributions beyond a double exactly', () => {
      const candidate = pair(
        { contributionTotal: '9007199254740993' },
        { contributionTotal: '9007199254740992' },
      );

      expect(held(candidate, RosterIdentitySignal.CONTRIBUTION_NOT_LOWER)).toBe(
        false,
      );
    });

    it('fails a rank change dated before the earlier one', () => {
      const candidate = pair(
        { rankChangedAt: new Date('2023-06-01T00:00:00Z') },
        { rankChangedAt: new Date('2023-05-01T00:00:00Z') },
      );

      expect(
        held(candidate, RosterIdentitySignal.RANK_CHANGE_NOT_EARLIER),
      ).toBe(false);
    });

    it.each([
      ['missing', { rankChangedAt: null }],
      [
        'one of two instants',
        {
          rankChangedAt: new Date('2023-05-01T00:00:00Z'),
          rankChangedAtAmbiguous: true,
        },
      ],
    ])(
      'cannot check a rank change date that is %s',
      (_case, overrides: Partial<RosterIdentityRow>) => {
        const candidate = pair(
          { rankChangedAt: new Date('2023-06-01T00:00:00Z') },
          overrides,
        );

        expect(
          held(candidate, RosterIdentitySignal.RANK_CHANGE_NOT_EARLIER),
        ).toBeNull();
        expect(candidate.confidence).toBe(RosterIdentityConfidence.HIGH);
      },
    );

    it('is high for an account rename that several Characters corroborate', () => {
      const candidate = only(
        match(
          snapshot('import-1', '2024-01-01T00:00:00Z', [
            row('Kira', '@one'),
            row('Odo', '@one', { className: 'Starfleet Science Officer' }),
          ]),
          snapshot('import-2', '2024-02-01T00:00:00Z', [
            row('Kira', '@two'),
            row('Odo', '@two', { className: 'Starfleet Science Officer' }),
          ]),
        ),
      );

      expect(candidate.links).toHaveLength(2);
      expect(candidate.confidence).toBe(RosterIdentityConfidence.HIGH);
    });

    it('fails a check for the account if it fails for any one Character', () => {
      const candidate = only(
        match(
          snapshot('import-1', '2024-01-01T00:00:00Z', [
            row('Kira', '@one', {
              rankChangedAt: new Date('2023-06-01T00:00:00Z'),
            }),
            row('Odo', '@one', {
              className: 'Starfleet Science Officer',
              level: 60,
            }),
          ]),
          snapshot('import-2', '2024-02-01T00:00:00Z', [
            row('Kira', '@two', {
              rankChangedAt: new Date('2023-06-02T00:00:00Z'),
            }),
            row('Odo', '@two', {
              className: 'Starfleet Science Officer',
              level: 50,
            }),
          ]),
        ),
      );

      expect(candidate.signals).toEqual([
        { signal: RosterIdentitySignal.LEVEL_NOT_LOWER, held: false },
        { signal: RosterIdentitySignal.CONTRIBUTION_NOT_LOWER, held: true },
        { signal: RosterIdentitySignal.RANK_CHANGE_NOT_EARLIER, held: true },
      ]);
    });
  });

  describe('the aliases it reports', () => {
    it('dates each by the first and last export listing it, spelled as first seen', () => {
      const found = match(
        snapshot('import-1', '2024-01-01T00:00:00Z', [row('Kira', '@One')]),
        snapshot('import-2', '2024-02-01T00:00:00Z', [row('KIRA', '@one')]),
        snapshot('import-3', '2024-03-01T00:00:00Z', [row('kira', '@ONE')]),
      );

      expect(found.aliases.get(rosterAliasKey('kira', '@one'))).toEqual({
        key: rosterAliasKey('kira', '@one'),
        characterName: 'Kira',
        characterNameNormalised: 'kira',
        accountHandle: '@One',
        accountHandleNormalised: '@one',
        firstObservedAt: new Date('2024-01-01T00:00:00Z'),
        lastObservedAt: new Date('2024-03-01T00:00:00Z'),
      });
    });

    it('reports the aliases on either side of a candidate', () => {
      const found = match(
        snapshot('import-1', '2024-01-01T00:00:00Z', [row('Kira', '@one')]),
        snapshot('import-2', '2024-02-01T00:00:00Z', [row('Nerys', '@one')]),
      );

      expect([...found.aliases.keys()]).toEqual([
        rosterAliasKey('kira', '@one'),
        rosterAliasKey('nerys', '@one'),
      ]);
    });
  });

  describe('a rename suggested more than once', () => {
    // Kira becomes Nerys, back again, and Nerys once more. The first and
    // third are one candidate, citing the exports that first suggested it.
    it('is one candidate, citing the first exports to suggest it', () => {
      const found = match(
        snapshot('import-1', '2024-01-01T00:00:00Z', [row('Kira', '@one')]),
        snapshot('import-2', '2024-02-01T00:00:00Z', [
          row('Nerys', '@one', { level: 60 }),
        ]),
        snapshot('import-3', '2024-03-01T00:00:00Z', [row('Kira', '@one')]),
        snapshot('import-4', '2024-04-01T00:00:00Z', [row('Nerys', '@one')]),
      );
      const forward = found.candidates.get(
        candidateKey(
          RosterIdentityCandidateKind.CHARACTER_RENAME,
          rosterAliasKey('kira', '@one'),
          rosterAliasKey('nerys', '@one'),
        ),
      )!;

      expect(found.candidates.size).toBe(2);
      expect(forward).toMatchObject({
        earlierImportId: 'import-1',
        laterImportId: 'import-2',
      });
      expect(forward.links).toHaveLength(1);
      // Failed the first time, held the second: a failure is not forgotten.
      expect(held(forward, RosterIdentitySignal.LEVEL_NOT_LOWER)).toBe(false);
    });
  });

  // FC-019: an export marked partial, or with a row excluded, cannot show
  // that a name is gone. Steve decided on 25 September 2026 that it is
  // skipped for pairing and still records the names it lists.
  describe('skipping exports that cannot show a name gone', () => {
    const partial = (
      importId: string,
      exportedAt: string,
      rows: RosterIdentityRow[],
    ): RosterIdentitySnapshot => ({
      ...snapshot(importId, exportedAt, rows),
      complete: false,
    });

    it('suggests nothing from a partial export that lacks the old name', () => {
      const found = match(
        snapshot('import-1', '2024-01-01T00:00:00Z', [row('Kira', '@one')]),
        partial('import-2', '2024-02-01T00:00:00Z', [row('Nerys', '@one')]),
      );

      expect(found.candidates.size).toBe(0);
      expect([...found.aliases.keys()]).toEqual([
        rosterAliasKey('kira', '@one'),
        rosterAliasKey('nerys', '@one'),
      ]);
    });

    it('compares the complete exports either side of a partial one', () => {
      const found = match(
        snapshot('import-1', '2024-01-01T00:00:00Z', [row('Kira', '@one')]),
        partial('import-2', '2024-02-01T00:00:00Z', [row('Nerys', '@one')]),
        snapshot('import-3', '2024-03-01T00:00:00Z', [row('Nerys', '@one')]),
      );

      expect([...found.candidates.values()]).toEqual([
        expect.objectContaining({
          kind: RosterIdentityCandidateKind.CHARACTER_RENAME,
          earlierImportId: 'import-1',
          laterImportId: 'import-3',
          collisionReasons: [],
        }),
      ]);
      expect(
        found.aliases.get(rosterAliasKey('nerys', '@one'))!.firstObservedAt,
      ).toEqual(new Date('2024-02-01T00:00:00Z'));
    });

    it('calls a pair a collision when a skipped export lists both names', () => {
      const found = match(
        snapshot('import-1', '2024-01-01T00:00:00Z', [row('Kira', '@one')]),
        partial('import-2', '2024-02-01T00:00:00Z', [
          row('Kira', '@one'),
          row('Nerys', '@one'),
        ]),
        snapshot('import-3', '2024-03-01T00:00:00Z', [row('Nerys', '@one')]),
      );

      expect(
        [...found.candidates.values()].map(each => each.collisionReasons),
      ).toEqual([[RosterIdentityCollisionReason.LISTED_TOGETHER]]);
    });

    it('forgets the skipped exports once a complete one has been compared', () => {
      const found = match(
        snapshot('import-1', '2024-01-01T00:00:00Z', [row('Kira', '@one')]),
        partial('import-2', '2024-02-01T00:00:00Z', [
          row('Odo', '@two'),
          row('Rom', '@two'),
        ]),
        snapshot('import-3', '2024-03-01T00:00:00Z', [row('Odo', '@two')]),
        snapshot('import-4', '2024-04-01T00:00:00Z', [row('Rom', '@two')]),
      );

      expect([...found.candidates.values()]).toEqual([
        expect.objectContaining({
          earlierImportId: 'import-3',
          laterImportId: 'import-4',
          collisionReasons: [],
        }),
      ]);
    });

    it('has nothing to compare a partial export before the first complete one with', () => {
      const found = match(
        partial('import-1', '2024-01-01T00:00:00Z', [
          row('Kira', '@one'),
          row('Nerys', '@one'),
        ]),
        snapshot('import-2', '2024-02-01T00:00:00Z', [row('Kira', '@one')]),
        snapshot('import-3', '2024-03-01T00:00:00Z', [row('Nerys', '@one')]),
      );

      expect(
        [...found.candidates.values()].map(each => each.collisionReasons),
      ).toEqual([[]]);
    });

    it('still refuses a partial export out of order', () => {
      const matcher = new RosterIdentityMatcher();

      matcher.add(partial('import-2', '2024-02-01T00:00:00Z', []));

      expect(() =>
        matcher.add(snapshot('import-1', '2024-01-01T00:00:00Z', [])),
      ).toThrow(/export order/);
    });
  });

  it('refuses exports out of order', () => {
    const matcher = new RosterIdentityMatcher();

    matcher.add(snapshot('import-2', '2024-02-01T00:00:00Z', []));

    expect(() =>
      matcher.add(snapshot('import-1', '2024-01-01T00:00:00Z', [])),
    ).toThrow(/export order/);
  });

  it('refuses two exports claiming one instant', () => {
    const matcher = new RosterIdentityMatcher();

    matcher.add(snapshot('import-1', '2024-01-01T00:00:00Z', []));

    expect(() =>
      matcher.add(snapshot('import-2', '2024-01-01T00:00:00Z', [])),
    ).toThrow(/one per instant/);
  });

  it('finds nothing in no exports', () => {
    const found = match();

    expect(found.aliases.size).toBe(0);
    expect(found.candidates.size).toBe(0);
  });
});
