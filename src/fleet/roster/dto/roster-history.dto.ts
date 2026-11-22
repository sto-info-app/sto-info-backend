import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { RosterChangeKind } from '../../projection/enums/roster-change-kind.enum';
import { RosterEpisodeEnd } from '../../projection/enums/roster-episode-end.enum';
import { RosterEpisodeStart } from '../../projection/enums/roster-episode-start.enum';
import { RosterRankMove } from '../enums/roster-rank-move.enum';
import { RosterExportRefDto, RosterProfileLinkDto } from './roster-page.dto';

/** A member's name and handle, as one export listed them. */
export class RosterMemberNameDto {
  @ApiProperty()
  characterName: string;

  @ApiProperty()
  accountHandle: string;
}

/**
 * One change to one member, bounded by the two exports it lies between.
 *
 * Never dated more exactly than its bounds: a departure lies after `from`
 * and by `to`, never "on" either.
 */
export class RosterChangeDto {
  @ApiProperty({ description: 'The member.' })
  identityId: string;

  @ApiProperty({ enum: RosterChangeKind })
  kind: RosterChangeKind;

  @ApiProperty({
    type: RosterExportRefDto,
    nullable: true,
    description: 'The export it happened after.',
  })
  from: RosterExportRefDto | null;

  @ApiProperty({
    type: RosterExportRefDto,
    description: 'The export it happened by.',
  })
  to: RosterExportRefDto;

  @ApiProperty({
    description:
      'Whether its bounds are wider than one interval, because the member ' +
      'was unknown in between. Counted in no interval’s totals.',
  })
  acrossGap: boolean;

  @ApiProperty({
    type: RosterMemberNameDto,
    nullable: true,
    description:
      'The member as the export that showed them listed them: the later ' +
      'export, or for a departure the earlier.',
  })
  member: RosterMemberNameDto | null;

  @ApiProperty({
    enum: RosterRankMove,
    nullable: true,
    description:
      'For a rank change between two tiers of the Fleet’s rank order, which ' +
      'way it went. Null is only "rank changed".',
  })
  rankMove: RosterRankMove | null;

  @ApiPropertyOptional()
  fromCharacterName?: string;

  @ApiPropertyOptional()
  fromAccountHandle?: string;

  @ApiPropertyOptional()
  toCharacterName?: string;

  @ApiPropertyOptional()
  toAccountHandle?: string;

  @ApiPropertyOptional()
  fromRank?: string;

  @ApiPropertyOptional()
  toRank?: string;

  @ApiPropertyOptional({ description: 'ISO 8601.' })
  fromJoinedAt?: string;

  @ApiPropertyOptional({ description: 'ISO 8601.' })
  toJoinedAt?: string;

  @ApiPropertyOptional({
    description: 'For a rise, the rise, as a decimal string. Timeline only.',
    nullable: true,
  })
  contributionDelta?: string | null;

  @ApiPropertyOptional({ description: 'Timeline only.' })
  fromContribution?: string;

  @ApiPropertyOptional({ description: 'Timeline only.' })
  toContribution?: string;

  @ApiPropertyOptional({
    description: 'The total an episode began from. Timeline only.',
  })
  baselineContribution?: string;
}

/** What happened between two consecutive effective exports. */
export class RosterIntervalDto {
  @ApiProperty({ type: RosterExportRefDto })
  from: RosterExportRefDto;

  @ApiProperty({ type: RosterExportRefDto })
  to: RosterExportRefDto;

  @ApiProperty({ description: 'Whether the later export was partial.' })
  partial: boolean;

  @ApiProperty()
  membersAtStart: number;

  @ApiProperty()
  membersAtEnd: number;

  @ApiProperty()
  joined: number;

  @ApiProperty()
  rejoined: number;

  @ApiProperty()
  left: number;

  @ApiProperty({ description: 'Members the later export left unknown.' })
  unknown: number;

  @ApiProperty()
  renamed: number;

  @ApiProperty()
  rankChanged: number;

  @ApiProperty()
  joinDateChanged: number;

  @ApiProperty({
    description:
      'Changes the later export revealed whose bounds are wider than this ' +
      'interval. In none of its other totals.',
  })
  acrossGap: number;

  @ApiProperty({
    description: 'The sum of every known rise, as a decimal string.',
  })
  contributionDelta: string;

  @ApiProperty({ description: 'Members with a known delta, zero included.' })
  contributionKnown: number;

