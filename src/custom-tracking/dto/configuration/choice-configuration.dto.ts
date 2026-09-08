import { ApiProperty } from '@nestjs/swagger';

import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

import { CUSTOM_TRACKING_LIMITS } from '../../constants/custom-tracking-limits.constants';
import { CustomTrackingImageShape } from '../../enums/custom-tracking-image-shape.enum';

/**
 * How many options a multiple-answer Field requires and permits.
 *
 * Shared by tick-box lists, multiple-select menus and tags. The three differ
 * in how they are shown and in nothing else that a bound could describe.
 */
export class MultipleChoiceConfigurationDto {
  @ApiProperty({
    description: 'The fewest options that must be chosen.',
    nullable: true,
    minimum: 0,
    maximum: CUSTOM_TRACKING_LIMITS.MAX_OPTIONS_PER_FIELD,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(CUSTOM_TRACKING_LIMITS.MAX_OPTIONS_PER_FIELD)
  minimumSelections: number | null = null;

  @ApiProperty({
    description: 'The most options that may be chosen.',
    nullable: true,
    minimum: 1,
    maximum: CUSTOM_TRACKING_LIMITS.MAX_OPTIONS_PER_FIELD,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CUSTOM_TRACKING_LIMITS.MAX_OPTIONS_PER_FIELD)
  maximumSelections: number | null = null;
}

/**
 * Which shape an image Field's pictures are cropped to.
 *
 * Part of the Field rather than of each picture, so every Account or Character
 * answering the same Field yields images that line up on the page.
 */
export class ImageConfigurationDto {
  @ApiProperty({
    description:
      'The crop shape, fixed for every picture answering this Field.',
    enum: CustomTrackingImageShape,
  })
  @IsEnum(CustomTrackingImageShape)
  shape: CustomTrackingImageShape;
}
