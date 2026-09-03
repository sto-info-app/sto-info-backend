import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

import { StorytimeTagCategory } from '../../enums/storytime-tag-category.enum';

/** The most tags one piece of content may carry. */
export const MAX_TAGS_PER_TARGET = 20;

/** Trims a string value, leaving anything else for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Adds a tag to the vocabulary.
 */
export class CreateTagDto {
  @ApiProperty({ description: 'What the tag is called.', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  readonly name: string;

  @ApiProperty({
    enum: StorytimeTagCategory,
    description: 'Which shelf it belongs on.',
  })
  @IsEnum(StorytimeTagCategory)
  readonly category: StorytimeTagCategory;

  @ApiPropertyOptional({
    description: 'Preferred slug. Built from the name when omitted.',
    maxLength: 120,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  readonly slug?: string;

  @ApiPropertyOptional({ description: 'What it means.', maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  readonly description?: string;

  @ApiPropertyOptional({ description: 'Where it sits in its category.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  readonly displayOrder?: number;
}

/**
 * Changes a tag.
 */
export class UpdateTagDto {
  @ApiPropertyOptional({
    description: 'What the tag is called.',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  readonly name?: string;

  @ApiPropertyOptional({
    enum: StorytimeTagCategory,
    description: 'Which shelf it belongs on.',
  })
  @IsOptional()
  @IsEnum(StorytimeTagCategory)
  readonly category?: StorytimeTagCategory;

  @ApiPropertyOptional({ description: 'Preferred slug.', maxLength: 120 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  readonly slug?: string;

  @ApiPropertyOptional({ description: 'What it means.', maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  readonly description?: string | null;

  @ApiPropertyOptional({ description: 'Where it sits in its category.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  readonly displayOrder?: number;
}

/**
 * Sets the tags on a piece of content, replacing whatever it had.
 *
 * A replacement rather than a series of adds and removes: a creator edits the
 * set they want and sends it, which cannot half-apply.
 */
export class SetTagsDto {
  @ApiProperty({
    description: 'The tags the content should carry.',
    type: [String],
    maxItems: MAX_TAGS_PER_TARGET,
  })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(MAX_TAGS_PER_TARGET)
  @IsUUID('4', { each: true })
  readonly tagIds: string[];
}

/**
 * A tag as anybody sees it.
 */
export class TagDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ description: 'URL-friendly identifier.' })
  slug: string;

  @ApiProperty({ description: 'What the tag is called.' })
  name: string;

  @ApiProperty({ description: 'What it means.', nullable: true })
  description: string | null;

  @ApiProperty({
    enum: StorytimeTagCategory,
    description: 'Which shelf it belongs on.',
  })
  category: StorytimeTagCategory;

  @ApiProperty({ description: 'Where it sits in its category.' })
  displayOrder: number;
}
