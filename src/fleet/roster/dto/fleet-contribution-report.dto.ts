import { ApiProperty } from '@nestjs/swagger';

import { RosterChangeKind } from '../../projection/enums/roster-change-kind.enum';
import { FleetReportHeaderDto } from './fleet-report.dto';
import { RosterMemberNameDto } from './roster-history.dto';
import { RosterExportRefDto } from './roster-page.dto';

/** What was contributed between two consecutive effective exports. */
export class ContributionIntervalDto {
  @ApiProperty({ type: RosterExportRefDto })
  from: RosterExportRefDto;

  @ApiProperty({ type: RosterExportRefDto })
  to: RosterExportRefDto;

  @ApiProperty({ description: 'Whether the later export was partial.' })
  partial: boolean;

  @ApiProperty({
    nullable: true,
    description:
      'The sum of every known rise, as a decimal string. Never allocated ' +
      'to a day or week within the interval.',
  })
  contributionDelta: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Members with a known delta, zero included.',
  })
  known: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Members whose total fell: a reset, never a negative gift.',
  })
  reset: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Members whose episode began at its end: a new baseline.',
  })
  baseline: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Every other member listed at either end.',
  })
  unknown: number | null;
}

/** One member's rise or reset in the detail interval. */
export class ContributionMemberDto {
  @ApiProperty()
  identityId: string;

  @ApiProperty({
    type: RosterMemberNameDto,
    nullable: true,
    description: 'The member as the later export listed them.',
  })
  member: RosterMemberNameDto | null;

  @ApiProperty({
    enum: [
      RosterChangeKind.CONTRIBUTION_CHANGED,
      RosterChangeKind.CONTRIBUTION_RESET,
    ],
  })
  kind: RosterChangeKind;

  @ApiProperty({
    nullable: true,
    description: 'For a rise, the rise; null for a reset.',
  })
  delta: string | null;

  @ApiProperty({ nullable: true })
  fromContribution: string | null;

  @ApiProperty({ nullable: true })
  toContribution: string | null;

  @ApiProperty({
    type: RosterExportRefDto,
    nullable: true,
    description: 'The export it happened after.',
  })
  from: RosterExportRefDto | null;

  @ApiProperty({
    description:
      'Whether its bounds are wider than the interval. Counted in no ' +
      'interval’s total.',
  })
  acrossGap: boolean;
}

/** Contribution, interval by interval, oldest first (FC-020). */
export class FleetContributionReportDto extends FleetReportHeaderDto {
  @ApiProperty({ type: [ContributionIntervalDto] })
  intervals: ContributionIntervalDto[];

  @ApiProperty({
    type: RosterExportRefDto,
    nullable: true,
    description:
      'The export whose interval the members are listed for. Full view only.',
  })
  at: RosterExportRefDto | null;

  @ApiProperty({
    type: [ContributionMemberDto],
    nullable: true,
    description:
      'Each member’s rise, largest first, then each reset, in the interval ' +
      'ending at `at`. Full view only.',
  })
  members: ContributionMemberDto[] | null;
}
