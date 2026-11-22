import { RosterChangeEntity } from '../../projection/entities/roster-change.entity';
import { RosterChangeKind } from '../../projection/enums/roster-change-kind.enum';
import { RosterRankMove } from '../enums/roster-rank-move.enum';
import { toRosterChangeDto } from './roster-change.mapper';

const FROM_AT = new Date('2024-11-01T12:00:00Z');
const TO_AT = new Date('2024-11-15T12:00:00Z');
const TIERS = new Map([
  ['Officer', 1],
  ['Member', 2],
]);
const MEMBER = { characterName: 'Tova Reen', accountHandle: '@fixture004' };

/**
 * Builds a stored change.
 *
 * @param overrides - Fields to change.
 * @returns The change.
 */
function change(
  overrides: Partial<RosterChangeEntity> = {},
): RosterChangeEntity {
  return {
    identityId: 'identity-1',
    episodeOrdinal: 1,
    kind: RosterChangeKind.CONTRIBUTION_CHANGED,
    fromImportId: 'import-1',
    fromAt: FROM_AT,
    toImportId: 'import-2',
    toAt: TO_AT,
    acrossGap: false,
    contributionDelta: '100',
    detail: { fromContribution: '98100', toContribution: '98200' },
    ...overrides,
  } as RosterChangeEntity;
}

describe('toRosterChangeDto', () => {
  it('carries the bounds, the member and the figures for a timeline', () => {
    expect(toRosterChangeDto(change(), TIERS, MEMBER, true)).toEqual({
      identityId: 'identity-1',
      kind: RosterChangeKind.CONTRIBUTION_CHANGED,
      from: { importId: 'import-1', exportedAt: FROM_AT },
      to: { importId: 'import-2', exportedAt: TO_AT },
      acrossGap: false,
      member: MEMBER,
      rankMove: null,
      contributionDelta: '100',
      fromContribution: '98100',
      toContribution: '98200',
    });
  });

  it('leaves every figure out for the History tab', () => {
    const joined = change({
      kind: RosterChangeKind.JOINED,
      contributionDelta: null,
      detail: { baselineContribution: '5000' },
    });

    expect(toRosterChangeDto(joined, TIERS, MEMBER, false)).toEqual({
      identityId: 'identity-1',
      kind: RosterChangeKind.JOINED,
      from: { importId: 'import-1', exportedAt: FROM_AT },
      to: { importId: 'import-2', exportedAt: TO_AT },
      acrossGap: false,
      member: MEMBER,
      rankMove: null,
    });
  });

  it('carries a baseline to a timeline, with no delta', () => {
    const joined = change({
      kind: RosterChangeKind.JOINED,
      contributionDelta: null,
      detail: { baselineContribution: '5000' },
    });

    expect(toRosterChangeDto(joined, TIERS, null, true)).toMatchObject({
      contributionDelta: null,
      baselineContribution: '5000',
      member: null,
    });
  });

  it('says which way a rank change between tiers went', () => {
    const ranked = change({
      kind: RosterChangeKind.RANK_CHANGED,
      contributionDelta: null,
      detail: { fromRank: 'Member', toRank: 'Officer' },
    });

    expect(toRosterChangeDto(ranked, TIERS, MEMBER, false)).toMatchObject({
      fromRank: 'Member',
      toRank: 'Officer',
      rankMove: RosterRankMove.PROMOTED,
    });
  });

  it('keeps a rename’s names and a Join Date change’s dates', () => {
    const renamed = change({
      kind: RosterChangeKind.RENAMED,
      contributionDelta: null,
      detail: {
        fromCharacterName: 'Kess Varro',
        fromAccountHandle: '@fixture030',
        toCharacterName: 'Kess Tarin',
        toAccountHandle: '@fixture030',
        fromJoinedAt: '2024-01-01T00:00:00.000Z',
        toJoinedAt: '2024-01-02T00:00:00.000Z',
      },
    });

    expect(toRosterChangeDto(renamed, TIERS, MEMBER, false)).toMatchObject({
      fromCharacterName: 'Kess Varro',
      toCharacterName: 'Kess Tarin',
      fromJoinedAt: '2024-01-01T00:00:00.000Z',
      toJoinedAt: '2024-01-02T00:00:00.000Z',
      rankMove: null,
    });
  });

  it('gives a change no export bounds below no lower bound', () => {
    expect(
      toRosterChangeDto(
        change({ fromImportId: null, fromAt: null }),
        TIERS,
        MEMBER,
        false,
      ).from,
    ).toBeNull();
  });
});
