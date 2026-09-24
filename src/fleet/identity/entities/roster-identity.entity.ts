import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { StoFleetEntity } from '../../entities/sto-fleet.entity';

/**
 * Somebody a Fleet's roster has listed, whoever they turn out to be.
 *
 * ADR-0002's roster identity: a UUID of its own, independent of any name,
 * handle or slug, and scoped to one Fleet. It is not a user and does not need
 * one. A member who has never heard of STO Info is as much a roster entry as
 * one who has, and nothing here would be different for them.
 *
 * Deliberately almost empty. What an identity has been called lives in
 * {@link RosterIdentityAliasEntity}, one row per exact name and handle, and
 * which aliases belong to which identity is recomputed from the evidence and
 * the reviewers' decisions. An identity row therefore never changes once made,
 * which is what lets a proposal, a report or an undo refer to it safely.
 */
@Entity({ name: 'fleet_roster_identity' })
@Unique('UQ_roster_identity_tenancy', ['id', 'fleetId'])
export class RosterIdentityEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Fleet whose roster listed them.' })
  @Column({ type: 'uuid', nullable: false })
  fleetId: string;

  @ApiProperty({ description: 'When the identity was first recorded.' })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ description: 'When the row was last touched.' })
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => StoFleetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity;
}
