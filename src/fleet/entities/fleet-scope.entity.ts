import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import {
  ImageAltTextColumn,
  ImageReferenceColumn,
} from 'src/shared/entities/image-columns.decorator';

import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';

/**
 * The columns every Fleet scope carries — a Community, a Fleet and an Armada
 * alike: its lifecycle, its banner and emblem, the authorisation revision and
 * its dates.
 *
 * Abstract and without `@Entity`, so each scope keeps its own table. Instants
 * are `timestamptz` throughout — ADR-0007.
 */
export abstract class FleetScopeEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ enum: FleetScopeStatus, description: 'Lifecycle state.' })
  @Column({
    type: 'enum',
    enum: FleetScopeStatus,
    enumName: 'fleet_scope_status_enum',
    default: FleetScopeStatus.ACTIVE,
  })
  status: FleetScopeStatus;

  @ApiProperty({ description: 'When it was closed.', nullable: true })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  closedAt: Date | null;

  @ImageReferenceColumn('Delivery reference of the wide banner.')
  bannerImageId: string | null;

  @ImageAltTextColumn('What the banner shows, for readers who cannot see it.')
  bannerImageAlt: string | null;

  @ImageReferenceColumn('Delivery reference of the square emblem.')
  emblemImageId: string | null;

  @ImageAltTextColumn('What the emblem shows, for readers who cannot see it.')
  emblemImageAlt: string | null;

  /**
   * Bumped by any change that can affect what a member is allowed to see.
   *
   * Cache invalidation and socket revocation key off this. Service checks stay
   * authoritative even when invalidation lags — plan section 4.2.
   */
  @ApiProperty({ description: 'Authorisation revision counter.' })
  @Column({ type: 'integer', nullable: false, default: 1 })
  revision: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt: Date | null;
}
