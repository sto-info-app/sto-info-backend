import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

import { IsIanaTimezoneConstraint } from 'src/shared/utilities/is-iana-timezone.constraint';

import { ROSTER_CSV_LIMITS } from '../constants/roster-csv.constants';

/** The longest reason a correction may give. */
export const ROSTER_IMPORT_REASON_MAX_LENGTH = 500;

/**
 * Trims a reason, and turns one that is only whitespace into nothing.
 *
 * @param params - The value being transformed.
 * @param params.value - The value.
 * @returns The trimmed text, or undefined when nothing was left.
 */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || undefined : value;

/**
 * A reason: text, not blank once trimmed, and not too long.
 *
 * One check rather than three, so each way a reason can be wrong is told
 * one thing: a missing reason is not also told it is too long and not text.
 */
@ValidatorConstraint({ name: 'isRosterImportReason' })
export class IsRosterImportReason implements ValidatorConstraintInterface {
  /**
   * Whether a value is a reason.
   *
   * @param value - The value, already trimmed.
   * @returns True if it is.
   */
  validate(value: unknown): boolean {
    return (
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= ROSTER_IMPORT_REASON_MAX_LENGTH
    );
  }

  /**
   * What is wrong with a value that is not a reason.
   *
   * @param args - The value that failed.
   * @returns The message.
   */
  defaultMessage(args: ValidationArguments): string {
    if (args.value === undefined || args.value === null) {
      return 'Say why the import is being corrected.';
    }

    return typeof args.value === 'string'
      ? `A reason can be at most ${ROSTER_IMPORT_REASON_MAX_LENGTH} characters.`
      : 'A reason has to be text.';
  }
}

/**
 * Why an investigator is correcting an import (FC-019).
 *
 * Required of every correction — Steve's decision of 25 September 2026 —
 * because a history somebody changed with no word of why is not one anybody
 * else can trust. Kept, with who gave it and when, in the import's action
 * log.
 */
export class RosterImportReasonDto {
  @ApiProperty({
    description: 'Why, in the investigator’s own words.',
    maxLength: ROSTER_IMPORT_REASON_MAX_LENGTH,
  })
  @Transform(trim)
  @Validate(IsRosterImportReason)
  readonly reason: string;
}

/** Says whether an export may not list everybody, and why. */
export class MarkRosterImportPartialDto extends RosterImportReasonDto {
  @ApiProperty({
    description:
      'True to say the export may not list everybody, so nobody missing ' +
      'from it is taken to have left; false to say it is complete after all.',
  })
  @IsBoolean()
  readonly partial: boolean;
}

/** Excludes some of an import's rows, or puts them back, and why. */
export class ExcludeRosterRowsDto extends RosterImportReasonDto {
  @ApiProperty({
    description:
      'The rows, by their line in the sanitised file, the header being ' +
      'line one — the lines an import’s problems and preview already name.',
    type: [Number],
    minItems: 1,
    maxItems: ROSTER_CSV_LIMITS.maxRows,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ROSTER_CSV_LIMITS.maxRows)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(2, { each: true })
  readonly lines: number[];

  @ApiProperty({
    description:
      'True to exclude them, so each member they name is unknown in this ' +
      'export; false to put them back.',
  })
  @IsBoolean()
  readonly excluded: boolean;
}

/** Re-reads an export through the zone it was really taken in, and why. */
export class CorrectRosterImportTimezoneDto extends RosterImportReasonDto {
  @ApiProperty({
    description:
      'The IANA timezone the exporting player’s clock was really set to. ' +
      'The export’s stamp and every date in its rows are read again through ' +
      'it, from the local text kept for exactly this.',
    example: 'America/New_York',
  })
  @IsString()
  @Validate(IsIanaTimezoneConstraint)
  readonly timezone: string;

  @ApiPropertyOptional({
    description:
      'Which moment the stamp names, for the one morning a year it names ' +
      'two in that zone. Required then, and refused unless it is one of ' +
      'the two, exactly as at upload.',
    example: '2024-11-03T05:30:00.000Z',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  readonly exportedAt?: string;
}
