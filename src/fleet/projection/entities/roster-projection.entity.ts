import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { RosterImportSourceEntity } from '../../imports/entities/roster-import-source.entity';

/**
 * Which revision of a Fleet's roster projection is published, and whether a
 * newer one has been asked for (FC-019).
 *
 * One row per Fleet, written when a change first asks for a rebuild. Every
 * derived row carries a revision; this says which revision readers use.
 *
 * `requested` is bumped by each change, in that change's own transaction.
 * `built` is the value of `requested` the published revision was built from.
 * A rebuild that finds `built` at or past `requested` does nothing, so a
 * duplicate or retried job costs a read; and `requested` ahead of `built` is
 * what a stale projection is, served as it stands and labelled so.
 */
@Entity({ name: 'fleet_roster_projection' })
@Index('IDX_roster_projection_behind', ['fleetId'], {
  where: `"built" < "requested"`,
})
export class RosterProjectionEntity {
  @ApiProperty({ description: 'The Fleet.' })
  @PrimaryColumn({ type: 'uuid' })
  fleetId: string;

  @ApiProperty({ description: 'How many changes have asked for a rebuild.' })
  @Column({ type: 'integer', nullable: false, default: 0 })
  requested: number;

  @ApiProperty({
    description: 'The value of requested the published revision covers.',
  })
  @Column({ type: 'integer', nullable: false, default: 0 })
  built: number;

  @ApiProperty({
    description: 'The published revision, or 0 before the first is built.',
  })
  @Column({ type: 'integer', nullable: false, default: 0 })
  revision: number;

  @ApiProperty({
    description: 'When the published revision was published.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  publishedAt: Date | null;

  @ApiProperty({
    description:
      'The latest effective export in the published revision, or null when ' +
      'it has none. How a replay knows whether the latest export changed.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  latestImportId: string | null;

  @ApiProperty({
    description:
      'The export Character Fleet proposals were last raised from, or null ' +
      'before any were. Behind latestImportId only until they have been.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  proposedImportId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToOne(() => StoFleetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity;

  @ManyToOne(() => RosterImportSourceEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'latestImportId' })
  latestImport: RosterImportSourceEntity | null;

  @ManyToOne(() => RosterImportSourceEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'proposedImportId' })
  proposedImport: RosterImportSourceEntity | null;
}
