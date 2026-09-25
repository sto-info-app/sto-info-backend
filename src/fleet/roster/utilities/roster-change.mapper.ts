import { RosterChangeEntity } from '../../projection/entities/roster-change.entity';
import {
  RosterChangeDto,
  RosterMemberNameDto,
} from '../dto/roster-history.dto';
import { rosterRankMove } from './roster-rank-move.utility';

/**
 * Maps a stored change for a reader.
 *
 * The History tab shows contribution only as interval totals, so it asks for
 * the change without its figures; a member's timeline asks for them.
 *
 * @param change - The change.
 * @param tiers - The Fleet's rank order.
 * @param member - The member as the export that showed them listed them.
 * @param withContribution - Whether to carry the contribution figures.
 * @returns The change as a reader sees it.
 */
export function toRosterChangeDto(
  change: RosterChangeEntity,
  tiers: ReadonlyMap<string, number>,
  member: RosterMemberNameDto | null,
  withContribution: boolean,
): RosterChangeDto {
  const { fromContribution, toContribution, baselineContribution, ...labels } =
    change.detail;
  const mapped: RosterChangeDto = {
    identityId: change.identityId,
    kind: change.kind,
    from:
      change.fromImportId === null || change.fromAt === null
        ? null
        : { importId: change.fromImportId, exportedAt: change.fromAt },
    to: { importId: change.toImportId, exportedAt: change.toAt },
    acrossGap: change.acrossGap,
    member,
    rankMove: rosterRankMove(tiers, labels.fromRank, labels.toRank),
    ...labels,
  };

  if (!withContribution) {
    return mapped;
  }

  return {
    ...mapped,
    contributionDelta: change.contributionDelta,
    ...(fromContribution === undefined ? {} : { fromContribution }),
    ...(toContribution === undefined ? {} : { toContribution }),
    ...(baselineContribution === undefined ? {} : { baselineContribution }),
  };
}
