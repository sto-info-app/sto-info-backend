import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { RosterChangeKind } from '../enums/roster-change-kind.enum';
import { ProjectedChangeDetail } from '../utilities/roster-projector';

/**
 * One change to one member between two exports, as a projection revision
 * reads it (FC-019).
 *
 * Derived and rebuildable, and never dated more exactly than its two bounds.
 * A change with `acrossGap` lies across an export where the member was
 * unknown and is counted in no interval's summary.
 */
@Entity({ name: 'fleet_roster_change' })
@Index('IDX_roster_change_when', ['fleetId', 'revision', 'toAt'])
@Index('IDX_roster_change_identity', ['fleetId', 'revision', 'identityId'])
export class RosterChangeEntity {
  @ApiProperty({ description: 'Unique identifier, new in every revision.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Fleet.' })
  @Column({ type: 'uuid', nullable: false })
  fleetId: string;

  @ApiProperty({ description: 'The projection revision it belongs to.' })
  @Column({ type: 'integer', nullable: false })
  revision: number;

  @ApiProperty({ description: 'The roster identity.' })
  @Column({ type: 'uuid', nullable: false })
  identityId: string;

  @ApiProperty({ description: 'The ordinal of its episode.' })
  @Column({ type: 'integer', nullable: false })
  episodeOrdinal: number;

  @ApiProperty({ enum: RosterChangeKind, description: 'What changed.' })
  @Column({
    type: 'enum',
    enum: RosterChangeKind,
    enumName: 'roster_change_kind_enum',
    nullable: false,
  })
  kind: RosterChangeKind;

  @ApiProperty({
    description: 'The export it happened after, if one bounds it.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  fromImportId: string | null;

  @ApiProperty({ description: 'That export’s instant.', nullable: true })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  fromAt: Date | null;

  @ApiProperty({ description: 'The export it happened by.' })
  @Column({ type: 'uuid', nullable: false })
  toImportId: string;

  @ApiProperty({ description: 'That export’s instant.' })
  @Column({ type: 'timestamptz', nullable: false })
  toAt: Date;

  @ApiProperty({
    description: 'Whether its bounds are wider than one interval.',
  })
  @Column({ type: 'boolean', nullable: false })
  acrossGap: boolean;

  @ApiProperty({
    description: 'For a contribution rise, the rise. Never negative.',
    nullable: true,
  })
  @Column({ type: 'bigint', nullable: true, default: null })
  contributionDelta: string | null;

  @ApiProperty({ description: 'What it says beyond its kind and bounds.' })
  @Column({ type: 'jsonb', nullable: false, default: () => `'{}'` })
  detail: ProjectedChangeDetail;
}
