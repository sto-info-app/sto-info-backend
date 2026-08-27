import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PermissionEffect } from '../enums/permission-effect.enum';

/**
 * A per-user adjustment to the permissions their role confers.
 *
 * A `DENY` override is the mechanism for barring one user from a capability —
 * for example revoking Story creation from a persistently abusive account —
 * without disabling the account outright or inventing a role for one person. A
 * `GRANT` override is the reverse: extending a capability to a trusted user
 * ahead of their role.
 *
 * Overrides soft-delete so that revoking one leaves the pair free to be used
 * again, which is why the uniqueness guarantee is a partial index over live
 * rows only.
 */
@Entity({ name: 'user_permission_override' })
@Index(['userId', 'permissionId'])
export class UserPermissionOverrideEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The user the override applies to.' })
  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @ApiProperty({ description: 'The permission being granted or denied.' })
  @Column({ type: 'uuid', nullable: false })
  permissionId: string;

  @ApiProperty({
    enum: PermissionEffect,
    description: 'Whether the permission is granted or withheld.',
  })
  @Column({
    type: 'enum',
    enum: PermissionEffect,
    enumName: 'permission_effect_enum',
  })
  effect: PermissionEffect;

  @ApiProperty({
    description:
      'Why the override was applied. Required so moderation decisions remain reviewable.',
  })
  @Column({ type: 'varchar', length: 500, nullable: false })
  reason: string;

  @ApiProperty({ description: 'Administrator who applied the override.' })
  @Column({ type: 'uuid', nullable: false })
  grantedByUserId: string;

  @ApiProperty({
    description: 'When the override stops applying. Null means indefinite.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  expiresAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
