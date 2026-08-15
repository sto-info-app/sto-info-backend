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
import { CompletionState } from '../../enums/completion-state.enum';
import { ContentRating } from '../../enums/content-rating.enum';
import { StorytimeVisibility } from '../../enums/storytime-visibility.enum';

/** Trims a string value, leaving anything else untouched for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Creates a Story.
 *
 * A Story always starts as a private draft. Status is therefore not accepted
 * here: publishing is a separate, checked action rather than something that can
 * be set on the way in.
 */
export class CreateStoryDto {
  @ApiProperty({ description: 'Story title.', maxLength: 200 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  readonly title: string;

  @ApiPropertyOptional({
    description:
      'Preferred URL slug. Generated from the title when omitted, and adjusted if it is already taken or was used before.',
    maxLength: 220,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(220)
  readonly slug?: string;

  @ApiPropertyOptional({
    description: 'Short plain-text summary used in listings.',
    maxLength: 500,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  readonly shortDescription?: string;

  @ApiPropertyOptional({
    description: 'Full description, authored as Markdown.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  readonly description?: string;

  @ApiPropertyOptional({
    enum: StorytimeVisibility,
    description: 'Who may reach the Story once published.',
  })
  @IsOptional()
  @IsEnum(StorytimeVisibility)
  readonly visibility?: StorytimeVisibility;

  @ApiPropertyOptional({
    enum: CompletionState,
    description: 'How finished the whole work is.',
  })
  @IsOptional()
  @IsEnum(CompletionState)
  readonly completionState?: CompletionState;

  @ApiPropertyOptional({
    enum: ContentRating,
    description: 'The audience the Story is suitable for.',
  })
  @IsOptional()
  @IsEnum(ContentRating)
  readonly contentRating?: ContentRating;

  @ApiPropertyOptional({
    description: 'BCP 47 language the Story is written in.',
    enum: STORYTIME_LANGUAGE_CODES,
  })
  @IsOptional()
  @IsIn(STORYTIME_LANGUAGE_CODES, {
    message: 'languageCode must be one of the offered Storytime languages',
  })
  readonly languageCode?: string;

  @ApiPropertyOptional({
    description: 'Cloudflare Images ID for the wide banner.',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  readonly bannerImageId?: string;

  // Required only when there is an image to describe. An image without
  // alternative text is unusable to a screen reader, and asking for it at the
  // point the image is chosen is the only moment the author knows what it shows.
  @ApiPropertyOptional({
    description:
      'Alternative text for the banner. Required whenever a banner is set.',
    maxLength: STORYTIME_IMAGE_ALT_MAX_LENGTH,
  })
  @ValidateIf(dto => Boolean(dto.bannerImageId))
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'bannerImageAlt is required when a banner is set' })
  @MaxLength(STORYTIME_IMAGE_ALT_MAX_LENGTH)
  readonly bannerImageAlt?: string;

  @ApiPropertyOptional({
    description: 'Cloudflare Images ID for the square profile image.',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  readonly profileImageId?: string;

  @ApiPropertyOptional({
    description:
      'Alternative text for the profile image. Required whenever one is set.',
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
