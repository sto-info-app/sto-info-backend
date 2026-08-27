import { ApiProperty } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Membership of a permission in a permission group.
 *
 * Modelled as an explicit entity rather than a TypeORM many-to-many so the
 * join carries its own creation timestamp, which is what makes a permission
 * appearing in a group traceable after the fact.
 */
@Entity({ name: 'permission_group_permission' })
export class PermissionGroupPermissionEntity {
  @ApiProperty({ description: 'The group conferring the permission.' })
  @PrimaryColumn({ type: 'uuid' })
  permissionGroupId: string;

  @ApiProperty({ description: 'The permission conferred.' })
  @PrimaryColumn({ type: 'uuid' })
  permissionId: string;

  @CreateDateColumn()
  createdAt: Date;

  @ApiProperty({
    description: 'User who added the permission to the group.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  createdByUserId: string | null;
}
