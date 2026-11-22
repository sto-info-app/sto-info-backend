import { RosterIdentityCandidateKind } from '../enums/roster-identity-candidate-kind.enum';
import { RosterIdentityCandidateState } from '../enums/roster-identity-candidate-state.enum';
import { RosterIdentityCollisionReason } from '../enums/roster-identity-collision-reason.enum';
import { RosterIdentityConfidence } from '../enums/roster-identity-confidence.enum';
import { candidateKey, MatchedCandidate } from './roster-identity-matcher';
import {
  AssignableAlias,
  assignIdentities,
  planCandidates,
  StoredCandidate,
} from './roster-identity-planner';

describe('planCandidates', () => {
  // Two aliases, A and B, and the Character rename between them.
  const aliasKeyById = new Map([
    ['alias-a', 'key-a'],
    ['alias-b', 'key-b'],
    ['alias-c', 'key-c'],
  ]);
  const aliasIdByKey = new Map(
    [...aliasKeyById].map(([id, key]) => [key, id] as const),
  );
  const renameKey = candidateKey(
    RosterIdentityCandidateKind.CHARACTER_RENAME,
    'key-a',
    'key-b',
  );
  const accountKey = candidateKey(
    RosterIdentityCandidateKind.ACCOUNT_RENAME,
    '@old',
    '@new',
  );

  /**
   * What the evidence suggests about A and B.
   *
   * @param overrides - Anything that differs.
   * @returns The suggestion.
   */
  const matched = (
    overrides: Partial<MatchedCandidate> = {},
  ): MatchedCandidate => ({
    key: renameKey,
    kind: RosterIdentityCandidateKind.CHARACTER_RENAME,
    fromAliasKey: 'key-a',
    toAliasKey: 'key-b',
    fromHandleNormalised: null,
    toHandleNormalised: null,
    earlierImportId: 'import-1',
    laterImportId: 'import-2',
    links: [{ fromKey: 'key-a', toKey: 'key-b' }],
    signals: [],
    confidence: RosterIdentityConfidence.HIGH,
    collisionReasons: [],
    ...overrides,
  });

  /**
   * The candidate for A and B as stored.
   *
   * @param overrides - Anything that differs.
   * @returns The stored candidate.
   */
  const stored = (
    overrides: Partial<StoredCandidate> = {},
  ): StoredCandidate => ({
    id: 'candidate-1',
    kind: RosterIdentityCandidateKind.CHARACTER_RENAME,
    state: RosterIdentityCandidateState.OPEN,
    fromAliasId: 'alias-a',
    toAliasId: 'alias-b',
    fromHandleNormalised: null,
    toHandleNormalised: null,
    collisionReasons: [],
    stale: false,
    revision: 0,
    links: [{ fromAliasId: 'alias-a', toAliasId: 'alias-b' }],
    ...overrides,
  });

  const plan = (
    rows: StoredCandidate[],
    suggestions: MatchedCandidate[],
  ): ReturnType<typeof planCandidates> =>
    planCandidates(
      rows,
      new Map(suggestions.map(each => [each.key, each])),
      aliasKeyById,
      aliasIdByKey,
    );

  it('inserts what is suggested for the first time', () => {
    const suggestion = matched();

    expect(plan([], [suggestion])).toEqual({
      inserts: [suggestion],
      refreshes: [],
      staleness: [],
      deletions: [],
    });
  });

  it('rewrites an open one from what the evidence now says', () => {
    const suggestion = matched({ laterImportId: 'import-3' });

    expect(plan([stored({ stale: true })], [suggestion])).toEqual({
      inserts: [],
      refreshes: [{ id: 'candidate-1', candidate: suggestion }],
      staleness: [],
      deletions: [],
    });
  });

  it('finds a stored account rename by its handles', () => {
    const suggestion = matched({
      key: accountKey,
      kind: RosterIdentityCandidateKind.ACCOUNT_RENAME,
      fromAliasKey: null,
      toAliasKey: null,
      fromHandleNormalised: '@old',
      toHandleNormalised: '@new',
    });

    const result = plan(
      [
        stored({
          kind: RosterIdentityCandidateKind.ACCOUNT_RENAME,
          fromAliasId: null,
          toAliasId: null,
          fromHandleNormalised: '@old',
          toHandleNormalised: '@new',
        }),
      ],
      [suggestion],
    );

    expect(result.inserts).toEqual([]);
    expect(result.refreshes).toEqual([
      { id: 'candidate-1', candidate: suggestion },
    ]);
  });

  describe('a decided candidate', () => {
    it.each([
      RosterIdentityCandidateState.CONFIRMED,
      RosterIdentityCandidateState.REJECTED,
    ])('is left %s while the evidence still says the same', state => {
      expect(plan([stored({ state, revision: 1 })], [matched()])).toEqual({
        inserts: [],
        refreshes: [],
        staleness: [],
        deletions: [],
      });
    });

    it('is flagged when the evidence no longer suggests it', () => {
      expect(
        plan([stored({ state: RosterIdentityCandidateState.CONFIRMED })], [])
          .staleness,
      ).toEqual([{ id: 'candidate-1', stale: true }]);
    });

    it('is flagged when the evidence now names different pairs', () => {
      expect(
        plan(
          [stored({ state: RosterIdentityCandidateState.CONFIRMED })],
          [matched({ links: [{ fromKey: 'key-a', toKey: 'key-c' }] })],
        ).staleness,
      ).toEqual([{ id: 'candidate-1', stale: true }]);
    });

    it('is flagged when the evidence now names more pairs', () => {
      expect(
        plan(
          [stored({ state: RosterIdentityCandidateState.CONFIRMED })],
          [
            matched({
              links: [
                { fromKey: 'key-a', toKey: 'key-b' },
                { fromKey: 'key-c', toKey: 'key-b' },
              ],
            }),
          ],
        ).staleness,
      ).toEqual([{ id: 'candidate-1', stale: true }]);
    });

    it('is flagged when the evidence now makes it unresolvable', () => {
      expect(
        plan(
          [stored({ state: RosterIdentityCandidateState.CONFIRMED })],
          [
            matched({
              collisionReasons: [
                RosterIdentityCollisionReason.SEVERAL_PARTNERS,
              ],
            }),
          ],
        ).staleness,
      ).toEqual([{ id: 'candidate-1', stale: true }]);
    });

    it('is cleared of the flag when the evidence says the same again', () => {
      expect(
        plan(
          [
            stored({
              state: RosterIdentityCandidateState.REJECTED,
              stale: true,
            }),
          ],
          [matched()],
        ).staleness,
      ).toEqual([{ id: 'candidate-1', stale: false }]);
    });

    it('is not flagged twice', () => {
      expect(
        plan(
          [
            stored({
              state: RosterIdentityCandidateState.CONFIRMED,
              stale: true,
            }),
          ],
          [],
        ).staleness,
      ).toEqual([]);
    });
  });

  describe('one no longer suggested', () => {
    it('is deleted if nobody ever decided it', () => {
      expect(plan([stored()], []).deletions).toEqual(['candidate-1']);
    });

    // Confirmed and undone: open again, but with a history worth keeping.
    it('is kept and flagged if it was decided and undone', () => {
      expect(plan([stored({ revision: 2 })], [])).toEqual({
        inserts: [],
        refreshes: [],
        staleness: [{ id: 'candidate-1', stale: true }],
        deletions: [],
      });
    });
  });
});

