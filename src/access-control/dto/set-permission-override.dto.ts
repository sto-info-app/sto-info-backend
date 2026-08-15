import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinDate,
} from 'class-validator';
import {
  PERMISSION_CODES,
  PermissionCode,
} from '../constants/permission-codes.constants';
import { PermissionEffect } from '../enums/permission-effect.enum';

/** Every permission code an administrator may override. */
const ALLOWED_PERMISSION_CODES: readonly PermissionCode[] =
  Object.values(PERMISSION_CODES);

/**
 * Grants or withholds a single permission for a single user.
 *
 * Applying the same permission twice updates the existing override rather than
 * creating a second one, so the request is idempotent from the caller's point
 * of view.
 */
export class SetPermissionOverrideDto {
  @ApiProperty({
    description: 'The permission code to override.',
    example: PERMISSION_CODES.STORYTIME_STORY_CREATE,
    enum: ALLOWED_PERMISSION_CODES,
  })
  @IsString()
  @IsIn(ALLOWED_PERMISSION_CODES, {
    message: 'permissionCode must be a recognised permission',
  })
  readonly permissionCode: PermissionCode;

  @ApiProperty({
    enum: PermissionEffect,
    description: 'Whether to grant the permission or withhold it.',
  })
  @IsEnum(PermissionEffect)
  readonly effect: PermissionEffect;

  @ApiProperty({
    description:
      'Why the override is being applied. Recorded so the decision stays reviewable.',
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
      'When the override should lapse. Omit for an indefinite override.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MinDate(() => new Date(), {
    message: 'expiresAt must be in the future',
  })
  readonly expiresAt?: Date;
}
