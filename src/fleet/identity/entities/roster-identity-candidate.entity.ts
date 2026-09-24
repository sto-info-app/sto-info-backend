import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { RosterImportSourceEntity } from '../../imports/entities/roster-import-source.entity';
import { RosterIdentityCandidateKind } from '../enums/roster-identity-candidate-kind.enum';
import { RosterIdentityCandidateState } from '../enums/roster-identity-candidate-state.enum';
import { RosterIdentityCollisionReason } from '../enums/roster-identity-collision-reason.enum';
import { RosterIdentityConfidence } from '../enums/roster-identity-confidence.enum';
import { RosterIdentitySignal } from '../enums/roster-identity-signal.enum';
import { RosterIdentityAliasEntity } from './roster-identity-alias.entity';
import { RosterIdentityCandidateLinkEntity } from './roster-identity-candidate-link.entity';

/**
 * One corroborating check and how it came out.
 *
 * `held` is null where the check could not be made, such as a rank change
 * date missing from either row. For an account rename it is the combined
 * answer across every Character the candidate cites: false if any of them
 * failed, null if none of them could be checked.
 */
export interface RosterIdentitySignalResult {
  /** Which check. */
  readonly signal: RosterIdentitySignal;
  /** Whether it held, or null where it could not be checked. */
  readonly held: boolean | null;
}

/**
 * A rename the evidence suggests, and where a reviewer has left it.
 *
 * Raised by comparing each pair of consecutive in-force exports of a Fleet,
 * never by a single row: plan section 3.6 and FC-018's first acceptance
 * criterion forbid a merge on a join date or a name alone, so a candidate
 * exists only where one row vanished, another appeared, and everything else
 * they say agrees.
 *
 * ## Never merged without a person
 *
 * However high its confidence, a candidate changes nothing until somebody
 * with `roster.investigate` confirms it, and a confirmed account rename never
 * touches an STO Info account handle. What confirming does is join aliases
 * into one identity, which the recompute works out afresh each time from the
 * confirmed candidates' links.
 *
 * ## Recomputed, not accumulated
 *
 * An open candidate that the evidence no longer produces — because an older
 * export imported later now sits between the two it compared — is removed. A
 * decided one is kept, because somebody decided it, and marked `stale` so a
 * reviewer knows to look again; Steve's decision of 24 September 2026. Its
 * links and collision reasons are frozen at the decision, so the stale flag
 * compares what was decided with what the evidence now says.
 */
@Entity({ name: 'fleet_roster_identity_candidate' })
@Index(
  'UX_roster_identity_candidate_character',
  ['fleetId', 'fromAliasId', 'toAliasId'],
  { unique: true, where: `"kind" = 'CHARACTER_RENAME'` },
)
@Index(
  'UX_roster_identity_candidate_account',
  ['fleetId', 'fromHandleNormalised', 'toHandleNormalised'],
  { unique: true, where: `"kind" = 'ACCOUNT_RENAME'` },
)
@Index('IDX_roster_identity_candidate_fleet_state', ['fleetId', 'state'])
@Index('IDX_roster_identity_candidate_earlier', ['earlierImportId'])
@Index('IDX_roster_identity_candidate_later', ['laterImportId'])
export class RosterIdentityCandidateEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Fleet whose exports suggested it.' })
  @Column({ type: 'uuid', nullable: false })
  fleetId: string;

  @ApiProperty({
    enum: RosterIdentityCandidateKind,
    description: 'Whether the Character name or the account handle changed.',
  })
  @Column({
    type: 'enum',
    enum: RosterIdentityCandidateKind,
    enumName: 'roster_identity_candidate_kind_enum',
    nullable: false,
  })
  kind: RosterIdentityCandidateKind;

  @ApiProperty({
    enum: RosterIdentityCandidateState,
    description: 'Where a reviewer has left it.',
  })
  @Column({
    type: 'enum',
    enum: RosterIdentityCandidateState,
    enumName: 'roster_identity_candidate_state_enum',
    default: RosterIdentityCandidateState.OPEN,
  })
  state: RosterIdentityCandidateState;

  @ApiProperty({
    description: 'For a Character rename, the name that vanished.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  fromAliasId: string | null;

  @ApiProperty({
    description: 'For a Character rename, the name that appeared.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  toAliasId: string | null;

  @ApiProperty({
    description: 'For an account rename, the handle that vanished.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 255, nullable: true, default: null })
  fromHandleNormalised: string | null;

  @ApiProperty({
    description: 'For an account rename, the handle that appeared.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 255, nullable: true, default: null })
  toHandleNormalised: string | null;

  @ApiProperty({ description: 'The export the old name was last seen in.' })
  @Column({ type: 'uuid', nullable: false })
  earlierImportId: string;

  @ApiProperty({ description: 'The export the new name was first seen in.' })
  @Column({ type: 'uuid', nullable: false })
  laterImportId: string;

  @ApiProperty({
    enum: RosterIdentityConfidence,
    description: 'How much of the corroborating evidence held.',
  })
  @Column({
    type: 'enum',
    enum: RosterIdentityConfidence,
    enumName: 'roster_identity_confidence_enum',
    nullable: false,
  })
  confidence: RosterIdentityConfidence;

  @ApiProperty({
    description: 'Each corroborating check, and how it came out.',
  })
  @Column({ type: 'jsonb', nullable: false })
  signals: RosterIdentitySignalResult[];

  @ApiProperty({
    enum: RosterIdentityCollisionReason,
    isArray: true,
    description:
      'Why it cannot be resolved. Empty for a candidate a reviewer may decide.',
  })
  @Column({
    type: 'enum',
    enum: RosterIdentityCollisionReason,
    enumName: 'roster_identity_collision_reason_enum',
    array: true,
    default: '{}',
  })
  collisionReasons: RosterIdentityCollisionReason[];

  @ApiProperty({
    description:
      'Whether the evidence has changed since it was decided, so that a ' +
      'reviewer should look again.',
  })
  @Column({ type: 'boolean', nullable: false, default: false })
  stale: boolean;

  @ApiProperty({
    description:
      'How many decisions have been taken on it. A decision names the ' +
      'revision it expects, so two reviewers cannot both take the next one.',
  })
  @Column({ type: 'integer', nullable: false, default: 0 })
  revision: number;

  @ApiProperty({ description: 'When it was first suggested.' })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ description: 'When the row was last touched.' })
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => StoFleetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity;

  @ManyToOne(() => RosterIdentityAliasEntity, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'fromAliasId', referencedColumnName: 'id' },
    { name: 'fleetId', referencedColumnName: 'fleetId' },
  ])
  fromAlias: RosterIdentityAliasEntity | null;

  @ManyToOne(() => RosterIdentityAliasEntity, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'toAliasId', referencedColumnName: 'id' },
    { name: 'fleetId', referencedColumnName: 'fleetId' },
  ])
  toAlias: RosterIdentityAliasEntity | null;

  @ManyToOne(() => RosterImportSourceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'earlierImportId' })
  earlierImport: RosterImportSourceEntity;

  @ManyToOne(() => RosterImportSourceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'laterImportId' })
  laterImport: RosterImportSourceEntity;

  @OneToMany(() => RosterIdentityCandidateLinkEntity, link => link.candidate)
  links: RosterIdentityCandidateLinkEntity[];
}
