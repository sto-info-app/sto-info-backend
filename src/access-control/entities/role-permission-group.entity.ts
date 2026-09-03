import { ApiProperty } from '@nestjs/swagger';

import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

import { UserRole } from '../../user/enums/user-role.enum';

/**
 * The permission groups a role confers by default.
 *
 * This is the bridge between the application's coarse existing roles and the
 * fine-grained permission model: a user's baseline permissions are those of
 * every group mapped to their role, before per-user overrides are applied.
 */
@Entity({ name: 'role_permission_group' })
export class RolePermissionGroupEntity {
  @ApiProperty({ enum: UserRole, description: 'The role receiving the group.' })
  @PrimaryColumn({
    type: 'enum',
    enum: UserRole,
    enumName: 'user_role_enum',
  })
  role: UserRole;

  @ApiProperty({ description: 'The group granted to the role.' })
  @PrimaryColumn({ type: 'uuid' })
  permissionGroupId: string;

  @CreateDateColumn()
  createdAt: Date;

  @ApiProperty({
    description: 'User who granted the group to the role.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  createdByUserId: string | null;
}
