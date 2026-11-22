import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { UserEntity } from 'src/user/entities/user.entity';

import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetAudience } from '../../enums/fleet-audience.enum';
import { FleetReport } from '../enums/fleet-report.enum';

/**
 * One change the Owner made to who may see a Fleet's report (FC-020).
 *
 * Append-only: a database trigger refuses any change but the actor's account
 * being deleted. No reason is asked, as for the Owner's other settings.
 */
@Entity({ name: 'fleet_report_audience_change' })
@Index('IDX_fleet_report_audience_change_fleet', ['fleetId', 'changedAt'])
@Index('IDX_fleet_report_audience_change_actor', ['actorUserId'])
export class FleetReportAudienceChangeEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Fleet whose report it was.' })
  @Column({ type: 'uuid', nullable: false })
  fleetId: string;

  @ApiProperty({ enum: FleetReport, description: 'The report.' })
  @Column({
    type: 'enum',
    enum: FleetReport,
    enumName: 'fleet_report_enum',
    nullable: false,
  })
  report: FleetReport;

  @ApiProperty({ enum: FleetAudience, description: 'Who could see it.' })
  @Column({
    type: 'enum',
    enum: FleetAudience,
    enumName: 'fleet_audience_enum',
    nullable: false,
  })
  audienceBefore: FleetAudience;

  @ApiProperty({ enum: FleetAudience, description: 'Who can see it now.' })
  @Column({
    type: 'enum',
    enum: FleetAudience,
    enumName: 'fleet_audience_enum',
    nullable: false,
  })
  audienceAfter: FleetAudience;

  @ApiProperty({
    description: 'Who changed it, or null once their account is gone.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  actorUserId: string | null;

  @ApiProperty({ description: 'When it was changed.' })
  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  changedAt: Date;

  @ApiProperty({ description: 'When the row was written.' })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => StoFleetEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actorUserId' })
  actor: UserEntity | null;
}