describe('assignIdentities', () => {
  /**
   * Builds an alias that still has its origin identity.
   *
   * @param id - The alias.
   * @param firstObservedAt - When an in-force export first listed it.
   * @param overrides - Anything that differs.
   * @returns The alias.
   */
  const alias = (
    id: string,
    firstObservedAt: string | null,
    overrides: Partial<AssignableAlias> = {},
  ): AssignableAlias => ({
    id,
    identityId: `identity-${id}`,
    originIdentityId: `identity-${id}`,
    firstObservedAt:
      firstObservedAt === null ? null : new Date(firstObservedAt),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });

  it('changes nothing while nothing is confirmed', () => {
    expect(
      assignIdentities(
        [alias('a', '2024-01-01Z'), alias('b', '2024-02-01Z')],
        [],
      ).size,
    ).toBe(0);
  });

  it('gives a confirmed pair the identity of the one seen first', () => {
    expect(
      assignIdentities(
        [alias('a', '2024-01-01Z'), alias('b', '2024-02-01Z')],
        [{ fromAliasId: 'a', toAliasId: 'b' }],
      ),
    ).toEqual(new Map([['b', 'identity-a']]));
  });

  // Seen first, whichever way round the rename was.
  it('follows the evidence, not the direction of the rename', () => {
    expect(
      assignIdentities(
        [alias('a', '2024-02-01Z'), alias('b', '2024-01-01Z')],
        [{ fromAliasId: 'a', toAliasId: 'b' }],
      ),
    ).toEqual(new Map([['a', 'identity-b']]));
  });

  it('joins a chain of renames into one identity', () => {
    expect(
      assignIdentities(
        [
          alias('a', '2024-01-01Z'),
          alias('b', '2024-02-01Z'),
          alias('c', '2024-03-01Z'),
        ],
        [
          { fromAliasId: 'b', toAliasId: 'c' },
          { fromAliasId: 'a', toAliasId: 'b' },
        ],
      ),
    ).toEqual(
      new Map([
        ['b', 'identity-a'],
        ['c', 'identity-a'],
      ]),
    );
  });

  // Undoing a confirmation removes its link, and the alias goes home.
  it('returns an alias to its origin once nothing joins it', () => {
    expect(
      assignIdentities(
        [
          alias('a', '2024-01-01Z'),
          alias('b', '2024-02-01Z', { identityId: 'identity-a' }),
        ],
        [],
      ),
    ).toEqual(new Map([['b', 'identity-b']]));
  });

  it('ranks an alias no in-force export lists after one it does', () => {
    expect(
      assignIdentities(
        [alias('a', null), alias('b', '2024-02-01Z')],
        [{ fromAliasId: 'a', toAliasId: 'b' }],
      ),
    ).toEqual(new Map([['a', 'identity-b']]));
  });

  it('breaks a tie by when the alias was recorded, then by identifier', () => {
    expect(
      assignIdentities(
        [
          alias('a', null, { createdAt: new Date('2026-02-01Z') }),
          alias('b', null, { createdAt: new Date('2026-01-01Z') }),
        ],
        [{ fromAliasId: 'a', toAliasId: 'b' }],
      ),
    ).toEqual(new Map([['a', 'identity-b']]));

    expect(
      assignIdentities(
        [alias('b', null), alias('a', null)],
        [{ fromAliasId: 'b', toAliasId: 'a' }],
      ),
    ).toEqual(new Map([['b', 'identity-a']]));
  });

  it('ignores a link to an alias it was not given', () => {
    expect(
      assignIdentities(
        [alias('a', '2024-01-01Z')],
        [{ fromAliasId: 'a', toAliasId: 'elsewhere' }],
      ).size,
    ).toBe(0);
  });
});
