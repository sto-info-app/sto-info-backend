import { RosterChangeKind } from '../enums/roster-change-kind.enum';
import { RosterEpisodeEnd } from '../enums/roster-episode-end.enum';
import { RosterEpisodeStart } from '../enums/roster-episode-start.enum';
import {
  ProjectorRow,
  ProjectorSnapshot,
  RosterProjection,
  RosterProjector,
} from './roster-projector';

/** Noon UTC on a day of January 2024. */
const day = (n: number): Date => new Date(Date.UTC(2024, 0, n, 12));

/** A Join Date before every export in these tests. */
const LONG_AGO = new Date(Date.UTC(2020, 5, 1, 9));

const row = (
  identityId: string,
  overrides: Partial<ProjectorRow> = {},
): ProjectorRow => ({
  identityId,
  aliasId: `${identityId}-alias`,
  characterName: `Name ${identityId}`,
  accountHandle: `@${identityId}`,
  guildRank: 'Captain',
  contributionTotal: '1000',
  joinedAt: LONG_AGO,
  joinedAtAmbiguous: false,
  ...overrides,
});

const snap = (
  importId: string,
  n: number,
  rows: readonly ProjectorRow[],
  extra: Partial<ProjectorSnapshot> = {},
): ProjectorSnapshot => ({
  importId,
  exportedAt: day(n),
  partial: false,
  rows,
  unknownIdentityIds: [],
  ...extra,
});

const project = (snapshots: readonly ProjectorSnapshot[]): RosterProjection =>
  new RosterProjector().project(snapshots);

const kinds = (projection: RosterProjection, identityId: string): string[] =>
  projection.changes
    .filter(change => change.identityId === identityId)
    .map(change => change.kind);

