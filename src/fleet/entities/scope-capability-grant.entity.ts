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
import { ScopeCapabilityEffect } from '../enums/scope-capability-effect.enum';
import { FleetCommunityEntity } from './fleet-community.entity';
import { StoArmadaEntity } from './sto-armada.entity';
import { StoFleetEntity } from './sto-fleet.entity';

/**
 * One granular capability, added to or taken away from a subject at one scope.
 *
 * This is the "audited settings surface" of plan section 4.3, expressed as
 * data. Without it, "Officer capabilities are delegated" would have nowhere to
 * record the delegation, and the four fixed labels would have to carry fixed
 * capability sets — which is precisely the arrangement the plan rejects, since
 * it forces an Owner to hand somebody roster imports in order to let them post
 * news.
 *
 * **The subject is either a role label or an individual, never both.** A grant
 * to `OFFICER` says what Officers at this scope may do; a grant to a user says
 * what that person may do regardless of their label. Both shapes are needed:
 * the first is how an Owner configures a Fleet, the second is how one Officer
 * is trusted with transcripts without every Officer being trusted with them.
 * The mirror of the site-wide model is deliberate — role-derived permissions
 * plus per-user overrides — so the two systems read the same way even though
 * they share no rows.
 *
 * **`DENY` wins, always.** It beats the role baseline, it beats a `GRANT` to
 * the same person at a wider scope, and it is not overridable by a label. That
 * is FC-005's first acceptance criterion, and the reason it is an effect column
 * rather than a delete: withdrawing a capability from one Officer must not
 * require removing their role or inventing a role for them.
 *
 * Grants are temporal in the same way role assignments are, so a capability
 * that has been withdrawn leaves its history behind and "who could export that
 * transcript in March" stays answerable.
 *
 * The open-grant indexes are unique **without** the effect column. Allowing an
 * open `GRANT` and an open `DENY` for the same subject and capability would
 * store a contradiction and leave the resolver to break the tie silently; the
 * database refuses the second row instead, so the contradiction has to be
 * resolved by whoever is making the change.
 */
@Entity({ name: 'scope_capability_grant' })
@Index(
  'UX_scope_capability_grant_open_community_user',
  ['communityId', 'subjectUserId', 'capability'],
  {
    unique: true,
    where:
      '"fleetId" IS NULL AND "armadaId" IS NULL AND "subjectUserId" IS NOT NULL AND "validTo" IS NULL AND "deletedAt" IS NULL',
  },
)
@Index(
  'UX_scope_capability_grant_open_community_role',
  ['communityId', 'subjectRole', 'capability'],
  {
    unique: true,
    where:
      '"fleetId" IS NULL AND "armadaId" IS NULL AND "subjectRole" IS NOT NULL AND "validTo" IS NULL AND "deletedAt" IS NULL',
  },
)
@Index(
  'UX_scope_capability_grant_open_fleet_user',
  ['fleetId', 'subjectUserId', 'capability'],
  {
    unique: true,
    where:
      '"fleetId" IS NOT NULL AND "subjectUserId" IS NOT NULL AND "validTo" IS NULL AND "deletedAt" IS NULL',
  },
)
@Index(
  'UX_scope_capability_grant_open_fleet_role',
  ['fleetId', 'subjectRole', 'capability'],
  {
    unique: true,
    where:
      '"fleetId" IS NOT NULL AND "subjectRole" IS NOT NULL AND "validTo" IS NULL AND "deletedAt" IS NULL',
  },
)
@Index(
  'UX_scope_capability_grant_open_armada_user',
  ['armadaId', 'subjectUserId', 'capability'],
  {
    unique: true,
    where:
      '"armadaId" IS NOT NULL AND "subjectUserId" IS NOT NULL AND "validTo" IS NULL AND "deletedAt" IS NULL',
  },
)
@Index(
  'UX_scope_capability_grant_open_armada_role',
  ['armadaId', 'subjectRole', 'capability'],
  {
    unique: true,
    where:
      '"armadaId" IS NOT NULL AND "subjectRole" IS NOT NULL AND "validTo" IS NULL AND "deletedAt" IS NULL',
  },
)
@Index('IDX_scope_capability_grant_subject_user', ['subjectUserId'])
@Index('IDX_scope_capability_grant_community', ['communityId'])
export class ScopeCapabilityGrantEntity {
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

  @ApiProperty({
    description: 'The individual the grant is about, when it names one.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  subjectUserId: string | null;

  @ApiProperty({
    enum: FleetScopeRole,
    description: 'The role label the grant is about, when it names one.',
    nullable: true,
  })
  @Column({
    type: 'enum',
    enum: FleetScopeRole,
    enumName: 'fleet_scope_role_enum',
    nullable: true,
    default: null,
  })
  subjectRole: FleetScopeRole | null;

  /**
   * The capability code, as a plain string.
   *
   * Not a PostgreSQL enum, unlike every other categorical column in this
   * feature. The set of capabilities is expected to grow with each workstream,
   * and an enum type would make adding one a migration that rewrites a column
   * default across a live table. The code is validated against
   * {@link FLEET_CAPABILITIES} in the service, and an unrecognised code in a
   * row confers nothing, so an obsolete grant is inert rather than dangerous.
   */
  @ApiProperty({ description: 'The scoped capability code.' })
  @Column({ type: 'varchar', length: 100, nullable: false })
  capability: string;

  @ApiProperty({
    enum: ScopeCapabilityEffect,
    description: 'Whether the capability is added or taken away.',
  })
  @Column({
    type: 'enum',
    enum: ScopeCapabilityEffect,
    enumName: 'scope_capability_effect_enum',
  })
  effect: ScopeCapabilityEffect;

  @ApiProperty({ description: 'When the grant took effect.' })
  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  validFrom: Date;

  @ApiProperty({
    description: 'When it ended, or null while it stands.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  validTo: Date | null;

  @ApiProperty({ description: 'Who made the change.', nullable: true })
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

  /**
   * Joined on the Fleet ID alone.
   *
   * The constraint in the migration is the composite `(fleetId, communityId)`
   * against `sto_fleet (id, communityId)`, as everywhere else in this feature,
   * so a grant cannot name another Community's Fleet.
   */
  @ManyToOne(() => StoFleetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity | null;

  /** Joined on the Armada ID; the composite constraint is in the migration. */
  @ManyToOne(() => StoArmadaEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'armadaId' })
  armada: StoArmadaEntity | null;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subjectUserId' })
  subjectUser: UserEntity | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'grantedByUserId' })
  grantedBy: UserEntity | null;
}
