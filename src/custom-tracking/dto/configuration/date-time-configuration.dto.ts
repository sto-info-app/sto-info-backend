import { ApiProperty } from '@nestjs/swagger';

import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
  Validate,
} from 'class-validator';

import {
  CUSTOM_TRACKING_MAX_YEAR,
  CUSTOM_TRACKING_MIN_YEAR,
} from '../../constants/custom-tracking-limits.constants';
import { CustomTrackingDateFormat } from '../../enums/custom-tracking-date-format.enum';
import { CustomTrackingDurationFormat } from '../../enums/custom-tracking-duration-format.enum';
import { CustomTrackingMonthYearFormat } from '../../enums/custom-tracking-month-year-format.enum';
import { CustomTrackingTimeFormat } from '../../enums/custom-tracking-time-format.enum';
import { IsCalendarDateConstraint } from '../../validation/is-calendar-date.constraint';
import { IsIanaTimezoneConstraint } from '../../validation/is-iana-timezone.constraint';

/**
 * How a date Field is bounded and written out.
 *
 * Also used for a date range, whose two endpoints are held to the same bounds
 * and written in the same format. Giving a range its own class would state the
 * identical three properties twice and invite them to drift.
 */
export class DateConfigurationDto {
  @ApiProperty({
    description: 'The earliest date accepted.',
    nullable: true,
    example: '2010-02-02',
  })
  @IsOptional()
  @Validate(IsCalendarDateConstraint)
  minimumDate: string | null = null;

  @ApiProperty({
    description: 'The latest date accepted.',
    nullable: true,
    example: '2030-12-31',
  })
  @IsOptional()
  @Validate(IsCalendarDateConstraint)
  maximumDate: string | null = null;

  @ApiProperty({
    description: 'How the date is written out.',
    enum: CustomTrackingDateFormat,
  })
  @IsEnum(CustomTrackingDateFormat)
  dateFormat: CustomTrackingDateFormat;
}

/**
 * How a time Field is presented, and where its editor starts from.
 */
export class TimeConfigurationDto {
  @ApiProperty({
    description: 'The IANA timezone the editor offers first.',
    example: 'Europe/London',
  })
  @Validate(IsIanaTimezoneConstraint)
  defaultTimezone: string;

  @ApiProperty({
    description: 'How the time is written out.',
    enum: CustomTrackingTimeFormat,
  })
  @IsEnum(CustomTrackingTimeFormat)
  timeFormat: CustomTrackingTimeFormat;
}

/**
 * How a date-and-time Field is presented, and where its editor starts from.
 *
 * Also used for a date-and-time range, for the same reason a date range reuses
 * the date configuration.
 */
export class DateTimeConfigurationDto {
  @ApiProperty({
    description: 'The IANA timezone the editor offers first.',
    example: 'Europe/London',
  })
  @Validate(IsIanaTimezoneConstraint)
  defaultTimezone: string;

  @ApiProperty({
    description: 'How the date part is written out.',
    enum: CustomTrackingDateFormat,
  })
  @IsEnum(CustomTrackingDateFormat)
  dateFormat: CustomTrackingDateFormat;

  @ApiProperty({
    description: 'How the time part is written out.',
    enum: CustomTrackingTimeFormat,
  })
  @IsEnum(CustomTrackingTimeFormat)
  timeFormat: CustomTrackingTimeFormat;
}

/**
 * How a month-and-year Field is written out.
 */
export class MonthYearConfigurationDto {
  @ApiProperty({
    description: 'How the month and year are written out.',
    enum: CustomTrackingMonthYearFormat,
  })
  @IsEnum(CustomTrackingMonthYearFormat)
  monthYearFormat: CustomTrackingMonthYearFormat;
}

/**
 * How a year Field is bounded.
 */
export class YearConfigurationDto {
  @ApiProperty({ description: 'The earliest year accepted.', nullable: true })
  @IsOptional()
  @IsInt()
  @Min(CUSTOM_TRACKING_MIN_YEAR)
  @Max(CUSTOM_TRACKING_MAX_YEAR)
  minimumYear: number | null = null;

  @ApiProperty({ description: 'The latest year accepted.', nullable: true })
  @IsOptional()
  @IsInt()
  @Min(CUSTOM_TRACKING_MIN_YEAR)
  @Max(CUSTOM_TRACKING_MAX_YEAR)
  maximumYear: number | null = null;
}

/**
 * How a duration Field is entered and written out.
 *
 * The four switches decide which boxes the editor offers. A duration measured
 * in days and hours should not ask for seconds; one measured in minutes should
 * not ask for days. At least one has to be on, which the configuration
 * validator checks, since no arrangement of decorators can say it.
 */
export class DurationConfigurationDto {
  @ApiProperty({
    description: 'How the duration is written out.',
    enum: CustomTrackingDurationFormat,
  })
  @IsEnum(CustomTrackingDurationFormat)
  durationFormat: CustomTrackingDurationFormat;

  @ApiProperty({ description: 'Whether days are entered.' })
  @IsBoolean()
  includeDays: boolean;

  @ApiProperty({ description: 'Whether hours are entered.' })
  @IsBoolean()
  includeHours: boolean;

  @ApiProperty({ description: 'Whether minutes are entered.' })
  @IsBoolean()
  includeMinutes: boolean;

  @ApiProperty({ description: 'Whether seconds are entered.' })
  @IsBoolean()
  includeSeconds: boolean;
}
