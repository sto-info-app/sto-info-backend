import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsString, MaxLength, MinLength } from 'class-validator';

import { CharacterFleetSummaryDto } from '../../dto/character-fleet.dto';

/** Where an invitation stands, as it is read now. */
export enum FleetInvitationState {
  /** Open: sent, unanswered and not yet lapsed. */
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  WITHDRAWN = 'WITHDRAWN',
  /** It lapsed unanswered, whether or not it has been replaced. */
  LAPSED = 'LAPSED',
}

/** An invitation to send. */
export class CreateFleetInvitationDto {
  @ApiProperty({ description: 'The invitee’s STO Info username.' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  readonly username: string;
}

/** An invitation, as the Fleet’s officers see it. */
export class FleetInvitationDto {
  @ApiProperty() id: string;

  @ApiPropertyOptional({ nullable: true })
  invitedUsername: string | null;

  @ApiPropertyOptional({ nullable: true })
  invitedByUsername: string | null;

  @ApiProperty({ enum: FleetInvitationState })
  state: FleetInvitationState;

  @ApiProperty() sentAt: Date;

  @ApiProperty() expiresAt: Date;

  @ApiPropertyOptional({ nullable: true })
  answeredAt: Date | null;
}

/** An open invitation, as its invitee sees it. */
export class MyFleetInvitationDto {
  @ApiProperty() id: string;

  @ApiProperty({ type: CharacterFleetSummaryDto })
  fleet: CharacterFleetSummaryDto;

  @ApiPropertyOptional({ nullable: true })
  invitedByUsername: string | null;

  @ApiProperty() sentAt: Date;

  @ApiProperty() expiresAt: Date;
}
