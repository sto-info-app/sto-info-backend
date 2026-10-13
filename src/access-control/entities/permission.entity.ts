import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, Index } from 'typeorm';

import { PermissionModule } from '../enums/permission-module.enum';
import { PermissionCatalogueEntryEntity } from './permission-catalogue-entry.entity';

/**
 * A single capability a user may hold, such as publishing their own Story.
 *
 * Rows are seeded by migration from `PERMISSION_DEFINITIONS` rather than
 * created at runtime: a permission that no guard references grants nothing, so
 * allowing arbitrary permissions to be invented through the API would only
 * create the illusion of access control.
 */
@Entity({ name: 'permission' })
export class PermissionEntity extends PermissionCatalogueEntryEntity {
  @ApiProperty({
    enum: PermissionModule,
    description: 'Application area the permission belongs to.',
  })
  @Index()
  @Column({
    type: 'enum',
    enum: PermissionModule,
    enumName: 'permission_module_enum',
  })
  module: PermissionModule;
}
