import { ApiProperty } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

import { GovernancePersonDto } from './scope-governance.dto';

/** A site admin's purpose for looking into a Fleet (FC-036). */
export class FleetInvestigationRequestDto {
  @ApiProperty({
    description: 'Why. Logged with the look. 10 to 500 characters.',
    minLength: 10,
    maxLength: 500,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(10, 500)
  readonly purpose: string;
}

/** A site admin's look into a Fleet, open or ended. */
export class FleetInvestigationDto {
  @ApiProperty() id: string;

  @ApiProperty() communityId: string;

  @ApiProperty({ nullable: true, type: String }) communityName: string | null;

  @ApiProperty({ nullable: true, type: String }) communitySlug: string | null;

  @ApiProperty() fleetId: string;

  @ApiProperty() fleetName: string;

  @ApiProperty() fleetSlug: string;

  @ApiProperty() platformName: string;

  @ApiProperty({ description: 'The platform as the Fleet’s address names it.' })
  platformSegment: string;

  @ApiProperty({ nullable: true, type: GovernancePersonDto })
  admin: GovernancePersonDto | null;

  @ApiProperty() purpose: string;

  @ApiProperty() createdAt: Date;

  @ApiProperty() expiresAt: Date;

  @ApiProperty({ description: 'Whether it is still open.' }) active: boolean;
}

/** A page of the log of looks. */
export class FleetInvestigationPageDto {
  @ApiProperty({ type: [FleetInvestigationDto] })
  items: FleetInvestigationDto[];

  @ApiProperty() total: number;

  @ApiProperty() page: number;

  @ApiProperty() pageSize: number;
}
