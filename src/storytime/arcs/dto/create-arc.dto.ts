import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { STORYTIME_IMAGE_ALT_MAX_LENGTH } from '../../constants/storytime-image.constants';
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

  @ApiPropertyOptional({
    description: 'Cloudflare Images ID for the banner.',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  readonly bannerImageId?: string;

  // Required only when there is an image to describe, matching Stories: an
  // image without alternative text is unusable to a screen reader.
  @ApiPropertyOptional({
    description: 'Alternative text for the banner.',
    maxLength: STORYTIME_IMAGE_ALT_MAX_LENGTH,
  })
  @ValidateIf(dto => Boolean(dto.bannerImageId))
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'bannerImageAlt is required when a banner is set' })
  @MaxLength(STORYTIME_IMAGE_ALT_MAX_LENGTH)
  readonly bannerImageAlt?: string;

  @ApiPropertyOptional({
    description: 'Cloudflare Images ID for the profile image.',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  readonly profileImageId?: string;

  @ApiPropertyOptional({
    description: 'Alternative text for the profile image.',
    maxLength: STORYTIME_IMAGE_ALT_MAX_LENGTH,
  })
  @ValidateIf(dto => Boolean(dto.profileImageId))
  @Transform(trim)
  @IsString()
  @IsNotEmpty({
    message: 'profileImageAlt is required when a profile image is set',
  })
  @MaxLength(STORYTIME_IMAGE_ALT_MAX_LENGTH)
  readonly profileImageAlt?: string;
}
