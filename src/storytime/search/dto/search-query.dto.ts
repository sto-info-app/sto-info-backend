import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { StorytimeTargetType } from '../../enums/storytime-target-type.enum';

/** The kinds of content search can look in. */
export const SEARCHABLE_TARGET_TYPES = [
  StorytimeTargetType.STORY,
  StorytimeTargetType.CHAPTER,
  StorytimeTargetType.CHARACTER,
  StorytimeTargetType.ARC,
] as const;

/**
 * Splits a comma-separated list into the kinds to search.
 *
 * Accepts a repeated parameter or one comma-separated value, because both are
 * what a client naturally sends and refusing either would be pedantry.
 *
 * @param value - The raw query value.
 * @returns The kinds named, as an array.
 */
const toTypes = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(entry => entry.trim().toUpperCase())
      .filter(entry => entry.length > 0);
  }

  return value;
};

/**
 * What a reader is searching for.
 */
export class SearchQueryDto {
  @ApiProperty({
    description: 'What the reader typed.',
    minLength: 2,
    maxLength: 100,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  readonly q: string;

  @ApiPropertyOptional({
    enum: SEARCHABLE_TARGET_TYPES,
    isArray: true,
    description: 'Limit the search to these kinds. All of them when omitted.',
  })
  @IsOptional()
  @Transform(toTypes)
  @IsArray()
  @ArrayUnique()
  @IsEnum(SEARCHABLE_TARGET_TYPES, { each: true })
  readonly types?: StorytimeTargetType[];

  @ApiPropertyOptional({ description: 'The page to return.', minimum: 1 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(1)
  readonly page?: number;

  @ApiPropertyOptional({
    description: 'How many results per page.',
    minimum: 1,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(1)
  readonly pageSize?: number;
}

/**
 * One search result, whatever kind of content it is.
 */
export class SearchHitDto {
  @ApiProperty({
    enum: StorytimeTargetType,
    description: 'What kind of content matched.',
  })
  targetType: StorytimeTargetType;

  @ApiProperty({ description: 'The content.' })
  id: string;

  @ApiProperty({ description: 'Its own address.' })
  slug: string;

  @ApiProperty({ description: 'What it is called.' })
  title: string;

  @ApiProperty({ description: 'A line to show beneath it.', nullable: true })
  summary: string | null;

  @ApiProperty({
    description: 'The Story it belongs to, for a Chapter or a Character.',
    nullable: true,
  })
  storySlug: string | null;
}

/**
 * A page of search results.
 */
export class SearchResultsDto {
  @ApiProperty({ type: [SearchHitDto], description: 'The results.' })
  items: SearchHitDto[];

  @ApiProperty({ description: 'How many results matched in total.' })
  total: number;

  @ApiProperty({ description: 'The page returned.' })
  page: number;

  @ApiProperty({ description: 'How many results are on a page.' })
  pageSize: number;

  @ApiProperty({
    description: 'How many of each kind matched.',
    example: { STORY: 3, CHAPTER: 12 },
  })
  countsByType: Record<string, number>;
}
