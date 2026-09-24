import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { RosterImportSourceEntity } from '../../imports/entities/roster-import-source.entity';
import { RosterProjectionInputOutcome } from '../enums/roster-projection-input-outcome.enum';

/**
 * What one projection revision made of one import (FC-019).
 *
 * Every import in force or held is listed, read or not, so the revision says
 * what it was built from and what it left out and why — plan section 5's
 * "effective revision, coverage and observation provenance".
 */
@Entity({ name: 'fleet_roster_projection_input' })
@Index('IDX_roster_projection_input_import', ['importSourceId'])
export class RosterProjectionInputEntity {
  @ApiProperty({ description: 'The Fleet.' })
  @PrimaryColumn({ type: 'uuid' })
  fleetId: string;

  @ApiProperty({ description: 'The revision.' })
  @PrimaryColumn({ type: 'integer' })
  revision: number;

  @ApiProperty({ description: 'The import.' })
  @PrimaryColumn({ type: 'uuid' })
  importSourceId: string;

  @ApiProperty({ description: 'The instant its export claims.' })
  @Column({ type: 'timestamptz', nullable: false })
  exportedAt: Date;

  @ApiProperty({
    enum: RosterProjectionInputOutcome,
    description: 'Whether it was read, and why not when it was not.',
  })
  @Column({
    type: 'enum',
    enum: RosterProjectionInputOutcome,
    enumName: 'roster_projection_input_outcome_enum',
    nullable: false,
  })
  outcome: RosterProjectionInputOutcome;

  @ApiProperty({ description: 'Whether it was marked partial.' })
  @Column({ type: 'boolean', nullable: false })
  partial: boolean;

  @ApiProperty({ description: 'How many of its rows were excluded.' })
  @Column({ type: 'integer', nullable: false })
  excludedRows: number;

  @ManyToOne(() => StoFleetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity;

  @ManyToOne(() => RosterImportSourceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'importSourceId' })
  importSource: RosterImportSourceEntity;
}
