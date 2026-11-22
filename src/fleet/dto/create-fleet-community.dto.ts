import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
} from 'class-validator';

import { IsIanaTimezoneConstraint } from 'src/shared/utilities/is-iana-timezone.constraint';

import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetRecruitmentState } from '../enums/fleet-recruitment-state.enum';

/** Trims a string value, leaving anything else for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Registers a Fleet Community.
 *
 * A Community's name is **not** an exact in-game name, so ADR-0003 does not
 * apply to it and it is trimmed like any other display field. Nothing in the
 * game is called a Fleet Community: it is this site's umbrella, the owner
 * invents the name, and nothing is ever compared against a roster filename.
 * The Fleet and Armada names underneath it are the ones held exactly.
 *
 * Status is not accepted. A Community starts `ACTIVE`, and closing it is a
 * separate action with its own capability, so a registration cannot create
 * something already closed.
 *
 * Neither is the owner. The registrant owns what they register (R02), and
 * accepting an owner here would make it a field a request could lie about.
 */
export class CreateFleetCommunityDto {
  @ApiProperty({ description: 'Display name, as the owner writes it.' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Please give the Community a name' })
  @MaxLength(120)
  readonly name: string;

  @ApiPropertyOptional({
    description:
      'Preferred URL segment. Derived from the name when omitted, and ' +
      'suffixed when something already holds it.',
    maxLength: 80,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  readonly slug?: string;

  @ApiPropertyOptional({
    description: 'What the Community is.',
    maxLength: 2000,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  readonly description?: string;

  @ApiPropertyOptional({
    enum: FleetRecruitmentState,
    description: 'Whether and how the Community accepts new subscribers.',
  })
  @IsOptional()
  @IsEnum(FleetRecruitmentState)
  readonly recruitmentState?: FleetRecruitmentState;

  @ApiPropertyOptional({
    enum: FleetAudience,
    description: 'Who may see the Community record.',
  })
  @IsOptional()
  @IsEnum(FleetAudience)
  readonly visibility?: FleetAudience;

  @ApiPropertyOptional({
    description:
      'Default IANA zone for presenting this Community’s dates. ' +
      'Presentation only — a roster export always carries its own zone.',
    example: 'Europe/London',
  })
  @IsOptional()
  @Transform(trim)
  @Validate(IsIanaTimezoneConstraint)
  readonly preferredTimezone?: string;
}
