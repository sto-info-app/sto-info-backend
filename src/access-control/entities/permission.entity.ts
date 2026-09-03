import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { PermissionModule } from '../enums/permission-module.enum';

/**
 * A single capability a user may hold, such as publishing their own Story.
 *
 * Rows are seeded by migration from `PERMISSION_DEFINITIONS` rather than
 * created at runtime: a permission that no guard references grants nothing, so
 * allowing arbitrary permissions to be invented through the API would only
 * create the illusion of access control.
 */
@Entity({ name: 'permission' })
export class PermissionEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    description: 'Stable code referenced by guards and the frontend.',
    example: 'storytime.story.create',
  })
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100, nullable: false })
  code: string;

  @ApiProperty({ description: 'Human-readable name.' })
  @Column({ type: 'varchar', length: 150, nullable: false })
  name: string;

  @ApiProperty({
    description: 'What holding this permission allows.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  description: string | null;

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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
