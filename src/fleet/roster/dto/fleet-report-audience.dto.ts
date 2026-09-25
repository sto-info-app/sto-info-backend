import { ApiProperty } from '@nestjs/swagger';

import { IsEnum } from 'class-validator';

import { FleetAudience } from '../../enums/fleet-audience.enum';
import { FleetReport } from '../enums/fleet-report.enum';

/** Who the Owner lets see one of a Fleet's reports (FC-020). */
export class SetFleetReportAudienceDto {
  @ApiProperty({
    enum: FleetAudience,
    description:
      'PRIVATE: reports.view holders. FLEET_MEMBERS: the Fleet’s members ' +
      'too, in full. COMMUNITY and PUBLIC: the Community’s followers, or ' +
      'anyone, who see aggregates only.',
  })
  @IsEnum(FleetAudience)
  readonly audience: FleetAudience;
}

/** One report's audience now. */
export class FleetReportAudienceDto {
  @ApiProperty({ enum: FleetReport })
  report: FleetReport;

  @ApiProperty({ enum: FleetAudience })
  audience: FleetAudience;

  @ApiProperty({
    nullable: true,
    description: 'When it was last changed, or null if it never has been.',
  })
  updatedAt: Date | null;
}

/** One change to a report's audience. */
export class FleetReportAudienceChangeDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: FleetReport })
  report: FleetReport;

  @ApiProperty({ enum: FleetAudience })
  audienceBefore: FleetAudience;

  @ApiProperty({ enum: FleetAudience })
  audienceAfter: FleetAudience;

  @ApiProperty({
    nullable: true,
    description: 'Who changed it, by STO Info username, or null once gone.',
  })
  actorName: string | null;

  @ApiProperty()
  changedAt: Date;
}

/** Every report's audience, and how each came to be (FC-020). */
export class FleetReportAudiencesDto {
  @ApiProperty({ type: [FleetReportAudienceDto] })
  reports: FleetReportAudienceDto[];

  @ApiProperty({
    type: [FleetReportAudienceChangeDto],
    description: 'Every change, newest first.',
  })
  changes: FleetReportAudienceChangeDto[];
}
