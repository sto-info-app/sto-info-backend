import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { StoFleetEntity } from '../../entities/sto-fleet.entity';

/**
 * Where one of a Fleet's rank labels sits in the order an investigator gave
 * it (FC-020).
 *
 * Tier 1 is the highest, and several labels may share a tier. A move between
 * tiers is a promotion or a demotion; any other change of label is only
 * "rank changed". Matched to an export row's rank by exact text, and replaced
 * whole by each edit, whose record is {@link RosterRankOrderActionEntity}.
 */
@Entity({ name: 'fleet_roster_rank_order' })
export class RosterRankOrderEntity {
  @ApiProperty({ description: 'The Fleet whose label this is.' })
  @PrimaryColumn({ type: 'uuid' })
  fleetId: string;

  @ApiProperty({ description: 'The rank label, exactly as exports list it.' })
  @PrimaryColumn({ type: 'varchar', length: 255 })
  label: string;

  @ApiProperty({ description: 'Its tier, 1 being the highest.' })
  @Column({ type: 'integer', nullable: false })
  tier: number;

  @ManyToOne(() => StoFleetEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity;
}
