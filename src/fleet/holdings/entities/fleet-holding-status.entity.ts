import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Where one track of one Fleet's holding stands now (FC-023).
 *
 * A track with no row is at tier 0 and has never been recorded. The history
 * of how it got here is in `fleet_holding_history`.
 */
@Entity({ name: 'fleet_holding_status' })
export class FleetHoldingStatusEntity {
  @ApiProperty({ description: 'The Fleet.' })
  @PrimaryColumn({ type: 'uuid' })
  fleetId: string;

  @ApiProperty({ description: 'The Community that holds the Fleet.' })
  @Column({ type: 'uuid', nullable: false })
  communityId: string;

  @ApiProperty({ description: 'The holding.' })
  @Column({ type: 'varchar', length: 40, nullable: false })
  holdingTypeCode: string;

  @ApiProperty({ description: 'The track.' })
  @PrimaryColumn({ type: 'varchar', length: 60 })
  trackCode: string;

  @ApiProperty({ description: 'Its tier.' })
  @Column({ type: 'smallint', nullable: false })
  tier: number;

  @ApiProperty({ description: 'When it was last recorded.' })
  @Column({ type: 'timestamptz', nullable: false })
  updatedAt: Date;
}
