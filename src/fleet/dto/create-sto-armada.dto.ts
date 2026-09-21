import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Validate,
} from 'class-validator';

import { IsExactGameNameConstraint } from '../utilities/is-exact-game-name.constraint';

/** Trims a string value, leaving anything else for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Registers an Armada under a Community.
 *
 * Almost a Fleet, with two differences the schema forces.
 *
 * **There is no audience and no recruitment state.** `sto_armada` has neither
 * column: an Armada is seen exactly as far as the Community holding it is,
 * and Fleets ask to join an Armada through their own Community rather than
 * through a recruitment posture on the Armada itself.
 *
 * **There is a display name.** What the Community prefers to call the Armada,
 * kept in its own column so a friendly label can never drift into the field
 * that has to match what the game shows. Unlike the exact name it is trimmed,
 * because nothing compares it to anything.
 *
 * The Fleets in the Armada are not accepted here. A placement is a temporal
 * record with a position and an interval — `armada_fleet_membership` — and
 * building one belongs to FC-024, which has topology rules this request has
 * no way to state.
 */
export class CreateStoArmadaDto {
  @ApiProperty({
    description:
      'The Armada name exactly as it appears in game, including any ' +
      'leading or trailing space, which is stored rather than trimmed.',
  })
  @Validate(IsExactGameNameConstraint)
  readonly exactGameName: string;

  @ApiProperty({ description: 'The platform the Armada exists on.' })
  @IsUUID()
  readonly platformId: string;

  @ApiPropertyOptional({
    description:
      'What the Community prefers to call it, when that differs from the ' +
      'name in game.',
    maxLength: 255,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  readonly displayName?: string;

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
}
