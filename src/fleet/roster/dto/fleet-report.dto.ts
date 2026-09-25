import { ApiProperty } from '@nestjs/swagger';

import { FleetReportView } from '../enums/fleet-report-view.enum';
import { FleetReport } from '../enums/fleet-report.enum';
import { RosterCoverageDto } from './roster-page.dto';

/** A report a viewer may see, and how much of it. */
export class FleetReportAccessDto {
  @ApiProperty({ enum: FleetReport })
  report: FleetReport;

  @ApiProperty({ enum: FleetReportView })
  view: FleetReportView;
}

/** The span a report was asked to cover. */
export class FleetReportRangeDto {
  @ApiProperty({ nullable: true })
  from: Date | null;

  @ApiProperty({ nullable: true })
  to: Date | null;
}

/**
 * What every report says about itself.
 *
 * In an aggregate view, a count or total that is null was hidden: it counted
 * from 1 to 4 members, or would have let one that did be worked out.
 */
export class FleetReportHeaderDto {
  @ApiProperty({ enum: FleetReport })
  report: FleetReport;

  @ApiProperty({ enum: FleetReportView })
  view: FleetReportView;

  @ApiProperty({ description: 'The revision read. 0 before the first.' })
  revision: number;

  @ApiProperty({ nullable: true })
  publishedAt: Date | null;

  @ApiProperty()
  stale: boolean;

  @ApiProperty({ type: FleetReportRangeDto })
  range: FleetReportRangeDto;

  @ApiProperty({
    type: RosterCoverageDto,
    description: 'The effective exports within the span.',
  })
  coverage: RosterCoverageDto;

  @ApiProperty({
    description:
      'The fewest members a figure in an aggregate view counts; smaller ' +
      'figures are null.',
  })
  minimumCohort: number;
}
