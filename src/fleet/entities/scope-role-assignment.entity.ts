import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { UserEntity } from 'src/user/entities/user.entity';

import { FleetScopeRole } from '../enums/fleet-scope-role.enum';
import { FleetCommunityEntity } from './fleet-community.entity';
import { StoArmadaEntity } from './sto-armada.entity';
import { StoFleetEntity } from './sto-fleet.entity';

/**
 * One of the four fixed role labels, held by a user at one scope over time.
 *
 * Scoped by construction: a role granted on a Fleet says nothing about any
 * other Fleet, and a site-wide capability does not reach in here — FC-005's
 * first acceptance criterion. Scope is typed columns rather than an object ID
 * and a type string, and `communityId` participates in the composite foreign
 * keys, so a grant cannot name another Community's Fleet.
 *
 * Assignments are temporal rather than deleted, so "who could approve that
 * application last March" stays answerable after the role has been withdrawn.
 * The partial unique indexes allow only one open assignment of a given role per
 * user per scope, leaving any number of closed ones behind it.
 *
 * A label is not a capability set. Which capabilities each label carries, how
 * an Officer's are delegated, and the rule that a CSV Guild Rank never assigns
 * any of them, are FC-005.
 */
@Entity({ name: 'scope_role_assignment' })
@Index(
  'UX_scope_role_assignment_open_community',
  ['communityId', 'userId', 'role'],
  {
    unique: true,
    where:
      '"fleetId" IS NULL AND "armadaId" IS NULL AND "validTo" IS NULL AND "deletedAt" IS NULL',
  },
)
@Index('UX_scope_role_assignment_open_fleet', ['fleetId', 'userId', 'role'], {
  unique: true,
  where: '"fleetId" IS NOT NULL AND "validTo" IS NULL AND "deletedAt" IS NULL',
})
@Index('UX_scope_role_assignment_open_armada', ['armadaId', 'userId', 'role'], {
  unique: true,
  where: '"armadaId" IS NOT NULL AND "validTo" IS NULL AND "deletedAt" IS NULL',
})
@Index('IDX_scope_role_assignment_user_role', ['userId', 'role'])
@Index('IDX_scope_role_assignment_community_role', ['communityId', 'role'])
export class ScopeRoleAssignmentEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Community the scope belongs to.' })
  @Column({ type: 'uuid', nullable: false })
  communityId: string;

  @ApiProperty({
    description: 'The Fleet, when the scope is a Fleet.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  fleetId: string | null;

  @ApiProperty({
    description: 'The Armada, when the scope is an Armada.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  armadaId: string | null;

  @ApiProperty({ description: 'The user holding the role.' })
  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @ApiProperty({ enum: FleetScopeRole, description: 'The fixed role label.' })
  @Column({
    type: 'enum',
    enum: FleetScopeRole,
    enumName: 'fleet_scope_role_enum',
  })
  role: FleetScopeRole;

  @ApiProperty({ description: 'When the assignment took effect.' })
  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  validFrom: Date;

  @ApiProperty({
    description: 'When it ended, or null while held.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  validTo: Date | null;

  @ApiProperty({ description: 'Who granted it.', nullable: true })
  @Column({ type: 'uuid', nullable: true, default: null })
  grantedByUserId: string | null;

  @ApiProperty({
    description: 'Why it was granted or withdrawn.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  reason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt: Date | null;

  @ManyToOne(() => FleetCommunityEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'communityId' })
  community: FleetCommunityEntity;

  /** Joined on the Fleet ID; the composite constraint is in the migration. */
  @ManyToOne(() => StoFleetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity | null;

  /** Joined on the Armada ID; the composite constraint is in the migration. */
  @ManyToOne(() => StoArmadaEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'armadaId' })
  armada: StoArmadaEntity | null;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'grantedByUserId' })
  grantedBy: UserEntity | null;
}
