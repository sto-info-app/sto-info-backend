import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinDate,
} from 'class-validator';

/** The longest reason an administrator's override keeps. */
export const OVERRIDE_REASON_MAX_LENGTH = 500;

/**
 * Trims a string value, leaving anything else untouched for the validators.
 *
 * @param params - The value being transformed.
 * @returns The trimmed string, or the value unchanged.
 */
export const trimOverrideReason = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Declares the required reason an administrator gives for a per-user
 * override, trimmed and kept to {@link OVERRIDE_REASON_MAX_LENGTH}
 * characters, so the decision stays reviewable afterwards.
 *
 * The decorators are listed in the order stacked ones would apply, bottom
 * up, so the validation messages come out in the order they always have.
 *
 * @param description - What the reason is for, for the API documentation.
 * @returns The combined property decorator.
 */
export function OverrideReasonProperty(description: string): PropertyDecorator {
  return applyDecorators(
    MaxLength(OVERRIDE_REASON_MAX_LENGTH),
    IsNotEmpty(),
    IsString(),
    Transform(trimOverrideReason),
    ApiProperty({ description, maxLength: OVERRIDE_REASON_MAX_LENGTH }),
  );
}

/**
 * Declares the optional moment a per-user override lapses, which must be in
 * the future when given. Leaving it out makes the override indefinite.
 *
 * @param description - What lapses, for the API documentation.
 * @returns The combined property decorator.
 */
export function OverrideExpiryProperty(description: string): PropertyDecorator {
  return applyDecorators(
    MinDate(() => new Date(), {
      message: 'expiresAt must be in the future',
    }),
    IsDate(),
    Type(() => Date),
    IsOptional(),
    ApiPropertyOptional({ description }),
  );
}