describe('RosterProjector', () => {
  describe('the first export', () => {
    it('says everybody was first seen there, and counts no joins', () => {
      const result = project([snap('i1', 1, [row('a'), row('b')])]);

      expect(result.episodes).toEqual([
        expect.objectContaining({
          identityId: 'a',
          ordinal: 1,
          startKind: RosterEpisodeStart.FIRST_SEEN,
          startedAfter: null,
          first: { importId: 'i1', at: day(1) },
          last: { importId: 'i1', at: day(1) },
          endKind: null,
          endedBefore: null,
          baselineContribution: '1000',
        }),
        expect.objectContaining({ identityId: 'b' }),
      ]);
      expect(result.changes).toEqual([]);
      expect(result.intervals).toEqual([]);
    });

    it('projects nothing from no exports', () => {
      expect(project([])).toEqual({ episodes: [], changes: [], intervals: [] });
    });
  });

  describe('joining and leaving', () => {
    it('bounds a join and a departure by the exports either side', () => {
      const result = project([
        snap('i1', 1, [row('a'), row('b')]),
        snap('i2', 8, [row('b'), row('c')]),
      ]);

      expect(result.episodes).toEqual([
        expect.objectContaining({
          identityId: 'a',
          endKind: RosterEpisodeEnd.LEFT,
          last: { importId: 'i1', at: day(1) },
          endedBefore: day(8),
          endedBeforeImportId: 'i2',
        }),
        expect.objectContaining({ identityId: 'b', endKind: null }),
        expect.objectContaining({
          identityId: 'c',
          startKind: RosterEpisodeStart.JOINED,
          startedAfter: { importId: 'i1', at: day(1) },
          first: { importId: 'i2', at: day(8) },
        }),
      ]);
      expect(result.changes).toEqual([
        {
          identityId: 'a',
          episodeOrdinal: 1,
          kind: RosterChangeKind.LEFT,
          from: { importId: 'i1', at: day(1) },
          to: { importId: 'i2', at: day(8) },
          acrossGap: false,
          contributionDelta: null,
          detail: {},
        },
        {
          identityId: 'c',
          episodeOrdinal: 1,
          kind: RosterChangeKind.JOINED,
          from: { importId: 'i1', at: day(1) },
          to: { importId: 'i2', at: day(8) },
          acrossGap: false,
          contributionDelta: null,
          detail: { baselineContribution: '1000' },
        },
      ]);
      expect(result.intervals).toEqual([
        {
          from: { importId: 'i1', at: day(1) },
          to: { importId: 'i2', at: day(8) },
          partial: false,
          membersAtStart: 2,
          membersAtEnd: 2,
          joined: 1,
          rejoined: 0,
          left: 1,
          unknown: 0,
          renamed: 0,
          rankChanged: 0,
          joinDateChanged: 0,
          acrossGap: 0,
          contributionDelta: '0',
          contributionKnown: 1,
          contributionReset: 0,
          contributionBaseline: 1,
          contributionUnknown: 1,
        },
      ]);
    });

    it('starts a second episode when somebody who left is listed again', () => {
      const result = project([
        snap('i1', 1, [row('a', { contributionTotal: '500' })]),
        snap('i2', 2, []),
        snap('i3', 3, [row('a', { contributionTotal: '20' })]),
      ]);

      expect(kinds(result, 'a')).toEqual([
        RosterChangeKind.LEFT,
        RosterChangeKind.REJOINED,
      ]);
      expect(result.episodes).toEqual([
        expect.objectContaining({ ordinal: 1, endKind: RosterEpisodeEnd.LEFT }),
        expect.objectContaining({
          ordinal: 2,
          startKind: RosterEpisodeStart.REJOINED,
          startedAfter: { importId: 'i2', at: day(2) },
          baselineContribution: '20',
          endKind: null,
        }),
      ]);
      // Nothing carried across the rejoin: no reset and no delta.
      expect(result.intervals[1]).toEqual(
        expect.objectContaining({
          rejoined: 1,
          contributionBaseline: 1,
          contributionReset: 0,
          contributionDelta: '0',
        }),
      );
    });
  });

  describe('what cannot prove a departure', () => {
    it('leaves somebody missing from a partial export unknown, not gone', () => {
      const result = project([
        snap('i1', 1, [row('a'), row('b')]),
        snap('i2', 2, [row('b')], { partial: true }),
        snap('i3', 3, [row('a'), row('b')]),
      ]);

      expect(kinds(result, 'a')).toEqual([]);
      expect(result.episodes.filter(e => e.identityId === 'a')).toEqual([
        expect.objectContaining({
          ordinal: 1,
          endKind: null,
          last: { importId: 'i3', at: day(3) },
        }),
      ]);
      expect(result.intervals[0]).toEqual(
        expect.objectContaining({ partial: true, left: 0, unknown: 1 }),
      );
    });

    it('leaves somebody whose row is excluded unknown, not gone', () => {
      const result = project([
        snap('i1', 1, [row('a'), row('b')]),
        snap('i2', 2, [row('b')], { unknownIdentityIds: ['a'] }),
        snap('i3', 3, [row('a'), row('b')]),
      ]);

      expect(kinds(result, 'a')).toEqual([]);
      expect(result.intervals[0]).toEqual(
        expect.objectContaining({ left: 0, unknown: 1 }),
      );
    });

    it('bounds a departure from the last export that listed them, across an unknown', () => {
      const result = project([
        snap('i1', 1, [row('a'), row('b')]),
        snap('i2', 2, [row('b')], { partial: true }),
        snap('i3', 3, [row('b')]),
      ]);

      expect(result.changes).toEqual([
        expect.objectContaining({
          identityId: 'a',
          kind: RosterChangeKind.LEFT,
          from: { importId: 'i1', at: day(1) },
          to: { importId: 'i3', at: day(3) },
          acrossGap: true,
        }),
      ]);
      // Known at i3, but not within i2 to i3, so counted in neither.
      expect(result.intervals[1]).toEqual(
        expect.objectContaining({ left: 0, acrossGap: 1 }),
      );
    });

    it('bounds a join by the last complete export that did not list them', () => {
      const result = project([
        snap('i1', 1, [row('b')]),
        snap('i2', 2, [row('b')], { partial: true }),
        snap('i3', 3, [row('a'), row('b')]),
      ]);

      expect(result.changes).toEqual([
        expect.objectContaining({
          identityId: 'a',
          kind: RosterChangeKind.JOINED,
          from: { importId: 'i1', at: day(1) },
          to: { importId: 'i3', at: day(3) },
          acrossGap: true,
        }),
      ]);
      expect(result.intervals[1]).toEqual(
        expect.objectContaining({ joined: 0, acrossGap: 1 }),
      );
    });

    it('says a member first seen after only partial exports was first seen, unbounded', () => {
      const result = project([
        snap('i1', 1, [row('b')], { partial: true }),
        snap('i2', 2, [row('a'), row('b')]),
      ]);

      expect(result.episodes[0]).toEqual(
        expect.objectContaining({
          identityId: 'a',
          startKind: RosterEpisodeStart.FIRST_SEEN,
          startedAfter: null,
        }),
      );
      expect(kinds(result, 'a')).toEqual([]);
      expect(result.intervals[0]).toEqual(
        expect.objectContaining({ joined: 0, acrossGap: 1 }),
      );
    });

    it('does not take an excluded row for an absence when the member joins', () => {
      const result = project([
        snap('i1', 1, [row('b')]),
        snap('i2', 2, [row('b')], { unknownIdentityIds: ['a'] }),
        snap('i3', 3, [row('a'), row('b')]),
      ]);

      expect(result.episodes[0]).toEqual(
        expect.objectContaining({
          identityId: 'a',
          startKind: RosterEpisodeStart.JOINED,
          startedAfter: { importId: 'i1', at: day(1) },
        }),
      );
    });
  });

  describe('Join Dates', () => {
    // House of MidNite, 28 March to 26 April 2022: 1,061,699 to 0 with a
    // changed Join Date. Plan section 3.5: not a negative donation.
    it('reads a Join Date after the last export as a departure and a rejoin between them', () => {
      const rejoinedAt = new Date(Date.UTC(2024, 0, 20, 8));
      const result = project([
        snap('i1', 1, [row('a', { contributionTotal: '1061699' })]),
        snap('i2', 30, [
          row('a', { contributionTotal: '0', joinedAt: rejoinedAt }),
        ]),
      ]);

      expect(result.episodes).toEqual([
        expect.objectContaining({
          ordinal: 1,
          endKind: RosterEpisodeEnd.LEFT_AND_REJOINED,
          last: { importId: 'i1', at: day(1) },
          endedBefore: rejoinedAt,
          endedBeforeImportId: null,
          lastObservedContribution: '1061699',
        }),
        expect.objectContaining({
          ordinal: 2,
          startKind: RosterEpisodeStart.REJOINED,
          startedAfter: null,
          reportedJoinedAt: rejoinedAt,
          baselineContribution: '0',
        }),
      ]);
      expect(result.changes).toEqual([
        expect.objectContaining({
          kind: RosterChangeKind.LEFT,
          episodeOrdinal: 1,
          from: { importId: 'i1', at: day(1) },
          to: { importId: 'i2', at: day(30) },
        }),
        expect.objectContaining({
          kind: RosterChangeKind.REJOINED,
          episodeOrdinal: 2,
          detail: { baselineContribution: '0' },
        }),
      ]);
      expect(result.intervals[0]).toEqual(
        expect.objectContaining({
          left: 1,
          rejoined: 1,
          contributionReset: 0,
          contributionDelta: '0',
          contributionBaseline: 1,
        }),
      );
    });

    it('keeps the episode when a Join Date moves backwards', () => {
      const earlier = new Date(Date.UTC(2019, 1, 1, 9));
      const result = project([
        snap('i1', 1, [row('a')]),
        snap('i2', 2, [row('a', { joinedAt: earlier })]),
      ]);

      expect(result.episodes).toHaveLength(1);
      expect(result.changes).toEqual([
        expect.objectContaining({
          kind: RosterChangeKind.JOIN_DATE_CHANGED,
          detail: {
            fromJoinedAt: LONG_AGO.toISOString(),
            toJoinedAt: earlier.toISOString(),
          },
        }),
      ]);
      expect(result.intervals[0].joinDateChanged).toBe(1);
    });

    it('keeps the episode when a Join Date changes but stays before the last export', () => {
      const moved = new Date(Date.UTC(2023, 11, 25, 9));
      const result = project([
        snap('i1', 1, [row('a')]),
        snap('i2', 2, [row('a', { joinedAt: moved })]),
      ]);

      expect(result.episodes).toHaveLength(1);
      expect(kinds(result, 'a')).toEqual([RosterChangeKind.JOIN_DATE_CHANGED]);
    });

    it('never reads an ambiguous Join Date as a rejoin', () => {
      const result = project([
        snap('i1', 1, [row('a')]),
        snap('i2', 30, [
          row('a', {
            joinedAt: new Date(Date.UTC(2024, 0, 20, 8)),
            joinedAtAmbiguous: true,
          }),
        ]),
      ]);

      expect(result.episodes).toHaveLength(1);
      expect(result.changes).toEqual([]);
    });

    it('compares a Join Date with the last export that listed them, across an unknown', () => {
      const rejoinedAt = day(3);
      const result = project([
        snap('i1', 1, [row('a'), row('b')]),
        snap('i2', 5, [row('b')], { partial: true }),
        snap('i3', 9, [row('a', { joinedAt: rejoinedAt }), row('b')]),
      ]);

      expect(result.changes).toEqual([
        expect.objectContaining({
          kind: RosterChangeKind.LEFT,
          from: { importId: 'i1', at: day(1) },
          to: { importId: 'i3', at: day(9) },
          acrossGap: true,
        }),
        expect.objectContaining({
          kind: RosterChangeKind.REJOINED,
          acrossGap: true,
        }),
      ]);
      expect(result.intervals[1]).toEqual(
        expect.objectContaining({ left: 0, rejoined: 0, acrossGap: 2 }),
      );
    });
  });

  describe('contribution', () => {
    // -DME- Division Mu Epsilon, 25 May 2024: +70,700 with the Join Date
    // unchanged, and a Cadet to Ensign label change.
    it('counts a rise between consecutive exports as a known delta', () => {
      const result = project([
        snap('i1', 1, [
          row('a', { contributionTotal: '4341377', guildRank: 'Cadet' }),
          row('b', { contributionTotal: '10' }),
        ]),
        snap('i2', 2, [
          row('a', { contributionTotal: '4412077', guildRank: 'Ensign' }),
          row('b', { contributionTotal: '10' }),
        ]),
      ]);

      expect(result.changes).toEqual([
        expect.objectContaining({
          identityId: 'a',
          kind: RosterChangeKind.RANK_CHANGED,
          detail: { fromRank: 'Cadet', toRank: 'Ensign' },
        }),
        expect.objectContaining({
          identityId: 'a',
          kind: RosterChangeKind.CONTRIBUTION_CHANGED,
          contributionDelta: '70700',
          detail: { fromContribution: '4341377', toContribution: '4412077' },
        }),
      ]);
      expect(result.intervals[0]).toEqual(
        expect.objectContaining({
          rankChanged: 1,
          contributionDelta: '70700',
          contributionKnown: 2,
          contributionUnknown: 0,
        }),
      );
    });

    it('calls a fall a reset with no delta, and measures on from the new total', () => {
      const result = project([
        snap('i1', 1, [row('a', { contributionTotal: '900' })]),
        snap('i2', 2, [row('a', { contributionTotal: '100' })]),
        snap('i3', 3, [row('a', { contributionTotal: '150' })]),
      ]);

      expect(result.changes).toEqual([
        expect.objectContaining({
          kind: RosterChangeKind.CONTRIBUTION_RESET,
          contributionDelta: null,
          detail: { fromContribution: '900', toContribution: '100' },
        }),
        expect.objectContaining({
          kind: RosterChangeKind.CONTRIBUTION_CHANGED,
          contributionDelta: '50',
        }),
      ]);
      expect(result.intervals.map(each => each.contributionDelta)).toEqual([
        '0',
        '50',
      ]);
      expect(result.intervals[0].contributionReset).toBe(1);
    });

    it('records a delta across an unknown once, and counts it in no interval', () => {
      const result = project([
        snap('i1', 1, [row('a', { contributionTotal: '100' }), row('b')]),
        snap('i2', 2, [row('b')], { unknownIdentityIds: ['a'] }),
        snap('i3', 3, [row('a', { contributionTotal: '400' }), row('b')]),
      ]);

      expect(result.changes).toEqual([
        expect.objectContaining({
          identityId: 'a',
          kind: RosterChangeKind.CONTRIBUTION_CHANGED,
          from: { importId: 'i1', at: day(1) },
          to: { importId: 'i3', at: day(3) },
          acrossGap: true,
          contributionDelta: '300',
        }),
      ]);
      expect(result.intervals.map(each => each.contributionDelta)).toEqual([
        '0',
        '0',
      ]);
      expect(result.intervals.map(each => each.contributionUnknown)).toEqual([
        1, 1,
      ]);
    });

    it('keeps a total past what a double can hold exactly', () => {
      const result = project([
        snap('i1', 1, [row('a', { contributionTotal: '9007199254740993' })]),
        snap('i2', 2, [row('a', { contributionTotal: '9007199254740995' })]),
      ]);

      expect(result.changes[0].contributionDelta).toBe('2');
      expect(result.episodes[0].lastObservedContribution).toBe(
        '9007199254740995',
      );
    });
  });

  describe('identities', () => {
    it('reports a confirmed rename as a rename, not a departure and a join', () => {
      const result = project([
        snap('i1', 1, [
          row('a', { aliasId: 'old', characterName: 'Kess Varro' }),
        ]),
        snap('i2', 2, [
          row('a', { aliasId: 'new', characterName: 'Kess Tarin' }),
        ]),
      ]);

      expect(result.episodes).toHaveLength(1);
      expect(result.changes).toEqual([
        expect.objectContaining({
          kind: RosterChangeKind.RENAMED,
          detail: {
            fromCharacterName: 'Kess Varro',
            fromAccountHandle: '@a',
            toCharacterName: 'Kess Tarin',
            toAccountHandle: '@a',
          },
        }),
      ]);
      expect(result.intervals[0].renamed).toBe(1);
    });

    it('takes presence and no values from several rows of one identity', () => {
      const result = project([
        snap('i1', 1, [row('a', { contributionTotal: '100' })]),
        snap('i2', 2, [
          row('a', { aliasId: 'x', contributionTotal: '100', guildRank: 'A' }),
          row('a', { aliasId: 'y', contributionTotal: '900', guildRank: 'B' }),
        ]),
        snap('i3', 3, [row('a', { contributionTotal: '150' })]),
      ]);

      expect(result.episodes).toHaveLength(1);
      expect(result.intervals.map(each => each.membersAtEnd)).toEqual([1, 1]);
      expect(result.intervals.map(each => each.contributionUnknown)).toEqual([
        1, 1,
      ]);
      expect(result.changes).toEqual([
        expect.objectContaining({
          kind: RosterChangeKind.CONTRIBUTION_CHANGED,
          acrossGap: true,
          contributionDelta: '50',
        }),
      ]);
    });

    it('takes no values from a row whose identity also has an excluded row', () => {
      const result = project([
        snap('i1', 1, [row('a', { contributionTotal: '100' })]),
        snap('i2', 2, [row('a', { contributionTotal: '5' })], {
          unknownIdentityIds: ['a'],
        }),
      ]);

      expect(result.changes).toEqual([]);
      expect(result.intervals[0]).toEqual(
        expect.objectContaining({
          membersAtEnd: 1,
          contributionReset: 0,
          contributionUnknown: 1,
        }),
      );
    });

    it('takes a Join Date several rows agree on as the one reported', () => {
      const result = project([
        snap('i1', 1, [
          row('a', { aliasId: 'x' }),
          row('a', { aliasId: 'y', joinedAtAmbiguous: true }),
        ]),
      ]);

      expect(result.episodes[0]).toEqual(
        expect.objectContaining({
          reportedJoinedAt: LONG_AGO,
          reportedJoinedAtAmbiguous: true,
          baselineContribution: null,
        }),
      );
    });

    it('reports no Join Date when several rows disagree on it', () => {
      const result = project([
        snap('i1', 1, [
          row('a', { aliasId: 'x' }),
          row('a', { aliasId: 'y', joinedAt: null }),
        ]),
      ]);

      expect(result.episodes[0].reportedJoinedAt).toBeNull();
    });

    it('opens with no known values and takes the first total that is known', () => {
      const result = project([
        snap('i1', 1, [row('a', { aliasId: 'x' }), row('a', { aliasId: 'y' })]),
        snap('i2', 2, [row('a', { contributionTotal: '70' })]),
        snap('i3', 3, [row('a', { contributionTotal: '90' })]),
      ]);

      expect(result.episodes[0]).toEqual(
        expect.objectContaining({
          baselineContribution: '70',
          lastObservedContribution: '90',
        }),
      );
      expect(result.intervals.map(each => each.contributionDelta)).toEqual([
        '0',
        '20',
      ]);
    });

    it('counts an arrival whose total is unknown as unknown', () => {
      const result = project([
        snap('i1', 1, []),
        snap('i2', 2, [row('a', { aliasId: 'x' }), row('a', { aliasId: 'y' })]),
      ]);

      expect(result.intervals[0]).toEqual(
        expect.objectContaining({
          joined: 1,
          contributionBaseline: 0,
          contributionUnknown: 1,
        }),
      );
    });
  });

  describe('order', () => {
    const a = snap('i1', 1, [
      row('a', { contributionTotal: '10' }),
      row('b', { contributionTotal: '10' }),
    ]);
    const b = snap('i2', 2, [
      row('b', { contributionTotal: '40', guildRank: 'Admiral' }),
      row('c', { contributionTotal: '5' }),
    ]);
    const c = snap('i3', 3, [
      row('a', { contributionTotal: '0' }),
      row('c', { contributionTotal: '9' }),
    ]);

    const permutations = <T>(items: readonly T[]): T[][] =>
      items.length <= 1
        ? [[...items]]
        : items.flatMap((item, index) =>
            permutations([
              ...items.slice(0, index),
              ...items.slice(index + 1),
            ]).map(rest => [item, ...rest]),
          );

    // The plan's validation: all six permutations of three uploads.
    it.each(
      permutations([a, b, c]).map(order => [
        order.map(s => s.importId).join(','),
        order,
      ]),
    )(
      'projects the same whatever order they arrive in (%s)',
      (_label, order) => {
        expect(project(order)).toEqual(project([a, b, c]));
      },
    );

    it('recalculates when a middle export is added, and undoes it when that export is excluded', () => {
      const without = project([a, c]);
      const withMiddle = project([a, b, c]);

      // Without the middle export b is continuous and c joins at i3; with it
      // b leaves at i3 and c joins at i2.
      expect(kinds(without, 'b')).toEqual([RosterChangeKind.LEFT]);
      expect(without.changes.find(ch => ch.identityId === 'b')!.from).toEqual({
        importId: 'i1',
        at: day(1),
      });
      expect(
        withMiddle.changes.find(
          ch => ch.identityId === 'b' && ch.kind === RosterChangeKind.LEFT,
        )!.from,
      ).toEqual({
        importId: 'i2',
        at: day(2),
      });
      expect(withMiddle.intervals).toHaveLength(2);

      // Excluding it again is projecting without it.
      expect(project([c, a])).toEqual(without);
    });

    it('refuses two effective exports of one instant', () => {
      expect(() =>
        project([snap('i1', 1, [row('a')]), snap('i2', 1, [row('a')])]),
      ).toThrow('Only one effective roster export per instant');
    });

    it('refuses the same export twice', () => {
      const once = snap('i1', 1, [row('a')]);

      expect(() => project([once, once])).toThrow(
        'Only one effective roster export per instant',
      );
    });
  });
});
