import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { UserEntity } from 'src/user/entities/user.entity';

import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetRecruitmentState } from '../../enums/fleet-recruitment-state.enum';
import { ApplicationQuestion } from '../application-form.interface';

/**
 * One version of how a Fleet recruits: its state, its requirements and its
 * application form (FC-021).
 *
 * Write-once. Each change is a new version, and a database trigger refuses
 * to change one already written, so an application keeps exactly the form it
 * answered — the story's first criterion. `sto_fleet.recruitmentState` holds
 * the current state for the directory and changes with each version.
 *
 * A Fleet that has never saved one recruits in whatever state it was
 * registered with, with no requirements and no questions.
 */
@Entity({ name: 'fleet_recruitment_settings' })
@Unique('UQ_fleet_recruitment_settings_version', ['fleetId', 'version'])
export class FleetRecruitmentSettingsEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Community holding the Fleet.' })
  @Column({ type: 'uuid', nullable: false })
  communityId: string;

  @ApiProperty({ description: 'The Fleet.' })
  @Column({ type: 'uuid', nullable: false })
  fleetId: string;

  @ApiProperty({ description: 'The version, counting from 1.' })
  @Column({ type: 'integer', nullable: false })
  version: number;

  @ApiProperty({
    enum: FleetRecruitmentState,
    description: 'How the Fleet takes new members.',
  })
  @Column({
    type: 'enum',
    enum: FleetRecruitmentState,
    enumName: 'fleet_recruitment_state_enum',
    nullable: false,
  })
  recruitmentState: FleetRecruitmentState;

  @ApiProperty({
    description: 'What the Fleet asks of applicants, in its own words.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 2000, nullable: true, default: null })
  requirementsText: string | null;

  @ApiProperty({
    description: 'The lowest Character level that may join or apply.',
    nullable: true,
  })
  @Column({ type: 'integer', nullable: true, default: null })
  minimumLevel: number | null;

  @ApiProperty({
    description:
      'The factions whose Characters may join or apply; empty for any.',
    type: [String],
  })
  @Column({ type: 'uuid', array: true, nullable: false, default: '{}' })
  factionIds: string[];

  @ApiProperty({
    description: 'The questions the application form asks, in order.',
  })
  @Column({ type: 'jsonb', nullable: false, default: [] })
  questions: ApplicationQuestion[];

  @ApiProperty({
    description: 'Who saved it, or null once their account is gone.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  createdByUserId: string | null;

  @ApiProperty({ description: 'When it was saved.' })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => StoFleetEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdByUserId' })
  createdBy: UserEntity | null;
}
