import { ApiProperty } from '@nestjs/swagger';

import { FleetAudience } from '../../enums/fleet-audience.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';

/**
 * A Community as a site administrator finds it for its dispute page
 * (FC-050), whoever may see it.
 */
export class AdminCommunitySummaryDto {
  @ApiProperty() id: string;

  @ApiProperty() name: string;

  @ApiProperty({ description: 'The segment its address is built from.' })
  slug: string;

  @ApiProperty({ enum: FleetAudience, description: 'Who may see it.' })
  visibility: FleetAudience;

  @ApiProperty({ enum: FleetScopeStatus }) status: FleetScopeStatus;

  @ApiProperty({
    description:
      'Its Owner’s username, or null when there is none or they have none.',
    nullable: true,
    type: String,
  })
  ownerUsername: string | null;
}

/** A page of Communities found by a site administrator. */
export class AdminCommunityPageDto {
  @ApiProperty({ type: [AdminCommunitySummaryDto] })
  items: AdminCommunitySummaryDto[];

  @ApiProperty() total: number;

  @ApiProperty() page: number;

  @ApiProperty() pageSize: number;
}
