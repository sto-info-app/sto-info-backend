import { ApiProperty } from '@nestjs/swagger';

import { FleetApplicationRoute } from '../../recruitment/enums/fleet-application-route.enum';
import { FleetReportView } from '../enums/fleet-report-view.enum';
import { FleetReport } from '../enums/fleet-report.enum';

/** The span a report built from the Fleet's own records covers. */
export class FleetRecordReportRangeDto {
  @ApiProperty() from: Date;

  @ApiProperty() to: Date;
}

/**
 * What a report built from the Fleet's own records says about itself
 * (FC-030): no roster revision or exports, only its span and view.
 *
 * In an aggregate view, a count that is null was hidden: it counted from 1
 * to 4 people, or would have let one that did be worked out.
 */
export class FleetRecordReportHeaderDto {
  @ApiProperty({ enum: FleetReport }) report: FleetReport;

  @ApiProperty({ enum: FleetReportView }) view: FleetReportView;

  @ApiProperty({ type: FleetRecordReportRangeDto })
  range: FleetRecordReportRangeDto;

  @ApiProperty({
    description:
      'The fewest people a figure in an aggregate view counts; smaller ' +
      'figures are null.',
  })
  minimumCohort: number;
}

/** One occurrence of one of the Fleet's own events, and who came. */
export class AttendanceOccurrenceRowDto {
  @ApiProperty() occurrenceId: string;

  @ApiProperty() eventId: string;

  @ApiProperty() title: string;

  @ApiProperty() startsAt: Date;

  @ApiProperty({
    description: 'Going with a place, as it stands now.',
    nullable: true,
    type: Number,
  })
  going: number | null;

  @ApiProperty({ nullable: true, type: Number }) attended: number | null;

  @ApiProperty({ nullable: true, type: Number }) absent: number | null;

  @ApiProperty({
    description: 'Attended out of everybody recorded, 0 to 1, or null.',
    nullable: true,
    type: Number,
  })
  rate: number | null;
}

/** Every occurrence in the span, together. */
export class AttendanceTotalsDto {
  @ApiProperty() occurrences: number;

  @ApiProperty({ nullable: true, type: Number }) attended: number | null;

  @ApiProperty({ nullable: true, type: Number }) absent: number | null;

  @ApiProperty({ nullable: true, type: Number }) rate: number | null;
}

/** One person's attendance over the span, for the full view alone. */
export class AttendanceMemberRowDto {
  @ApiProperty({ nullable: true, type: String }) username: string | null;

  @ApiProperty() attended: number;

  @ApiProperty() absent: number;
}

/** Who came to the Fleet's own events (FC-030). */
export class FleetAttendanceReportDto extends FleetRecordReportHeaderDto {
  @ApiProperty({ type: [AttendanceOccurrenceRowDto] })
  occurrences: AttendanceOccurrenceRowDto[];

  @ApiProperty({ type: AttendanceTotalsDto }) totals: AttendanceTotalsDto;

  @ApiProperty({
    description:
      'Each person recorded, most attended first. For reports.view holders ' +
      'alone; null for anybody else.',
    type: [AttendanceMemberRowDto],
    nullable: true,
  })
  members: AttendanceMemberRowDto[] | null;
}

/** How one route's requests in one month turned out. */
export class RecruitmentMonthRowDto {
  @ApiProperty({ description: 'YYYY-MM, UTC.' }) month: string;

  @ApiProperty({ enum: FleetApplicationRoute }) route: FleetApplicationRoute;

  @ApiProperty({ nullable: true, type: Number }) received: number | null;

  @ApiProperty({ nullable: true, type: Number }) accepted: number | null;

  @ApiProperty({
    description: 'Rejected applications, or declined invitations.',
    nullable: true,
    type: Number,
  })
  declined: number | null;

  @ApiProperty({ nullable: true, type: Number }) withdrawn: number | null;

  @ApiProperty({
    description: 'Invitations that ran out unanswered.',
    nullable: true,
    type: Number,
  })
  lapsed: number | null;

  @ApiProperty({ nullable: true, type: Number }) pending: number | null;

  @ApiProperty({
    description: 'Median days from asking to a decision, or null.',
    nullable: true,
    type: Number,
  })
  medianDaysToDecision: number | null;
}

/** How applications and invitations turned out (FC-030). */
export class FleetRecruitmentReportDto extends FleetRecordReportHeaderDto {
  @ApiProperty({ type: [RecruitmentMonthRowDto] })
  months: RecruitmentMonthRowDto[];
}

/** One track's tier changed. */
export class HoldingsChangeRowDto {
  @ApiProperty() at: Date;

  @ApiProperty() holding: string;

  @ApiProperty() track: string;

  @ApiProperty() from: number;

  @ApiProperty() to: number;
}

/** How the Fleet's holdings changed (FC-030). Public. */
export class FleetHoldingsReportDto extends FleetRecordReportHeaderDto {
  @ApiProperty({
    description: 'Newest first. Never who recorded them.',
    type: [HoldingsChangeRowDto],
  })
  changes: HoldingsChangeRowDto[];
}
