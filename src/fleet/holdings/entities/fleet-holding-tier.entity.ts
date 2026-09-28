import { ApiProperty } from '@nestjs/swagger';

import { Entity, PrimaryColumn } from 'typeorm';

/**
 * One tier a track may be at (FC-023).
 *
 * Every recorded tier references a row here, so the database itself refuses
 * a tier the catalogue does not list, or a tier of another track.
 */
@Entity({ name: 'fleet_holding_tier' })
export class FleetHoldingTierEntity {
  @ApiProperty({ description: 'The track.' })
  @PrimaryColumn({ type: 'varchar', length: 60 })
  trackCode: string;

  @ApiProperty({ description: 'The tier, from 0, meaning not started.' })
  @PrimaryColumn({ type: 'smallint' })
  tier: number;
}
