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
import { RosterIdentityCandidateState } from '../enums/roster-identity-candidate-state.enum';
import { RosterIdentityDecisionAction } from '../enums/roster-identity-decision-action.enum';
import { RosterIdentityCandidateEntity } from './roster-identity-candidate.entity';

/**
 * One thing a reviewer did to a rename candidate.
 *
 * Append-only: a trigger refuses any change to a decision except the actor
 * being cleared when their account is deleted. This is the "versioned" in
 * FC-018's fourth acceptance criterion. The candidate's own `state` is only
 * the latest of these, and undoing a decision adds a row rather than removing
 * one, so the history of who joined two names and who separated them again
 * survives both.
 *
 * `revision` numbers the decisions on one candidate from 1, and a unique index
 * holds it, so two reviewers answering the same candidate at once cannot both
 * record the next decision.
 */
@Entity({ name: 'fleet_roster_identity_decision' })
@Index('UX_roster_identity_decision_revision', ['candidateId', 'revision'], {
  unique: true,
})
@Index('IDX_roster_identity_decision_fleet_decided', ['fleetId', 'decidedAt'])
@Index('IDX_roster_identity_decision_actor', ['actorUserId'])
export class RosterIdentityDecisionEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The candidate decided on.' })
  @Column({ type: 'uuid', nullable: false })
  candidateId: string;

  @ApiProperty({ description: 'The Fleet, carried for tenancy.' })
  @Column({ type: 'uuid', nullable: false })
  fleetId: string;

  @ApiProperty({
    enum: RosterIdentityDecisionAction,
    description: 'What the reviewer did.',
  })
  @Column({
    type: 'enum',
    enum: RosterIdentityDecisionAction,
    enumName: 'roster_identity_decision_action_enum',
    nullable: false,
  })
  action: RosterIdentityDecisionAction;

  @ApiProperty({
    enum: RosterIdentityCandidateState,
    description: 'Where the candidate stood before.',
  })
  @Column({
    type: 'enum',
    enum: RosterIdentityCandidateState,
    enumName: 'roster_identity_candidate_state_enum',
    nullable: false,
  })
  fromState: RosterIdentityCandidateState;

  @ApiProperty({
    enum: RosterIdentityCandidateState,
    description: 'Where it stood after.',
  })
  @Column({
    type: 'enum',
    enum: RosterIdentityCandidateState,
    enumName: 'roster_identity_candidate_state_enum',
    nullable: false,
  })
  toState: RosterIdentityCandidateState;

  @ApiProperty({ description: 'Which decision on the candidate this was.' })
  @Column({ type: 'integer', nullable: false })
  revision: number;

  @ApiProperty({
    description: 'Who decided, or null once their account is gone.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  actorUserId: string | null;

  @ApiProperty({
    description: 'Why, in the reviewer’s words, if they gave a reason.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  reason: string | null;

  @ApiProperty({ description: 'When it was decided.' })
  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  decidedAt: Date;

  @ApiProperty({ description: 'When the row was written.' })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => RosterIdentityCandidateEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'candidateId' })
  candidate: RosterIdentityCandidateEntity;

  @ManyToOne(() => StoFleetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actorUserId' })
  actor: UserEntity | null;
}
