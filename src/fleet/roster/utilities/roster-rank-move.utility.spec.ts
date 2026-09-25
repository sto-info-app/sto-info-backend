import { RosterRankMove } from '../enums/roster-rank-move.enum';
import { rosterRankMove } from './roster-rank-move.utility';

const TIERS = new Map([
  ['Admiral', 1],
  ['Captain', 2],
  ['Commander', 2],
  ['Ensign', 3],
]);

describe('rosterRankMove', () => {
  it('calls a move to a higher tier a promotion', () => {
    expect(rosterRankMove(TIERS, 'Ensign', 'Captain')).toBe(
      RosterRankMove.PROMOTED,
    );
  });

  it('calls a move to a lower tier a demotion', () => {
    expect(rosterRankMove(TIERS, 'Admiral', 'Ensign')).toBe(
      RosterRankMove.DEMOTED,
    );
  });

  // Renaming a rank looks exactly like this.
  it('calls a move within a tier only a rank change', () => {
    expect(rosterRankMove(TIERS, 'Captain', 'Commander')).toBeNull();
  });

  it('calls a move to or from an unplaced label only a rank change', () => {
    expect(rosterRankMove(TIERS, 'Cadet', 'Ensign')).toBeNull();
    expect(rosterRankMove(TIERS, 'Ensign', 'Cadet')).toBeNull();
  });

  it('calls nothing a promotion in a Fleet with no order', () => {
    expect(rosterRankMove(new Map(), 'Ensign', 'Admiral')).toBeNull();
  });

  it('has no move for a change with no labels', () => {
    expect(rosterRankMove(TIERS, undefined, 'Admiral')).toBeNull();
    expect(rosterRankMove(TIERS, 'Admiral', undefined)).toBeNull();
  });
});
