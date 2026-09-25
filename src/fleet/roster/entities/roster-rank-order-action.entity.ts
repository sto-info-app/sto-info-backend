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

/**
 * One edit an investigator made to a Fleet's rank order (FC-020).
 *
 * Append-only: a database trigger refuses any change but the actor's account
 * being deleted. Each order is a list of tiers, highest first, each a list of
 * labels.
 */
@Entity({ name: 'fleet_roster_rank_order_action' })
@Index('IDX_roster_rank_order_action_fleet', ['fleetId', 'actedAt'])
@Index('IDX_roster_rank_order_action_actor', ['actorUserId'])
export class RosterRankOrderActionEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Fleet whose order was edited.' })
  @Column({ type: 'uuid', nullable: false })
  fleetId: string;

  @ApiProperty({
    description: 'Who edited it, or null once their account is gone.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  actorUserId: string | null;

  @ApiProperty({ description: 'Why, in their own words. Always given.' })
  @Column({ type: 'varchar', length: 500, nullable: false })
  reason: string;

  @ApiProperty({
    description: 'The order before, as tiers of labels, highest first.',
    type: 'array',
    items: { type: 'array', items: { type: 'string' } },
  })
  @Column({ type: 'jsonb', nullable: false })
  tiersBefore: string[][];

  @ApiProperty({
    description: 'The order after, as tiers of labels, highest first.',
    type: 'array',
    items: { type: 'array', items: { type: 'string' } },
  })
  @Column({ type: 'jsonb', nullable: false })
  tiersAfter: string[][];

  @ApiProperty({ description: 'When it was edited.' })
  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  actedAt: Date;

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
