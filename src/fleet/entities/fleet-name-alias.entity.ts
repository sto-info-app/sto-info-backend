import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { UserEntity } from 'src/user/entities/user.entity';

import { StoFleetEntity } from './sto-fleet.entity';

/**
 * A name a Fleet was known by over a stated interval.
 *
 * In-game Fleets are renamed, and roster exports from before a rename carry the
 * old name in the filename. Without this table the only way to reconcile them
 * would be to rewrite the Fleet record, which would silently restate history.
 *
 * The alias is evidence about naming and nothing more: the Fleet's identity is
 * its ID, and neither the ID nor the platform changes when a name does. Every
 * alias is recorded deliberately, with a reason and an actor, because accepting
 * one is how two separate Fleets could be wrongly treated as the same one.
 */
@Entity({ name: 'fleet_name_alias' })
@Index('IDX_fleet_name_alias_fleet_valid_from', ['fleetId', 'validFrom'])
@Index('IDX_fleet_name_alias_normalized', ['exactNameNormalized'])
export class FleetNameAliasEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Fleet this name belonged to.' })
  @Column({ type: 'uuid', nullable: false })
  fleetId: string;

  @ApiProperty({ description: 'The name exactly as it appeared in game.' })
  @Column({ type: 'varchar', length: 255, nullable: false })
  exactName: string;

  @ApiProperty({ description: 'Case-folded name, for lookup.' })
  @Column({ type: 'varchar', length: 255, nullable: false })
  exactNameNormalized: string;

  @ApiProperty({ description: 'When the Fleet began using this name.' })
  @Column({ type: 'timestamptz', nullable: false })
  validFrom: Date;

  @ApiProperty({
    description: 'When it stopped, or null while still current.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  validTo: Date | null;

  @ApiProperty({ description: 'Why this alias was accepted.' })
  @Column({ type: 'varchar', length: 500, nullable: false })
  reason: string;

  @ApiProperty({ description: 'Who recorded it.', nullable: true })
  @Column({ type: 'uuid', nullable: true, default: null })
  recordedByUserId: string | null;

  @ApiProperty({ description: 'When it was recorded.' })
  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  recordedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt: Date | null;

  @ManyToOne(() => StoFleetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'recordedByUserId' })
  recordedBy: UserEntity | null;
}
