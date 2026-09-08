import { ApiProperty } from '@nestjs/swagger';

import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
  Validate,
} from 'class-validator';

import {
  CUSTOM_TRACKING_MAX_DECIMAL_PRECISION,
  CUSTOM_TRACKING_MAX_NUMERIC_MAGNITUDE,
  CUSTOM_TRACKING_RATING_MAXIMA,
} from '../../constants/custom-tracking-limits.constants';
import { IsExactDecimalConstraint } from '../../validation/is-exact-decimal.constraint';

/**
 * How a whole-number Field constrains its values.
 */
export class IntegerConfigurationDto {
  @ApiProperty({ description: 'The smallest value accepted.', nullable: true })
  @IsOptional()
  @IsInt()
  @Min(-CUSTOM_TRACKING_MAX_NUMERIC_MAGNITUDE)
  @Max(CUSTOM_TRACKING_MAX_NUMERIC_MAGNITUDE)
  minimum: number | null = null;

  @ApiProperty({ description: 'The largest value accepted.', nullable: true })
  @IsOptional()
  @IsInt()
  @Min(-CUSTOM_TRACKING_MAX_NUMERIC_MAGNITUDE)
  @Max(CUSTOM_TRACKING_MAX_NUMERIC_MAGNITUDE)
  maximum: number | null = null;

  @ApiProperty({
    description: 'The interval values must fall on, counted from the minimum.',
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CUSTOM_TRACKING_MAX_NUMERIC_MAGNITUDE)
  step: number | null = null;
}

/**
 * How a decimal or percentage Field constrains its values.
 *
 * The bounds are strings, like the values they constrain. A bound that has
 * been through a JSON number has already been rounded, and a rounded bound
 * admits figures it was written to exclude.
 */
export class DecimalConfigurationDto {
  @ApiProperty({
    description: 'The smallest value accepted, as an exact decimal.',
    nullable: true,
    example: '0',
  })
  @IsOptional()
  @Validate(IsExactDecimalConstraint)
  minimum: string | null = null;

  @ApiProperty({
    description: 'The largest value accepted, as an exact decimal.',
    nullable: true,
    example: '100',
  })
  @IsOptional()
  @Validate(IsExactDecimalConstraint)
  maximum: string | null = null;

  @ApiProperty({
    description: 'Decimal places kept.',
    minimum: 0,
    maximum: CUSTOM_TRACKING_MAX_DECIMAL_PRECISION,
  })
  @IsInt()
  @Min(0)
  @Max(CUSTOM_TRACKING_MAX_DECIMAL_PRECISION)
  precision: number;

  @ApiProperty({
    description: 'The interval values must fall on, as an exact decimal.',
    nullable: true,
    example: '0.5',
  })
  @IsOptional()
  @Validate(IsExactDecimalConstraint)
  step: string | null = null;
}

/**
 * How a slider Field is bounded.
 *
 * Every bound is required here, unlike the other numeric types. A slider with
 * no ends is not a slider: there would be nothing to draw and nowhere for the
 * handle to sit.
 */
export class RangeConfigurationDto {
  @ApiProperty({ description: 'The value at the left-hand end.' })
  @IsNumber()
  @Min(-CUSTOM_TRACKING_MAX_NUMERIC_MAGNITUDE)
  @Max(CUSTOM_TRACKING_MAX_NUMERIC_MAGNITUDE)
  minimum: number;

  @ApiProperty({ description: 'The value at the right-hand end.' })
  @IsNumber()
  @Min(-CUSTOM_TRACKING_MAX_NUMERIC_MAGNITUDE)
  @Max(CUSTOM_TRACKING_MAX_NUMERIC_MAGNITUDE)
  maximum: number;

  @ApiProperty({ description: 'The interval the handle moves in.' })
  @IsNumber()
  @Min(Number.MIN_VALUE)
  @Max(CUSTOM_TRACKING_MAX_NUMERIC_MAGNITUDE)
  step: number;
}

/**
 * How a rating Field is scaled.
 */
export class RatingConfigurationDto {
  @ApiProperty({
    description: 'The top of the scale.',
    enum: CUSTOM_TRACKING_RATING_MAXIMA,
  })
  @IsIn([...CUSTOM_TRACKING_RATING_MAXIMA])
  maximum: number;
}

/**
 * How a progress Field is bounded and presented.
 *
 * The two presentation switches change only what is drawn. Both figures are
 * stored on every value, so turning the percentage off and on again re-reads
 * what was saved rather than recomputing it against a total that may since
 * have moved.
 */
export class ProgressConfigurationDto {
  @ApiProperty({
    description: 'The smallest current figure accepted.',
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(-CUSTOM_TRACKING_MAX_NUMERIC_MAGNITUDE)
  @Max(CUSTOM_TRACKING_MAX_NUMERIC_MAGNITUDE)
  minimum: number | null = null;

  @ApiProperty({ description: 'The largest total accepted.', nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(-CUSTOM_TRACKING_MAX_NUMERIC_MAGNITUDE)
  @Max(CUSTOM_TRACKING_MAX_NUMERIC_MAGNITUDE)
  maximum: number | null = null;

  @ApiProperty({ description: 'Whether to also show a percentage.' })
  @IsBoolean()
  showPercentage: boolean;

  @ApiProperty({ description: 'Whether to also draw a bar.' })
  @IsBoolean()
  showProgressBar: boolean;
}
