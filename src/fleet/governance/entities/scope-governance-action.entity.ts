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

import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { ScopeCapabilityEffect } from '../../enums/scope-capability-effect.enum';
import { ScopeGovernanceActionKind } from '../enums/scope-governance-action-kind.enum';
import { OwnershipTransferEntity } from './ownership-transfer.entity';

/**
 * One change to who governs a Community or Fleet, and who made it (FC-022).
 *
 * Role assignments and capability grants keep their own dates; this keeps
 * who ended them and why, and the things no other row records at all: an
 * ownership offer and its answer, a site administrator's dispute action, and
 * a closure's reason.
 *
 * Append-only: a database trigger refuses any change but a named user's
 * account being deleted. The reasons the story asks for on removals are
 * required by check constraints, not only by the service.
 */
@Entity({ name: 'scope_governance_action' })
@Index('IDX_scope_governance_action_community', ['communityId', 'createdAt'])
@Index('IDX_scope_governance_action_fleet', ['fleetId', 'createdAt'])
@Index('IDX_scope_governance_action_armada', ['armadaId', 'createdAt'])
@Index('IDX_scope_governance_action_actor', ['actorUserId'])
@Index('IDX_scope_governance_action_subject', ['subjectUserId'])
@Index('IDX_scope_governance_action_transfer', ['transferId'])
export class ScopeGovernanceActionEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Community the change was made in.' })
  @Column({ type: 'uuid', nullable: false })
  communityId: string;

  @ApiProperty({
    description: 'The Fleet, when the change was made at a Fleet.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  fleetId: string | null;

  @ApiProperty({
    description: 'The Armada, when the change was made at an Armada.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  armadaId: string | null;

  @ApiProperty({ enum: ScopeGovernanceActionKind })
  @Column({
    type: 'enum',
    enum: ScopeGovernanceActionKind,
    enumName: 'scope_governance_action_enum',
    nullable: false,
  })
  action: ScopeGovernanceActionKind;

  @ApiProperty({
    description: 'Who made it, or null once their account has gone.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  actorUserId: string | null;

  @ApiProperty({
    description: 'Whether a site administrator made it in a dispute.',
  })
  @Column({ type: 'boolean', nullable: false, default: false })
  asSiteAdmin: boolean;

  @ApiProperty({
    description: 'The person it was about, where it was about one.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  subjectUserId: string | null;

  @ApiProperty({
    enum: FleetScopeRole,
    description: 'The role label granted or taken, or granted to.',
    nullable: true,
  })
  @Column({
    type: 'enum',
    enum: FleetScopeRole,
    enumName: 'fleet_scope_role_enum',
    nullable: true,
    default: null,
  })
  role: FleetScopeRole | null;

  @ApiProperty({
    description: 'The capability granted, denied or cleared.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  capability: string | null;

  @ApiProperty({
    enum: ScopeCapabilityEffect,
    description: 'For a clearing, what was cleared.',
    nullable: true,
  })
  @Column({
    type: 'enum',
    enum: ScopeCapabilityEffect,
    enumName: 'scope_capability_effect_enum',
    nullable: true,
    default: null,
  })
  clearedEffect: ScopeCapabilityEffect | null;

  @ApiProperty({
    description: 'Why, where a reason was given.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  reason: string | null;

  @ApiProperty({
    description: 'The ownership offer, for an ownership change.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  transferId: string | null;

  @ApiProperty({ description: 'When it happened.' })
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'For an entry the system wrote as a consequence, the key that keeps a ' +
      "retry from writing it twice (FC-039); null for anybody's own act.",
  })
  @Column({ type: 'varchar', length: 200, nullable: true, default: null })
  idempotencyKey: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => FleetCommunityEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'communityId' })
  community: FleetCommunityEntity;

  @ManyToOne(() => StoFleetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actorUserId' })
  actor: UserEntity | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subjectUserId' })
  subject: UserEntity | null;

  @ManyToOne(() => OwnershipTransferEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'transferId' })
  transfer: OwnershipTransferEntity | null;
}
