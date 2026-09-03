import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

import { StorytimeTargetType } from '../../enums/storytime-target-type.enum';

/** What may go on a reading list. */
export const LISTABLE_TARGET_TYPES = [
  StorytimeTargetType.STORY,
  StorytimeTargetType.ARC,
];

/**
 * What a caller sends to make a reading list.
 */
export class CreateReadingListDto {
  @ApiProperty({ description: 'What the list is called.', maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({
    description: 'What the list is for.',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Whether anybody may read it. Private unless said otherwise.',
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

/**
 * What a caller sends to change a reading list.
 */
export class UpdateReadingListDto {
  @ApiPropertyOptional({
    description: 'What the list is called.',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    description: 'What the list is for.',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ description: 'Whether anybody may read it.' })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

/**
 * What a caller sends to put something on a list.
 */
export class AddReadingListItemDto {
  @ApiProperty({
    enum: LISTABLE_TARGET_TYPES,
    description: 'Whether it is a Story or an Arc.',
  })
  @IsIn(LISTABLE_TARGET_TYPES)
  targetType: StorytimeTargetType;

  @ApiProperty({ description: 'The thing.' })
  @IsUUID()
  targetId: string;

  @ApiPropertyOptional({
    description: 'Why it is on the list.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/**
 * What a caller sends to put a list in order.
 */
export class ReorderReadingListDto {
  @ApiProperty({
    description: 'Every item on the list, in the order wanted.',
    type: [String],
  })
  @IsArray()
  @IsUUID(undefined, { each: true })
  itemIds: string[];
}

/**
 * One thing on a list, as a reader sees it.
 */
export class ReadingListItemDto {
  @ApiProperty({ description: 'Unique identifier of the item.' })
  id: string;

  @ApiProperty({
    enum: LISTABLE_TARGET_TYPES,
    description: 'Whether it is a Story or an Arc.',
  })
  targetType: StorytimeTargetType;

  @ApiProperty({ description: 'The thing.' })
  targetId: string;

  @ApiProperty({ description: 'What it is called.' })
  title: string;

  @ApiProperty({ description: 'Its address.' })
  slug: string;

  @ApiProperty({ description: 'Its summary, when it has one.', nullable: true })
  shortDescription: string | null;

  @ApiProperty({ description: 'Why it is on the list.', nullable: true })
  note: string | null;

  @ApiProperty({ description: 'Where it comes in the order.' })
  orderIndex: number;
}

/**
 * A reading list, without what is on it.
 */
export class ReadingListDto {
  @ApiProperty({ description: 'Unique identifier of the list.' })
  id: string;

  @ApiProperty({ description: 'Who keeps it.' })
  ownerUserId: string;

  @ApiProperty({ description: 'What it is called.' })
  name: string;

  @ApiProperty({ description: 'Its address, within its owner.' })
  slug: string;

  @ApiProperty({ description: 'What it is for.', nullable: true })
  description: string | null;

  @ApiProperty({ description: 'Whether anybody may read it.' })
  isPublic: boolean;

  @ApiProperty({ description: 'How many things are on it.' })
  itemCount: number;

  @ApiProperty({ description: 'When it last changed.' })
  updatedAt: Date;
}

/**
 * A reading list and what is on it.
 */
export class ReadingListDetailDto extends ReadingListDto {
  @ApiProperty({
    type: [ReadingListItemDto],
    description: 'What is on it, in order.',
  })
  items: ReadingListItemDto[];
}
