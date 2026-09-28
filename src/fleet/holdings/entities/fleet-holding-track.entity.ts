import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  Unique,
} from 'typeorm';

/**
 * One track of a holding that has a tier of its own (FC-023): the holding's
 * own, or one of its departments, such as the Starbase's Military.
 *
 * Every holding has exactly one track of its own, by partial unique index.
 */
@Entity({ name: 'fleet_holding_track' })
@Unique('UQ_fleet_holding_track_holding', ['holdingTypeCode', 'code'])
@Unique('UQ_fleet_holding_track_position', ['holdingTypeCode', 'position'])
@Index('UX_fleet_holding_track_own', ['holdingTypeCode'], {
  unique: true,
  where: 'NOT "isDepartment"',
})
export class FleetHoldingTrackEntity {
  @ApiProperty({ description: 'Stable code, such as STARBASE_MILITARY.' })
  @PrimaryColumn({ type: 'varchar', length: 60 })
  code: string;

  @ApiProperty({ description: 'The holding it belongs to.' })
  @Column({ type: 'varchar', length: 40, nullable: false })
  holdingTypeCode: string;

  @ApiProperty({ description: 'Its name in game.' })
  @Column({ type: 'varchar', length: 100, nullable: false })
  name: string;

  @ApiProperty({
    description: 'Whether it is a department, rather than the holding itself.',
  })
  @Column({ type: 'boolean', nullable: false })
  isDepartment: boolean;

  @ApiProperty({ description: 'Where it comes within its holding.' })
  @Column({ type: 'smallint', nullable: false })
  position: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
