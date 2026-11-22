import { ApiProperty } from '@nestjs/swagger';

import { RosterActivityBand } from '../enums/roster-activity-band.enum';
import { FleetReportHeaderDto } from './fleet-report.dto';
import { RosterExportRefDto } from './roster-page.dto';

/** Growth and loss between two consecutive effective exports. */
export class GrowthIntervalDto {
  @ApiProperty({ type: RosterExportRefDto })
  from: RosterExportRefDto;

  @ApiProperty({ type: RosterExportRefDto })
  to: RosterExportRefDto;

  @ApiProperty({ description: 'Whether the later export was partial.' })
  partial: boolean;

  @ApiProperty({ nullable: true, description: 'Members the earlier listed.' })
  membersAtStart: number | null;

  @ApiProperty({ nullable: true, description: 'Members the later listed.' })
  membersAtEnd: number | null;

  @ApiProperty({ nullable: true })
  joined: number | null;

  @ApiProperty({ nullable: true })
  rejoined: number | null;

  @ApiProperty({ nullable: true })
  left: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Members the later export, being partial, left unknown.',
  })
  unknown: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Changes revealed here whose bounds are wider.',
  })
  acrossGap: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'Account handles the earlier export listed: observed accounts, not ' +
      'people.',
  })
  accountsAtStart: number | null;

  @ApiProperty({ nullable: true })
  accountsAtEnd: number | null;
}

/** Growth and loss, interval by interval, oldest first (FC-020). */
export class FleetGrowthReportDto extends FleetReportHeaderDto {
  @ApiProperty({ type: [GrowthIntervalDto] })
  intervals: GrowthIntervalDto[];
}

/** How recently an export's members had been active. */
export class ActivityExportDto {
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
    example: {
      [RosterActivityBand.WITHIN_7_DAYS]: 21,
      [RosterActivityBand.WITHIN_30_DAYS]: 8,
      [RosterActivityBand.WITHIN_90_DAYS]: null,
      [RosterActivityBand.OVER_90_DAYS]: null,
      [RosterActivityBand.UNKNOWN]: 0,
    },
  })
  bands: Record<RosterActivityBand, number | null>;
}

/** Imported activity at each export, oldest first (FC-020). */
export class FleetActivityReportDto extends FleetReportHeaderDto {
  @ApiProperty({ type: [ActivityExportDto] })
  exports: ActivityExportDto[];
}
