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
 * until the group is resolved.
 *
 * Resolving is not built yet, which is why nothing here records how a group
 * was resolved: that shape is the resolving ticket's to decide, and a column
 * nothing writes would be a guess at it.
 */
@Entity({ name: 'fleet_roster_import_conflict' })
@Index('UX_roster_import_conflict_open', ['fleetId', 'exportedAt'], {
  unique: true,
  where: `"resolvedAt" IS NULL`,
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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => StoFleetEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity;
}
