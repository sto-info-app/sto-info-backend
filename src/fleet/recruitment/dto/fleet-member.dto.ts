import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsString, MaxLength, MinLength } from 'class-validator';

import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import { FleetApplicationRoute } from '../enums/fleet-application-route.enum';

/** A Fleet member, as the Recruitment tab lists them. */
export class FleetMemberDto {
  @ApiProperty({ description: 'The membership.' })
  membershipId: string;

  @ApiPropertyOptional({
    description: 'Their STO Info username, or null when they have none.',
    nullable: true,
  })
  username: string | null;

  @ApiProperty({
    enum: [ScopeMembershipStatus.APPROVED, ScopeMembershipStatus.SUSPENDED],
  })
  status: ScopeMembershipStatus;

  @ApiPropertyOptional({
    description: 'When they became a member.',
    nullable: true,
  })
  memberSince: Date | null;

  @ApiPropertyOptional({
    enum: FleetApplicationRoute,
    description: 'How they came in, where recruitment recorded it.',
    nullable: true,
  })
  route: FleetApplicationRoute | null;

  @ApiPropertyOptional({
    description: 'The Character they came in with, as Name@handle.',
    nullable: true,
  })
  characterName: string | null;
}

/** Why a member is being removed. */
export class RemoveFleetMemberDto {
  @ApiProperty({ description: 'Why, for the Fleet’s record. Required.' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  readonly reason: string;
}
