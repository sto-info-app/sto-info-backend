import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { StoFleetEntity } from '../../entities/sto-fleet.entity';

/**
 * Two or more exports of one Fleet that claim the same moment and do not say
 * the same thing.
 *
 * Found at upload and kept until somebody decides which stands. Every import
 * in the group points here; the first version of the moment the site saw
 * stays in force, and any import saying something different waits, held,
 * until an investigator selects one.
 *
 * One group per Fleet and instant, ever. An export arriving for an instant
 * whose group was settled reopens it, and the selection already made stays
 * the roster at that moment until somebody selects again. Each selection is
 * in `fleet_roster_import_action`; this row holds the current one.
 */
@Entity({ name: 'fleet_roster_import_conflict' })
@Index('UX_roster_import_conflict_instant', ['fleetId', 'exportedAt'], {
  unique: true,
})
export class RosterImportConflictEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Fleet whose exports disagree.' })
  @Column({ type: 'uuid', nullable: false })
  fleetId: string;

  @ApiProperty({ description: 'The moment they all claim to have been taken.' })
  @Column({ type: 'timestamptz', nullable: false })
  exportedAt: Date;

  @ApiProperty({ description: 'When the disagreement was found.' })
  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  openedAt: Date;

  @ApiProperty({
    description:
      'When somebody decided which export stands, or null while nobody has.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  resolvedAt: Date | null;

  @ApiProperty({
    description:
      'The export an investigator selected as the roster at this moment, or ' +
      'null while nobody has. Always one of the group’s own imports.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  selectedImportId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => StoFleetEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity;
}
