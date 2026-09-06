import { ApiProperty } from '@nestjs/swagger';

import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  CUSTOM_TRACKING_LIMITS,
  CUSTOM_TRACKING_MAX_PATTERN_LENGTH,
} from '../../constants/custom-tracking-limits.constants';

/**
 * How a single-line text Field constrains what may be typed into it.
 */
export class TextConfigurationDto {
  @ApiProperty({
    description: 'The fewest characters accepted.',
    nullable: true,
    minimum: 0,
    maximum: CUSTOM_TRACKING_LIMITS.MAX_TEXT_VALUE_LENGTH,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(CUSTOM_TRACKING_LIMITS.MAX_TEXT_VALUE_LENGTH)
  minLength: number | null = null;

  @ApiProperty({
    description: 'The most characters accepted.',
    nullable: true,
    minimum: 1,
    maximum: CUSTOM_TRACKING_LIMITS.MAX_TEXT_VALUE_LENGTH,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CUSTOM_TRACKING_LIMITS.MAX_TEXT_VALUE_LENGTH)
  maxLength: number | null = null;

  @ApiProperty({
    description:
      'A pattern the value must match, as a regular expression source.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOM_TRACKING_MAX_PATTERN_LENGTH)
  pattern: string | null = null;

  @ApiProperty({
    description: 'Grey text shown in the empty editor.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOM_TRACKING_LIMITS.MAX_PLACEHOLDER_LENGTH)
  placeholder: string | null = null;
}

/**
 * How a Markdown Field constrains what may be written into it.
 */
export class MarkdownConfigurationDto {
  @ApiProperty({
    description: 'The most characters of source accepted.',
    nullable: true,
    minimum: 1,
    maximum: CUSTOM_TRACKING_LIMITS.MAX_MARKDOWN_VALUE_LENGTH,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CUSTOM_TRACKING_LIMITS.MAX_MARKDOWN_VALUE_LENGTH)
  maxLength: number | null = null;

  @ApiProperty({
    description: 'Grey text shown in the empty editor.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOM_TRACKING_LIMITS.MAX_PLACEHOLDER_LENGTH)
  placeholder: string | null = null;
}

/**
 * A Field type with nothing to configure.
 *
 * A real class rather than an absence, so the validator can hold every type to
 * the same treatment: an unknown property is rejected here exactly as it is
 * anywhere else, which is what stops configuration being smuggled onto a type
 * that has none.
 */
export class EmptyConfigurationDto {}
