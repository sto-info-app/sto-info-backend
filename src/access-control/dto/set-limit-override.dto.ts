import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinDate,
} from 'class-validator';

/**
 * Pattern a limit key must match.
 *
 * Limit keys are configuration variable names, so they are restricted to the
 * shape those take. Without this an administrator could store an arbitrary
 * string that no code ever reads, producing an exemption that silently does
 * nothing.
 */
const LIMIT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{2,79}$/;

/**
 * The largest value an exemption may set.
 *
 * A ceiling exists because these limits guard against resource abuse; an
 * accidental extra digit should not be able to remove the protection entirely.
 */
const MAX_LIMIT_VALUE = 100_000;

/**
 * Replaces a configured numeric limit for a single user.
 *
 * Applying the same key twice updates the existing exemption rather than
 * creating a second one.
 */
export class SetLimitOverrideDto {
  @ApiProperty({
    description: 'The configuration key to override.',
    example: 'STORYTIME_MAX_STORIES_PER_USER',
    maxLength: 80,
  })
  @IsString()
  @Matches(LIMIT_KEY_PATTERN, {
    message:
      'limitKey must be an upper-case configuration key, such as STORYTIME_MAX_STORIES_PER_USER',
  })
  readonly limitKey: string;

  @ApiProperty({
    description: 'The value that applies to this user.',
    minimum: 0,
    maximum: MAX_LIMIT_VALUE,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_LIMIT_VALUE)
  readonly limitValue: number;

  @ApiProperty({
    description: 'Why the exemption is being granted.',
    maxLength: 500,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  readonly reason: string;

  @ApiPropertyOptional({
    description:
      'When the exemption should lapse. Omit for an indefinite exemption.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MinDate(() => new Date(), {
    message: 'expiresAt must be in the future',
  })
  readonly expiresAt?: Date;
}
