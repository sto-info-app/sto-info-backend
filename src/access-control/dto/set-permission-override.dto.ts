import { ApiProperty } from '@nestjs/swagger';

import { IsEnum, IsIn, IsString } from 'class-validator';

import {
  PERMISSION_CODES,
  PermissionCode,
} from '../constants/permission-codes.constants';
import { PermissionEffect } from '../enums/permission-effect.enum';
import {
  OverrideExpiryProperty,
  OverrideReasonProperty,
} from './override-fields.decorator';

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

  @OverrideReasonProperty(
    'Why the override is being applied. Recorded so the decision stays reviewable.',
  )
  readonly reason: string;

  @OverrideExpiryProperty(
    'When the override should lapse. Omit for an indefinite override.',
  )
  readonly expiresAt?: Date;
}
