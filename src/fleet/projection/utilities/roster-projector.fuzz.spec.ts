import * as fc from 'fast-check';

import { RosterChangeKind } from '../enums/roster-change-kind.enum';
import {
  ProjectorRow,
  ProjectorSnapshot,
  RosterProjector,
} from './roster-projector';

/**
 * Properties of the roster projector over generated Fleet histories.
 *
 * The plan's validation for FC-019 asks for permutation and property tests.
 * The example-based spec covers each rule once; these hold the rules that
 * must be true of every history — whatever members come and go, however
 * contributions move, whichever exports are partial or have rows excluded.
 */
describe('RosterProjector properties', () => {
  const numRuns = Number(process.env['FUZZ_NUM_RUNS']) || 100;
  const identities = ['a', 'b', 'c', 'd', 'e', 'f'];

  /** One member's row, with values drawn to include resets and rejoins. */
  const rowArbitrary = (identityId: string, day: number) =>
    fc
      .record({
        alias: fc.constantFrom('x', 'y'),
        rank: fc.constantFrom('Cadet', 'Ensign', 'Admiral'),
        contribution: fc.bigInt({ min: 0n, max: 10n ** 12n }),
        joinedOffsetDays: fc.integer({ min: -400, max: 0 }),
        ambiguous: fc.boolean(),
        joinDateMissing: fc.boolean(),
      })
      .map((drawn): ProjectorRow => ({
        identityId,
        aliasId: `${identityId}-${drawn.alias}`,
        characterName: `Name ${identityId}${drawn.alias}`,
        accountHandle: `@${identityId}`,
        guildRank: drawn.rank,
        contributionTotal: drawn.contribution.toString(),
        joinedAt: drawn.joinDateMissing
          ? null
          : new Date(Date.UTC(2024, 0, day + drawn.joinedOffsetDays, 6)),
        joinedAtAmbiguous: drawn.ambiguous,
      }));

  /** One export: a subset of members, perhaps partial, perhaps excluding. */
  const snapshotArbitrary = (index: number) =>
    fc
      .record({
        present: fc.subarray(identities),
        duplicated: fc.subarray(identities, { maxLength: 1 }),
        unknown: fc.subarray(identities, { maxLength: 2 }),
        partial: fc.boolean(),
        gap: fc.integer({ min: 1, max: 30 }),
      })
      .chain(drawn => {
        const day = index * 31 + drawn.gap;
        const rows = [
          ...drawn.present,
          ...drawn.duplicated.filter(id => drawn.present.includes(id)),
        ].map(id => rowArbitrary(id, day));

        return fc.tuple(...rows).map((generated): ProjectorSnapshot => ({
          importId: `i${index}`,
          exportedAt: new Date(Date.UTC(2024, 0, day, 12)),
          partial: drawn.partial,
          rows: generated,
          unknownIdentityIds: drawn.unknown,
        }));
      });

  const historyArbitrary = fc
    .integer({ min: 0, max: 7 })
    .chain(length =>
      fc.tuple(
        ...Array.from({ length }, (_, index) => snapshotArbitrary(index)),
      ),
    );

  const project = (snapshots: readonly ProjectorSnapshot[]) =>
    new RosterProjector().project(snapshots);

  it('projects the same history the same whatever order it arrives in', () => {
    fc.assert(
      fc.property(
        historyArbitrary.chain(history =>
          fc.tuple(
            fc.constant(history),
            fc.shuffledSubarray(history, {
              minLength: history.length,
              maxLength: history.length,
            }),
          ),
        ),
        ([history, shuffled]) => {
          expect(project(shuffled)).toEqual(project(history));
        },
      ),
      { numRuns },
    );
  });

  it('never records a negative delta, in a change or an interval', () => {
    fc.assert(
      fc.property(historyArbitrary, history => {
        const result = project(history);

        for (const change of result.changes) {
          if (change.contributionDelta !== null) {
            expect(BigInt(change.contributionDelta) > 0n).toBe(true);
            expect(change.kind).toBe(RosterChangeKind.CONTRIBUTION_CHANGED);
          }
        }

        for (const interval of result.intervals) {
          expect(BigInt(interval.contributionDelta) >= 0n).toBe(true);
        }
      }),
      { numRuns },
    );
  });

  it('accounts for every member at either end of an interval exactly once', () => {
    fc.assert(
      fc.property(historyArbitrary, history => {
        const result = project(history);
        const byImport = new Map(history.map(each => [each.importId, each]));

        for (const interval of result.intervals) {
          const listed = new Set([
            ...byImport
              .get(interval.from.importId)!
              .rows.map(r => r.identityId),
            ...byImport.get(interval.to.importId)!.rows.map(r => r.identityId),
          ]);

          expect(
            interval.contributionKnown +
              interval.contributionReset +
              interval.contributionBaseline +
              interval.contributionUnknown,
          ).toBe(listed.size);
        }
      }),
      { numRuns },
    );
  });

  it('ends an episode only at a complete export that shows the member absent', () => {
    fc.assert(
      fc.property(historyArbitrary, history => {
        const result = project(history);
        const byImport = new Map(history.map(each => [each.importId, each]));

        for (const change of result.changes) {
          const to = byImport.get(change.to.importId)!;
          const listed = to.rows.some(r => r.identityId === change.identityId);

          if (change.kind === RosterChangeKind.LEFT && !listed) {
            expect(to.partial).toBe(false);
            expect(to.unknownIdentityIds).not.toContain(change.identityId);
          }
        }
      }),
      { numRuns },
    );
  });

  it("keeps each identity's episodes in order and apart", () => {
    fc.assert(
      fc.property(historyArbitrary, history => {
        const result = project(history);

        for (const id of identities) {
          const episodes = result.episodes.filter(e => e.identityId === id);

          episodes.forEach((episode, index) => {
            expect(episode.ordinal).toBe(index + 1);
            expect(episode.first.at.getTime()).toBeLessThanOrEqual(
              episode.last.at.getTime(),
            );

            if (index < episodes.length - 1) {
              expect(episode.endKind).not.toBeNull();
              expect(episode.last.at.getTime()).toBeLessThan(
                episodes[index + 1].first.at.getTime(),
              );
            }
          });
        }
      }),
      { numRuns },
    );
  });
});
