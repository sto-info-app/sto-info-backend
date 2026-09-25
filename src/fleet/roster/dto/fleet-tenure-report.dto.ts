import { ApiProperty } from '@nestjs/swagger';

import { RosterTenureBand } from '../enums/roster-tenure-band.enum';
import { FleetReportHeaderDto } from './fleet-report.dto';
import { RosterExportRefDto } from './roster-page.dto';

/** How long an export's members had been listed. */
export class TenureExportDto {
  @ApiProperty({ type: RosterExportRefDto })
  export: RosterExportRefDto;

  @ApiProperty({ description: 'Whether the export was partial.' })
  partial: boolean;

  @ApiProperty({ nullable: true, description: 'Members it listed.' })
  members: number | null;

  @ApiProperty({
    description: 'Members in each band, keyed by band; null where hidden.',
    type: 'object',
    additionalProperties: { type: 'number', nullable: true },
  })
  bands: Record<RosterTenureBand, number | null>;

  @ApiProperty({
    description:
      'Of each band, the members whose episode no earlier export bounds: ' +
      'they had been listed at least that long. Null where hidden.',
    type: 'object',
    additionalProperties: { type: 'number', nullable: true },
  })
  atLeast: Record<RosterTenureBand, number | null>;
}

/** One member at the detail export, and how long they had been listed. */
export class TenureMemberDto {
  @ApiProperty()
  identityId: string;

  @ApiProperty()
  characterName: string;

  @ApiProperty()
  accountHandle: string;

  @ApiProperty({ description: 'The first export of their current episode.' })
  firstObservedAt: Date;

  @ApiProperty({ description: 'Whole days from then to the export.' })
  days: number;

  @ApiProperty({ enum: RosterTenureBand })
  band: RosterTenureBand;

  @ApiProperty({
    description: 'Whether no earlier export bounds it: at least this long.',
  })
  atLeast: boolean;
}

/** Observed tenure at each export, oldest first (FC-020). */
export class FleetTenureReportDto extends FleetReportHeaderDto {
  @ApiProperty({ type: [TenureExportDto] })
  exports: TenureExportDto[];

  @ApiProperty({
    type: RosterExportRefDto,
    nullable: true,
    description: 'The export the members are listed at. Full view only.',
  })
  at: RosterExportRefDto | null;

  @ApiProperty({
    type: [TenureMemberDto],
    nullable: true,
    description: 'Each member at `at`, longest listed first. Full view only.',
  })
  members: TenureMemberDto[] | null;
}

/** A rank label's members at one export. */
export class RankCountDto {
  @ApiProperty()
  label: string;

  @ApiProperty({ nullable: true, description: 'Its tier, 1 the highest.' })
  tier: number | null;

  @ApiProperty({ nullable: true })
  members: number | null;
}

/** The rank changes an export revealed. */
export class RankChangeCountDto {
  @ApiProperty({
    nullable: true,
    description: 'Moves to a higher tier of the Fleet’s rank order.',
  })
  promoted: number | null;

  @ApiProperty({ nullable: true, description: 'Moves to a lower tier.' })
  demoted: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'Every other change of label: within a tier, or to or from a label ' +
      'nobody placed.',
  })
  changed: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'Changes revealed here whose bounds are wider than the interval, of ' +
      'any of the kinds above.',
  })
  acrossGap: number | null;
}

/** An export's rank distribution. */
export class RanksExportDto {
  @ApiProperty({ type: RosterExportRefDto })
  export: RosterExportRefDto;

  @ApiProperty()
  partial: boolean;

  @ApiProperty({
    type: [RankCountDto],
    description: 'Each label it lists, highest tier first, unplaced last.',
  })
  labels: RankCountDto[];

  @ApiProperty({
    type: RankChangeCountDto,
    nullable: true,
    description:
      'The rank changes it revealed since the export before. Null for the ' +
      'Fleet’s first export.',
  })
  changes: RankChangeCountDto | null;
}

/** Rank distribution at each export, oldest first (FC-020). */
export class FleetRanksReportDto extends FleetReportHeaderDto {
  @ApiProperty({ type: [RanksExportDto] })
  exports: RanksExportDto[];
}
