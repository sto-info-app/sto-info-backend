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

import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { ScopeMembershipActionKind } from '../enums/scope-membership-action-kind.enum';
import { FleetApplicationEntity } from './fleet-application.entity';

/**
 * One change to a membership, and who made it (FC-021).
 *
 * A `scope_membership` row is updated in place, so it would otherwise
 * remember only its latest state. Append-only: a database trigger refuses any
 * change but the actor's account being deleted. A removal carries its
 * reason.
 */
@Entity({ name: 'scope_membership_action' })
@Index('IDX_scope_membership_action_membership', ['membershipId', 'createdAt'])
@Index('IDX_scope_membership_action_actor', ['actorUserId'])
@Index('IDX_scope_membership_action_application', ['applicationId'])
export class ScopeMembershipActionEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The membership.' })
  @Column({ type: 'uuid', nullable: false })
  membershipId: string;

  @ApiProperty({ enum: ScopeMembershipActionKind })
  @Column({
    type: 'enum',
    enum: ScopeMembershipActionKind,
    enumName: 'scope_membership_action_enum',
    nullable: false,
  })
  action: ScopeMembershipActionKind;

  @ApiProperty({
    description: 'Who did it, or null for a join or once they have gone.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  actorUserId: string | null;

  @ApiProperty({ description: 'Why, for a removal.', nullable: true })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  reason: string | null;

  @ApiProperty({
    description: 'The application that granted it, for an approval.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  applicationId: string | null;

  @ApiProperty({ description: 'When it happened.' })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => ScopeMembershipEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'membershipId' })
  membership: ScopeMembershipEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actorUserId' })
  actor: UserEntity | null;

  @ManyToOne(() => FleetApplicationEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'applicationId' })
  application: FleetApplicationEntity | null;
}
