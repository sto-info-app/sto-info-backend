import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * One save of one Fleet holding: who recorded it, when and why (FC-023).
 *
 * The tracks it moved are its `fleet_holding_history` rows. Append-only: a
 * database trigger refuses any change but the recorder's account being
 * deleted.
 */
@Entity({ name: 'fleet_holding_change' })
@Unique('UQ_fleet_holding_change_scope', ['id', 'fleetId', 'holdingTypeCode'])
@Index('IDX_fleet_holding_change_fleet', ['fleetId', 'createdAt'])
@Index('IDX_fleet_holding_change_actor', ['actorUserId'])
export class FleetHoldingChangeEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Fleet.' })
  @Column({ type: 'uuid', nullable: false })
  fleetId: string;

  @ApiProperty({ description: 'The Community that holds the Fleet.' })
  @Column({ type: 'uuid', nullable: false })
  communityId: string;

  @ApiProperty({ description: 'The holding.' })
  @Column({ type: 'varchar', length: 40, nullable: false })
  holdingTypeCode: string;

  @ApiProperty({
    description: 'Who recorded it, or null once their account has gone.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  actorUserId: string | null;

  @ApiProperty({ description: 'Why, when a reason was given.', nullable: true })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  reason: string | null;

  @ApiProperty({ description: 'When it was recorded.' })
  @Column({ type: 'timestamptz', nullable: false })
  createdAt: Date;
}
