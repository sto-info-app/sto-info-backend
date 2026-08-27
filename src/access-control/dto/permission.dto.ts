import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PermissionModule } from '../enums/permission-module.enum';
import { PermissionEffect } from '../enums/permission-effect.enum';

/**
 * A permission as presented to administrators.
 */
export class PermissionDto {
  @ApiProperty({ description: 'Unique identifier.' })
  readonly id: string;

  @ApiProperty({
    description: 'Stable code used in guards.',
    example: 'storytime.story.create',
  })
  readonly code: string;

  @ApiProperty({ description: 'Human-readable name.' })
  readonly name: string;

  @ApiProperty({ description: 'What the permission allows.', nullable: true })
  readonly description: string | null;

  @ApiProperty({
    enum: PermissionModule,
    description: 'Application area the permission belongs to.',
  })
  readonly module: PermissionModule;
}

/**
 * A per-user permission override as presented to administrators.
 */
export class UserPermissionOverrideDto {
  @ApiProperty({ description: 'Unique identifier.' })
  readonly id: string;

  @ApiProperty({ description: 'The permission code affected.' })
  readonly permissionCode: string;

  @ApiProperty({
    enum: PermissionEffect,
    description: 'Whether the permission is granted or withheld.',
  })
  readonly effect: PermissionEffect;

  @ApiProperty({ description: 'Why the override was applied.' })
  readonly reason: string;

  @ApiProperty({ description: 'Administrator who applied the override.' })
  readonly grantedByUserId: string;

  @ApiPropertyOptional({
    description: 'When the override lapses. Null means indefinite.',
    nullable: true,
  })
  readonly expiresAt: Date | null;

  @ApiProperty({ description: 'When the override was applied.' })
  readonly createdAt: Date;
}

/**
 * The full picture of what a user may do, and why.
 */
export class UserAccessSummaryDto {
  @ApiProperty({ description: 'The user the summary describes.' })
  readonly userId: string;

  @ApiProperty({
    description:
      'Every permission code the user currently holds, after overrides are applied.',
    type: [String],
  })
  readonly effectivePermissions: string[];

  @ApiProperty({
    description: 'The overrides currently in force.',
    type: [UserPermissionOverrideDto],
  })
  readonly overrides: UserPermissionOverrideDto[];
}
