import { ApiProperty } from '@nestjs/swagger';

import { Column, DeleteDateColumn, Entity } from 'typeorm';

import { PermissionCatalogueEntryEntity } from './permission-catalogue-entry.entity';

/**
 * A named bundle of permissions, such as "Storytime Creator".
 *
 * Groups exist so roles are granted coherent sets of capabilities rather than
 * long lists of individual permissions, and so adding a permission to a feature
 * does not require editing every role that should receive it.
 */
@Entity({ name: 'permission_group' })
export class PermissionGroupEntity extends PermissionCatalogueEntryEntity {
  @ApiProperty({
    description:
      'System groups cannot be renamed or deleted, only have their membership changed.',
  })
  @Column({ type: 'boolean', nullable: false, default: false })
  isSystem: boolean;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
