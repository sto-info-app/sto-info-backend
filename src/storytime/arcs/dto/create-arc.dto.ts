import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { STORYTIME_LANGUAGE_CODES } from '../../constants/storytime-language.constants';
import { StorytimeVisibility } from '../../enums/storytime-visibility.enum';

/** Trims a string value, leaving anything else for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Creates an Arc.
 *
 * Status is not accepted: an Arc always starts as a draft, and publishing is a
 * separate action that first checks something has agreed to be in it.
 */
export class CreateArcDto {
  @ApiProperty({ description: 'Arc title.', maxLength: 200 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  readonly title: string;

  @ApiPropertyOptional({
    description: 'Preferred URL slug. Generated from the title when omitted.',
    maxLength: 220,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(220)
  readonly slug?: string;

  @ApiPropertyOptional({
    description: 'Short summary shown on a card.',
    maxLength: 500,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  readonly shortDescription?: string;

  @ApiPropertyOptional({ description: 'The description, as Markdown.' })
  @IsOptional()
  @IsString()
  readonly description?: string;

  @ApiPropertyOptional({
    enum: StorytimeVisibility,
    description: 'Who may reach it once published.',
  })
  @IsOptional()
  @IsEnum(StorytimeVisibility)
  readonly visibility?: StorytimeVisibility;

  @ApiPropertyOptional({
    description: 'BCP 47 language the Arc is described in.',
    enum: STORYTIME_LANGUAGE_CODES,
  })
  @IsOptional()
  @IsIn(STORYTIME_LANGUAGE_CODES, {
    message: 'languageCode must be one of the offered Storytime languages',
  })
  readonly languageCode?: string;
}
