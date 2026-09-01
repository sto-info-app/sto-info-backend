import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { STORYTIME_IMAGE_ALT_MAX_LENGTH } from '../../constants/storytime-image.constants';
import { SpotlightEntityType } from '../../enums/spotlight-entity-type.enum';

/** Trims a string value, leaving anything else for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Creates a Spotlight entry.
 *
 * The target is validated here as well as by the database check constraint,
 * so an editor who names the wrong pairing gets a sentence explaining it
 * rather than a constraint violation.
 *
 * An entry is created unpublished. Publishing is a separate action, because
 * writing the editorial copy and deciding it is ready to show the site are
 * different decisions and are often made on different days.
 */
export class CreateSpotlightDto {
  @ApiProperty({
    enum: SpotlightEntityType,
    description: 'What kind of work is featured.',
  })
  @IsEnum(SpotlightEntityType)
  readonly entityType: SpotlightEntityType;

  @ApiPropertyOptional({
    description: 'The featured Story. Required when featuring a Story.',
  })
  @ValidateIf(dto => dto.entityType === SpotlightEntityType.STORY)
  @IsUUID()
  readonly storyId?: string;

  @ApiPropertyOptional({
    description: 'The featured Arc. Required when featuring an Arc.',
  })
  @ValidateIf(dto => dto.entityType === SpotlightEntityType.ARC)
  @IsUUID()
  readonly arcId?: string;

  @ApiProperty({ description: 'The editorial headline.', maxLength: 200 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  readonly headline: string;

  @ApiProperty({ description: 'The editorial summary.' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  readonly summary: string;

  @ApiPropertyOptional({
    description:
      'Preferred URL slug. Generated from the headline when omitted.',
    maxLength: 220,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(220)
  readonly slug?: string;

  @ApiPropertyOptional({ description: 'Why this work was chosen.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  readonly selectionReason?: string;

  @ApiPropertyOptional({
    description: 'Higher entries show first while several overlap.',
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  readonly displayPriority?: number;

  @ApiProperty({ description: 'When the entry starts showing.' })
  @IsDateString()
  readonly startsAt: string;

  @ApiPropertyOptional({
    description: 'When it stops showing. Open-ended when omitted.',
  })
  @IsOptional()
  @IsDateString()
  readonly endsAt?: string | null;
}

/**
 * Changes a Spotlight entry.
 *
 * Every field is optional, and the entity type may not be changed: switching a
 * live entry from a Story to an Arc would silently repoint whatever readers
 * are already looking at, and creating a second entry says the same thing
 * without the sleight of hand.
 */
export class UpdateSpotlightDto {
  @ApiPropertyOptional({ description: 'The featured Story.' })
  @IsOptional()
  @IsUUID()
  readonly storyId?: string;

  @ApiPropertyOptional({ description: 'The featured Arc.' })
  @IsOptional()
  @IsUUID()
  readonly arcId?: string;

  @ApiPropertyOptional({
    description: 'The editorial headline.',
    maxLength: 200,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  readonly headline?: string;

  @ApiPropertyOptional({ description: 'The editorial summary.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  readonly summary?: string;

  @ApiPropertyOptional({ description: 'Preferred URL slug.', maxLength: 220 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(220)
  readonly slug?: string;

  @ApiPropertyOptional({ description: 'Why this work was chosen.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  readonly selectionReason?: string | null;

  // The image itself is set through the artwork endpoints rather than named
  // here, so an entry can only ever point at something this site was given.
  // Its description stays editable, because a wording that reads badly is
  // worth correcting without asking somebody to upload the picture again.
  @ApiPropertyOptional({
    description:
      'Alternative text for the artwork. Rejected when there is no artwork to describe.',
    maxLength: STORYTIME_IMAGE_ALT_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Please describe what the artwork shows' })
  @MaxLength(STORYTIME_IMAGE_ALT_MAX_LENGTH)
  readonly overrideImageAlt?: string;

  @ApiPropertyOptional({ description: 'Higher entries show first.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  readonly displayPriority?: number;

  @ApiPropertyOptional({ description: 'When the entry starts showing.' })
  @IsOptional()
  @IsDateString()
  readonly startsAt?: string;

  @ApiPropertyOptional({ description: 'When it stops showing.' })
  @IsOptional()
  @IsDateString()
  readonly endsAt?: string | null;

  @ApiPropertyOptional({
    description: 'Whether the entry may show at all.',
  })
  @IsOptional()
  @IsBoolean()
  readonly isPublished?: boolean;
}