  @ApiProperty({ description: 'Members whose total fell: a reset.' })
  contributionReset: number;

  @ApiProperty({ description: 'Members whose episode began at its end.' })
  contributionBaseline: number;

  @ApiProperty({ description: 'Every other member listed at either end.' })
  contributionUnknown: number;

  @ApiProperty({
    type: [RosterChangeDto],
    description: 'The membership, name, rank and Join Date changes in it.',
  })
  changes: RosterChangeDto[];
}

/** A page of a Fleet's roster history, newest interval first (FC-020). */
export class RosterHistoryPageDto {
  @ApiProperty({ description: 'The revision read. 0 before the first.' })
  revision: number;

  @ApiProperty({ nullable: true })
  publishedAt: Date | null;

  @ApiProperty()
  stale: boolean;

  @ApiProperty({ type: [RosterIntervalDto] })
  items: RosterIntervalDto[];

  @ApiProperty({ description: 'How many intervals there are.' })
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;
}

/** One stretch of a member's membership, bounded by exports. */
export class RosterEpisodeDto {
  @ApiProperty({ description: 'Its place among the member’s episodes.' })
  ordinal: number;

  @ApiProperty({ enum: RosterEpisodeStart })
  startKind: RosterEpisodeStart;

  @ApiProperty({
    type: RosterExportRefDto,
    nullable: true,
    description: 'The latest export known not to list them before it.',
  })
  startedAfter: RosterExportRefDto | null;

  @ApiProperty({ type: RosterExportRefDto })
  first: RosterExportRefDto;

  @ApiProperty({ nullable: true })
  reportedJoinedAt: Date | null;

  @ApiProperty()
  reportedJoinedAtAmbiguous: boolean;

  @ApiProperty({ type: RosterExportRefDto })
  last: RosterExportRefDto;

  @ApiProperty({ enum: RosterEpisodeEnd, nullable: true })
  endKind: RosterEpisodeEnd | null;

  @ApiProperty({
    nullable: true,
    description: 'The instant it had ended by, or null while open.',
  })
  endedBefore: Date | null;

  @ApiProperty({
    nullable: true,
    description: 'For a departure, the complete export that did not list them.',
  })
  endedBeforeImportId: string | null;

  @ApiProperty({ nullable: true })
  baselineContribution: string | null;

  @ApiProperty({ nullable: true })
  lastObservedContribution: string | null;
}

/** A member's row on one export. */
export class RosterMemberRowDto {
  @ApiProperty()
  importId: string;

  @ApiProperty()
  exportedAt: Date;

  @ApiProperty({ description: 'Whether the export was marked partial.' })
  partial: boolean;

  @ApiProperty()
  line: number;

  @ApiProperty()
  characterName: string;

  @ApiProperty()
  accountHandle: string;

  @ApiProperty()
  level: number;

  @ApiProperty()
  guildRank: string;

  @ApiProperty({ nullable: true })
  rankTier: number | null;

  @ApiProperty({ description: 'As a decimal string.' })
  contributionTotal: string;

  @ApiProperty({ nullable: true })
  lastActiveAt: Date | null;

  @ApiProperty()
  lastActiveAtAmbiguous: boolean;

  @ApiProperty({
    description: 'Whether an investigator excluded it. Investigators only.',
  })
  excluded: boolean;
}

/** One member's history in a Fleet (FC-020). */
export class RosterTimelineDto {
  @ApiProperty()
  revision: number;

  @ApiProperty({ nullable: true })
  publishedAt: Date | null;

  @ApiProperty()
  stale: boolean;

  @ApiProperty()
  identityId: string;

  @ApiProperty({
    type: RosterMemberNameDto,
    nullable: true,
    description: 'The member as the latest export listing them did.',
  })
  member: RosterMemberNameDto | null;

  @ApiProperty({ type: RosterProfileLinkDto, nullable: true })
  profile: RosterProfileLinkDto | null;

  @ApiProperty({ type: [RosterEpisodeDto] })
  episodes: RosterEpisodeDto[];

  @ApiProperty({
    type: [RosterChangeDto],
    description: 'Every change, contribution included, oldest first.',
  })
  changes: RosterChangeDto[];

  @ApiProperty({
    type: [RosterMemberRowDto],
    description: 'Their row on each effective export listing them.',
  })
  rows: RosterMemberRowDto[];
}
