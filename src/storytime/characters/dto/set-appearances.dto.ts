import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { STORYTIME_LIMITS } from '../../constants/storytime-limits.constants';

/** Trims a string value, leaving anything else for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * One Character appearing in a Chapter.
 */
export class AppearanceDto {
  @ApiProperty({ description: 'The Character appearing.' })
  @IsUUID('4')
  readonly characterId: string;

  @ApiPropertyOptional({
    description: 'What they do in this Chapter.',
    maxLength: 500,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  readonly appearanceNotes?: string;

  @ApiPropertyOptional({
    description: 'Whether they are central to this particular Chapter.',
  })
  @IsOptional()
  @IsBoolean()
  readonly isPrimary?: boolean;
}

/**
 * Replaces the whole cast of a Chapter.
 *
 * The full list is sent rather than individual additions and removals, because
 * the editor shows the cast as a set of ticks: what a creator means by saving
 * is "these, and only these". An empty list is a valid answer, and clears it.
 */
export class SetAppearancesDto {
  @ApiProperty({
    description: 'Every Character appearing in the Chapter, in order.',
    type: [AppearanceDto],
  })
  @IsArray()
  @ArrayMaxSize(STORYTIME_LIMITS.MAX_CHARACTERS_PER_STORY.defaultValue)
  @ValidateNested({ each: true })
  @Type(() => AppearanceDto)
  readonly appearances: AppearanceDto[];
}
