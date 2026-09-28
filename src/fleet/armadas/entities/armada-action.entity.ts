import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

import { ArmadaPosition } from '../../enums/armada-position.enum';
import { ArmadaActionKind } from '../enums/armada-action-kind.enum';

/**
 * One change to where one Fleet sits in an Armada, and who made it
 * (FC-024).
 *
 * Several rows share a `changeId` when one change moves more than one Fleet:
 * a Beta leaving, say, with each of its Gammas moved, promoted or taken out
 * with it. A move, a departure and a removal need a reason, by check
 * constraint, and the rows of one change share it.
 *
 * Append-only: a trigger refuses any change but a named person's account, or
 * the request it cites, going.
 */
@Entity({ name: 'armada_action' })
@Unique('UQ_armada_action_change_fleet', ['changeId', 'fleetId'])
@Index('IDX_armada_action_armada', ['armadaId', 'createdAt'])
@Index('IDX_armada_action_fleet', ['fleetId', 'createdAt'])
@Index('IDX_armada_action_actor', ['actorUserId'])
export class ArmadaActionEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Community holding both.' })
  @Column({ type: 'uuid', nullable: false })
  communityId: string;

  @ApiProperty({ description: 'The Armada.' })
  @Column({ type: 'uuid', nullable: false })
  armadaId: string;

  @ApiProperty({ description: 'The Fleet that moved.' })
  @Column({ type: 'uuid', nullable: false })
  fleetId: string;

  @ApiProperty({ description: 'The change it was part of.' })
  @Column({ type: 'uuid', nullable: false })
  changeId: string;

  @ApiProperty({ enum: ArmadaActionKind })
  @Column({
    type: 'enum',
    enum: ArmadaActionKind,
    enumName: 'armada_action_enum',
  })
  action: ArmadaActionKind;

  @ApiProperty({
    enum: ArmadaPosition,
    description: 'Where it was, or null when it was placed.',
    nullable: true,
  })
  @Column({
    type: 'enum',
    enum: ArmadaPosition,
    enumName: 'armada_position_enum',
    nullable: true,
    default: null,
  })
  fromPosition: ArmadaPosition | null;

  @ApiProperty({
    description: 'The Beta it sat under, when it was a Gamma.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  fromParentFleetId: string | null;

  @ApiProperty({
    enum: ArmadaPosition,
    description: 'Where it went, or null when it left.',
    nullable: true,
  })
  @Column({
    type: 'enum',
    enum: ArmadaPosition,
    enumName: 'armada_position_enum',
    nullable: true,
    default: null,
  })
  toPosition: ArmadaPosition | null;

  @ApiProperty({
    description: 'The Beta it went under, when it became a Gamma.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  toParentFleetId: string | null;

  @ApiProperty({
    description: 'Who made it, or null once their account has gone.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  actorUserId: string | null;

  @ApiProperty({
    description: 'Why, where a reason was given.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  reason: string | null;

  @ApiProperty({
    description: 'The request an approval answered.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  requestId: string | null;

  @ApiProperty({ description: 'When it happened.' })
  @Column({ type: 'timestamptz', nullable: false })
  createdAt: Date;
}
