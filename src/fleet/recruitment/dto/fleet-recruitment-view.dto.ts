import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import { RecruitmentSettingsDto } from './recruitment-settings.dto';

/** One of the viewer's own applications to this Fleet, still waiting. */
export class RecruitmentPendingApplicationDto {
  @ApiProperty() id: string;

  @ApiProperty({ description: 'The Character, as Name@handle.' })
  characterName: string;

  @ApiProperty() submittedAt: Date;
}

/** The viewer's open invitation to this Fleet. */
export class RecruitmentOpenInvitationDto {
  @ApiProperty() id: string;

  @ApiProperty() expiresAt: Date;
}

/** Where the signed-in viewer stands with this Fleet's recruitment. */
export class RecruitmentViewerDto {
  @ApiProperty({
    description: 'Whether they own the Fleet’s Community.',
  })
  isOwner: boolean;

  @ApiPropertyOptional({
    enum: ScopeMembershipStatus,
    description: 'Their membership of the Fleet, if they have ever had one.',
    nullable: true,
  })
  membershipStatus: ScopeMembershipStatus | null;

  @ApiProperty({ type: [RecruitmentPendingApplicationDto] })
  pendingApplications: RecruitmentPendingApplicationDto[];

  @ApiPropertyOptional({
    type: RecruitmentOpenInvitationDto,
    nullable: true,
  })
  openInvitation: RecruitmentOpenInvitationDto | null;

  @ApiProperty({ description: 'Whether they hold applications.view.' })
  canViewApplications: boolean;

  @ApiProperty({ description: 'Whether they hold applications.decide.' })
  canDecideApplications: boolean;

  @ApiProperty({ description: 'Whether they hold recruitment.manage.' })
  canManageRecruitment: boolean;

  @ApiProperty({ description: 'Whether they hold members.manage.' })
  canManageMembers: boolean;
}

/** How a Fleet recruits, and where the viewer stands. */
export class FleetRecruitmentViewDto {
  @ApiProperty({ type: RecruitmentSettingsDto })
  settings: RecruitmentSettingsDto;

  @ApiPropertyOptional({
    type: RecruitmentViewerDto,
    description: 'Null when signed out.',
    nullable: true,
  })
  viewer: RecruitmentViewerDto | null;
}
