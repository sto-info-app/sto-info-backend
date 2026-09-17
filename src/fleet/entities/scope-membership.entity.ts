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

import { ScopeMembershipStatus } from '../enums/scope-membership-status.enum';
import { FleetCommunityEntity } from './fleet-community.entity';
import { StoArmadaEntity } from './sto-armada.entity';
import { StoFleetEntity } from './sto-fleet.entity';

/**
 * An approved-access record for one user at one scope.
 *
 * This is the only row in the feature that grants access to private Fleet data.
 * A roster observation naming a Character does not, and a Community
 * subscription does not — ADR-0002, and FC-005's second acceptance criterion.
 *
 * The scope is expressed as **typed columns rather than an object ID and a type
 * string**, as plan section 4.1 requires. `communityId` is always present;
 * `fleetId` and `armadaId` are nullable and at most one may be set, enforced by
 * a check constraint. A membership with neither set is membership of the
 * Community itself.
 *
 * Because `communityId` is part of the composite foreign key to each child, a
 * request cannot smuggle another Community's Fleet ID into a membership for
 * this Community: the row simply will not insert. That is FC-004's fourth
 * acceptance criterion, enforced structurally rather than by a service check.
 *
 * Only `APPROVED` confers access, and `SUSPENDED` denies it outright rather
 * than degrading to something weaker — deny wins, which is FC-005's first
 * acceptance criterion.
 */
@Entity({ name: 'scope_membership' })
@Index('UX_scope_membership_community_user', ['communityId', 'userId'], {
  unique: true,
  where: '"fleetId" IS NULL AND "armadaId" IS NULL AND "deletedAt" IS NULL',
})
@Index('UX_scope_membership_fleet_user', ['fleetId', 'userId'], {
  unique: true,
  where: '"fleetId" IS NOT NULL AND "deletedAt" IS NULL',
})
@Index('UX_scope_membership_armada_user', ['armadaId', 'userId'], {
  unique: true,
  where: '"armadaId" IS NOT NULL AND "deletedAt" IS NULL',
})
@Index('IDX_scope_membership_user_status', ['userId', 'status'])
export class ScopeMembershipEntity {
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

  @ApiProperty({ description: 'The user whose access this is.' })
  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @ApiProperty({
    enum: ScopeMembershipStatus,
    description: 'Whether access is granted, pending, held or gone.',
  })
  @Column({
    type: 'enum',
    enum: ScopeMembershipStatus,
    enumName: 'scope_membership_status_enum',
    default: ScopeMembershipStatus.PENDING,
  })
  status: ScopeMembershipStatus;

  @ApiProperty({ description: 'When access was asked for.' })
  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  requestedAt: Date;

  @ApiProperty({ description: 'When it was decided.', nullable: true })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  decidedAt: Date | null;

  @ApiProperty({ description: 'Who decided.', nullable: true })
  @Column({ type: 'uuid', nullable: true, default: null })
  decidedByUserId: string | null;

  @ApiProperty({
    description: 'The reason given for the decision.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  decisionReason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt: Date | null;

  @ManyToOne(() => FleetCommunityEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'communityId' })
  community: FleetCommunityEntity;

  /**
   * Joined on the Fleet ID alone.
   *
   * The constraint in the migration is the composite `(fleetId, communityId)`
   * against `sto_fleet (id, communityId)`; it is not declared here for the same
   * reason as in `armada_fleet_membership`. PostgreSQL's default `MATCH SIMPLE`
   * makes this exactly right: when `fleetId` is null the constraint stands
   * aside, and when it is set both columns are checked together.
   */
  @ManyToOne(() => StoFleetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity | null;

  /** Joined on the Armada ID alone; see {@link fleet}. */
  @ManyToOne(() => StoArmadaEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'armadaId' })
  armada: StoArmadaEntity | null;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'decidedByUserId' })
  decidedBy: UserEntity | null;
}
