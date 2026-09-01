import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { STORYTIME_LANGUAGE_CODES } from '../../constants/storytime-language.constants';
import { STORYTIME_LIMITS } from '../../constants/storytime-limits.constants';

/** Trims a string value, leaving anything else for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Creates a Chapter.
 *
 * A Chapter always starts as a draft. Status is not accepted here: publishing
 * and scheduling are separate, checked actions.
 */
export class CreateChapterDto {
  @ApiProperty({ description: 'Chapter title.', maxLength: 200 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  readonly title: string;

  @ApiPropertyOptional({
    description:
      'Preferred URL slug, unique within the Story. Generated from the title when omitted.',
    maxLength: 220,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(220)
  readonly slug?: string;

  @ApiPropertyOptional({
    description: 'Short summary shown in the Chapter list.',
    maxLength: 1000,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  readonly synopsis?: string;

  @ApiPropertyOptional({
    description: 'The Chapter body, authored as Markdown.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(STORYTIME_LIMITS.MAX_CONTENT_LENGTH.defaultValue)
  readonly contentSource?: string;

  @ApiPropertyOptional({
    description:
      'BCP 47 language, when this Chapter departs from the Story language. Omit to match the Story.',
    enum: STORYTIME_LANGUAGE_CODES,
  })
  @IsOptional()
  @IsIn(STORYTIME_LANGUAGE_CODES, {
    message: 'languageCode must be one of the offered Storytime languages',
  })
  readonly languageCode?: string;
}
