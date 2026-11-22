import { ApiProperty } from '@nestjs/swagger';

import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsNotEmpty,
  IsString,
  MaxLength,
  Validate,
} from 'class-validator';

import { IsExactGameNameConstraint } from '../../utilities/is-exact-game-name.constraint';

/** The longest reason a former name's record or removal may give. */
export const FLEET_FORMER_NAME_REASON_MAX_LENGTH = 500;

/**
 * Trims a reason, and treats one that was only whitespace as not given.
 *
 * @param params - What class-transformer hands a transform.
 * @param params.value - The value as sent.
 * @returns The trimmed reason, or undefined for a blank one.
 */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || undefined : value;

/**
 * A former name to record for a Fleet (FC-050).
 *
 * **The name is not trimmed**, for the reason the Fleet's own name is not
 * (ADR-0003): it is compared with export filenames character for character.
 * The interval is when the Fleet used it, and an export matches it only when
 * taken inside that interval, so an old name cannot claim exports from after
 * the rename.
 */
export class RecordFleetFormerNameDto {
  @ApiProperty({
    description:
      'The former name exactly as it appeared in game, edge spaces included.',
  })
  @Validate(IsExactGameNameConstraint)
  readonly exactName: string;

  @ApiProperty({ description: 'When the Fleet began using it.' })
  @Type(() => Date)
  @IsDate()
  readonly validFrom: Date;

  @ApiProperty({ description: 'When it stopped, which must be later.' })
  @Type(() => Date)
  @IsDate()
  readonly validTo: Date;

  @ApiProperty({
    description: 'Why it is being recorded.',
    maxLength: FLEET_FORMER_NAME_REASON_MAX_LENGTH,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Say why this name is being recorded.' })
  @MaxLength(FLEET_FORMER_NAME_REASON_MAX_LENGTH)
  readonly reason: string;
}

/** Why a recorded former name is being removed (FC-050). */
export class RemoveFleetFormerNameDto {
  @ApiProperty({
    description: 'Why it is being removed.',
    maxLength: FLEET_FORMER_NAME_REASON_MAX_LENGTH,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Say why this name is being removed.' })
  @MaxLength(FLEET_FORMER_NAME_REASON_MAX_LENGTH)
  readonly reason: string;
}

/** A former name of a Fleet, recorded or removed. */
export class FleetFormerNameDto {
  @ApiProperty() id: string;

  @ApiProperty({ description: 'Exactly as it appeared in game.' })
  exactName: string;

  @ApiProperty() validFrom: Date;

  @ApiProperty({
    description:
      'When it stopped. Every name recorded through this API has an end; ' +
      'null only for one written before it existed.',
    nullable: true,
    type: Date,
  })
  validTo: Date | null;

  @ApiProperty({ description: 'Why it was recorded.' }) reason: string;

  @ApiProperty({
    description:
      'Who recorded it, by username, or null once that account is gone.',
    nullable: true,
    type: String,
  })
  recordedByName: string | null;

  @ApiProperty() recordedAt: Date;

  @ApiProperty({ nullable: true, type: Date }) removedAt: Date | null;

  @ApiProperty({
    description: 'Who removed it, by username, or null.',
    nullable: true,
    type: String,
  })
  removedByName: string | null;

  @ApiProperty({ nullable: true, type: String }) removalReason: string | null;

  @ApiProperty({
    description:
      'How many of the Fleet’s imports matched their filename to it. They ' +
      'keep that match after a removal.',
  })
  matchedImports: number;
}

/** A Fleet's former names, and whether the reader may change them. */
export class FleetFormerNamesDto {
  @ApiProperty({
    description: 'Names in use for matching, the most recent first.',
    type: [FleetFormerNameDto],
  })
  items: FleetFormerNameDto[];

  @ApiProperty({
    description: 'Names removed, the most recently removed first.',
    type: [FleetFormerNameDto],
  })
  removed: FleetFormerNameDto[];

  @ApiProperty({
    description:
      'Whether the reader may record and remove them: roster.investigate, ' +
      'rather than a site admin’s read-only look.',
  })
  mayChange: boolean;
}
