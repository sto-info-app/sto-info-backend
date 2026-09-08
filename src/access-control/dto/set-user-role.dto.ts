import { ApiProperty } from '@nestjs/swagger';

import { IsIn, IsString } from 'class-validator';

import {
  ASSIGNABLE_USER_ROLES,
  UserRole,
} from '../../user/enums/user-role.enum';

/**
 * Sets which role a member holds.
 *
 * The accepted values are {@link ASSIGNABLE_USER_ROLES} rather than the whole
 * of {@link UserRole}: ADMIN is granted outside the application, so a request
 * naming it is rejected before it reaches the service rather than relying on
 * the service alone to notice.
 */
export class SetUserRoleDto {
  @ApiProperty({
    description: 'The role to give the member.',
    enum: ASSIGNABLE_USER_ROLES,
    example: UserRole.STORYTIME_CURATOR,
  })
  @IsString()
  @IsIn(ASSIGNABLE_USER_ROLES, {
    message: 'role must be one of USER, STORYTIME_CURATOR',
  })
  readonly role: UserRole;
}
