import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Validate,
} from 'class-validator';

import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetRecruitmentState } from '../enums/fleet-recruitment-state.enum';
import { IsExactGameNameConstraint } from '../utilities/is-exact-game-name.constraint';

/** Trims a string value, leaving anything else for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Registers a Fleet under a Community.
 *
 * **The name is not trimmed, and that is the whole point.** ADR-0003 applies
 * here in a way it does not to a Community: this field has to hold what the
 * game shows, character for character, because FC-016 compares it to a roster
 * export's filename and Steve has seen a leading space used in game precisely
 * so two Fleets can carry almost the same name. Every other field on this
 * request is trimmed like any ordinary display value.
 *
 * The platform is named by identifier rather than by its URL segment. A
 * segment is derived from the catalogue name (ADR-0022), so accepting one on
 * a write path would mean renaming a platform broke registration as well as
 * every existing link. The client already loads the catalogue to draw the
 * picker.
 *
 * Neither the Community nor the status is accepted. The Community is the path
 * segment the guard has already checked, and a Fleet starts `ACTIVE` because
 * closing one is a separate action with its own capability.
 */
export class CreateStoFleetDto {
  @ApiProperty({
    description:
      'The Fleet name exactly as it appears in game, including any leading ' +
      'or trailing space, which is stored and displayed rather than trimmed.',
  })
  @Validate(IsExactGameNameConstraint)
  readonly exactGameName: string;

  @ApiProperty({ description: 'The platform the Fleet exists on.' })
  @IsUUID()
  readonly platformId: string;

  @ApiPropertyOptional({
    description:
      'Allegiance, from the general faction reference data. Left unknown ' +
      'when omitted and never guessed from a roster.',
  })
  @IsOptional()
  @IsUUID()
  readonly allegianceFactionId?: string;

  @ApiPropertyOptional({
    description:
      'Preferred URL segment. Derived from the name when omitted, and ' +
      'suffixed when something in the same Community on the same platform ' +
      'already holds it.',
    maxLength: 80,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  readonly slug?: string;

  @ApiPropertyOptional({
    enum: FleetRecruitmentState,
    description: 'Whether and how the Fleet accepts applications.',
  })
  @IsOptional()
  @IsEnum(FleetRecruitmentState)
  readonly recruitmentState?: FleetRecruitmentState;

  @ApiPropertyOptional({
    enum: FleetAudience,
    description: 'Who may see the Fleet record.',
  })
  @IsOptional()
  @IsEnum(FleetAudience)
  readonly visibility?: FleetAudience;
}
