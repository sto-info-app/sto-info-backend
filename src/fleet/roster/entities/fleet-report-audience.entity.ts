import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetAudience } from '../../enums/fleet-audience.enum';
import { FleetReport } from '../enums/fleet-report.enum';

/**
 * Who the Owner has let see one of a Fleet's reports (FC-020).
 *
 * A report with no row is `PRIVATE`: the holders of `reports.view` alone.
 * `FLEET_MEMBERS` see it in full as well; `COMMUNITY` and `PUBLIC` see its
 * aggregates only. Each change is kept in
 * {@link FleetReportAudienceChangeEntity}.
 */
@Entity({ name: 'fleet_report_audience' })
export class FleetReportAudienceEntity {
  @ApiProperty({ description: 'The Fleet whose report this is.' })
  @PrimaryColumn({ type: 'uuid' })
  fleetId: string;

  @ApiProperty({ enum: FleetReport, description: 'The report.' })
  @PrimaryColumn({
    type: 'enum',
    enum: FleetReport,
    enumName: 'fleet_report_enum',
  })
  report: FleetReport;

  @ApiProperty({ enum: FleetAudience, description: 'Who may see it.' })
  @Column({
    type: 'enum',
    enum: FleetAudience,
    enumName: 'fleet_audience_enum',
    nullable: false,
  })
  audience: FleetAudience;

  @ApiProperty({ description: 'When the audience was last changed.' })
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => StoFleetEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity;
}
