import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { STORYTIME_IMAGE_ALT_MAX_LENGTH } from '../../constants/storytime-image.constants';
import { STORYTIME_LIMITS } from '../../constants/storytime-limits.constants';

/** Trims a string value, leaving anything else for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Trims each entry of a string array, leaving anything else alone. */
const trimEach = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map(entry => (typeof entry === 'string' ? entry.trim() : entry))
    : value;

/** How many traits one Character may carry. */
export const MAX_CHARACTER_TRAITS = 20;

/** Longest a single trait may be. */
export const MAX_CHARACTER_TRAIT_LENGTH = 60;

/**
 * Creates a Character.
 *
 * Every field but the name is optional. A creator sketching a cast should be
 * able to write down eight names and fill in the detail later, rather than
 * being made to complete a form before the first one exists.
 */
export class CreateStorytimeCharacterDto {
  @ApiProperty({
    description: 'The name readers know them by.',
    maxLength: 200,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  readonly name: string;

  @ApiPropertyOptional({
    description:
      'Preferred URL slug, unique within the Story. Generated from the name when omitted.',
    maxLength: 220,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(220)
  readonly slug?: string;

  @ApiPropertyOptional({
    description: 'One-line description shown on a cast card.',
    maxLength: 500,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  readonly shortBio?: string;

  @ApiPropertyOptional({
    description: 'The full biography, authored as Markdown.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(STORYTIME_LIMITS.MAX_CONTENT_LENGTH.defaultValue)
  readonly biographySource?: string;

  @ApiPropertyOptional({
    description: 'Cloudflare Images ID for the portrait, 2:3.',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  readonly portraitImageId?: string;

  // Required only when there is an image to describe. A portrait without
  // alternative text is unusable to a screen reader, and the moment it is
  // chosen is the only point the author knows what it shows.
  @ApiPropertyOptional({
    description:
      'Alternative text for the portrait. Required whenever a portrait is set.',
    maxLength: STORYTIME_IMAGE_ALT_MAX_LENGTH,
  })
  @ValidateIf(dto => Boolean(dto.portraitImageId))
  @Transform(trim)
  @IsString()
  @IsNotEmpty({
    message: 'portraitImageAlt is required when a portrait is set',
  })
  @MaxLength(STORYTIME_IMAGE_ALT_MAX_LENGTH)
  readonly portraitImageAlt?: string;

  @ApiPropertyOptional({ description: 'Species.', maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  readonly species?: string;

  @ApiPropertyOptional({ description: 'Faction.', maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  readonly faction?: string;

  @ApiPropertyOptional({ description: 'Rank.', maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  readonly rank?: string;

  @ApiPropertyOptional({ description: 'Occupation or role.', maxLength: 150 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(150)
  readonly occupation?: string;

  @ApiPropertyOptional({
    description: 'Affiliation or allegiance.',
    maxLength: 200,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  readonly affiliation?: string;

  @ApiPropertyOptional({ description: 'Ship or posting.', maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  readonly shipAssignment?: string;

  @ApiPropertyOptional({
    description: 'Short descriptive traits.',
    type: [String],
    maxItems: MAX_CHARACTER_TRAITS,
  })
  @IsOptional()
  @Transform(trimEach)
  @IsArray()
  @ArrayMaxSize(MAX_CHARACTER_TRAITS)
  @IsString({ each: true })
  @MaxLength(MAX_CHARACTER_TRAIT_LENGTH, { each: true })
  readonly traits?: string[];

  @ApiPropertyOptional({
    description: 'Whether this is one of the Story’s main Characters.',
  })
  @IsOptional()
  @IsBoolean()
  readonly isPrimary?: boolean;
}
