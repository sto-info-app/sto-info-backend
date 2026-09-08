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

/**
 * A named bundle of permissions, such as "Storytime Creator".
 *
 * Groups exist so roles are granted coherent sets of capabilities rather than
 * long lists of individual permissions, and so adding a permission to a feature
 * does not require editing every role that should receive it.
 */
@Entity({ name: 'permission_group' })
export class PermissionGroupEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    description: 'Stable code for the group.',
    example: 'storytime.creator',
  })
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100, nullable: false })
  code: string;

  @ApiProperty({ description: 'Human-readable name.' })
  @Column({ type: 'varchar', length: 150, nullable: false })
  name: string;

  @ApiProperty({
    description: 'Who the group is intended for.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  description: string | null;

  @ApiProperty({
    description:
      'System groups cannot be renamed or deleted, only have their membership changed.',
  })
  @Column({ type: 'boolean', nullable: false, default: false })
  isSystem: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
