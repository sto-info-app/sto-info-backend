import { RosterRankMove } from '../enums/roster-rank-move.enum';

/**
 * Says whether a change of rank label was a promotion or a demotion.
 *
 * Plan section 3.7: rank text is the Fleet's own, so a change is only called
 * a promotion when the Fleet's order places both labels, in different tiers.
 *
 * @param tiers - The Fleet's rank order: each placed label's tier, 1 the
 *   highest.
 * @param fromRank - The label before, if the change had one.
 * @param toRank - The label after, if the change had one.
 * @returns The move, or null when it is only a rank change.
 */
export function rosterRankMove(
  tiers: ReadonlyMap<string, number>,
  fromRank: string | undefined,
  toRank: string | undefined,
): RosterRankMove | null {
  if (fromRank === undefined || toRank === undefined) {
    return null;
  }

  const from = tiers.get(fromRank);
  const to = tiers.get(toRank);

  if (from === undefined || to === undefined || from === to) {
    return null;
  }

  return to < from ? RosterRankMove.PROMOTED : RosterRankMove.DEMOTED;
}
