import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * One track a change moved, from one tier to another (FC-023).
 *
 * Both tiers reference the catalogue, and the track must belong to the
 * change's holding. Write-once, by trigger.
 */
@Entity({ name: 'fleet_holding_history' })
@Unique('UQ_fleet_holding_history_track', ['changeId', 'trackCode'])
@Index('IDX_fleet_holding_history_fleet', ['fleetId', 'trackCode'])
export class FleetHoldingHistoryEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The change it was part of.' })
  @Column({ type: 'uuid', nullable: false })
  changeId: string;

  @ApiProperty({ description: 'The Fleet.' })
  @Column({ type: 'uuid', nullable: false })
  fleetId: string;

  @ApiProperty({ description: 'The holding.' })
  @Column({ type: 'varchar', length: 40, nullable: false })
  holdingTypeCode: string;

  @ApiProperty({ description: 'The track.' })
  @Column({ type: 'varchar', length: 60, nullable: false })
  trackCode: string;

  @ApiProperty({ description: 'Its tier before.' })
  @Column({ type: 'smallint', nullable: false })
  tierBefore: number;

  @ApiProperty({ description: 'Its tier after.' })
  @Column({ type: 'smallint', nullable: false })
  tier: number;
}
