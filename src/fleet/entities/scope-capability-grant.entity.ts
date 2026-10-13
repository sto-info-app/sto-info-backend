import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { UserEntity } from 'src/user/entities/user.entity';

import { FleetScopeRole } from '../enums/fleet-scope-role.enum';
import { ScopeCapabilityEffect } from '../enums/scope-capability-effect.enum';
import { TemporalScopeGrantEntity } from './temporal-scope-grant.entity';

/**
 * Where an open grant can sit, and the predicate that selects rows there.
 *
 * A Community-level grant is one with neither child set; a Fleet or an Armada
 * grant is one with that child set.
 */
const OPEN_GRANT_SCOPES = [
  {
    scope: 'community',
    column: 'communityId',
    where: '"fleetId" IS NULL AND "armadaId" IS NULL',
  },
  { scope: 'fleet', column: 'fleetId', where: '"fleetId" IS NOT NULL' },
  { scope: 'armada', column: 'armadaId', where: '"armadaId" IS NOT NULL' },
] as const;

/** Who an open grant can be about: one individual, or one role label. */
const OPEN_GRANT_SUBJECTS = [
  { subject: 'user', column: 'subjectUserId' },
  { subject: 'role', column: 'subjectRole' },
] as const;

/**
 * Declares the six partial unique indexes allowing one open grant per scope,
 * subject and capability — one for each scope and kind of subject.
 *
 * @returns The class decorator applying all six.
 */
function OpenGrantIndexes(): ClassDecorator {
  return applyDecorators(
    ...OPEN_GRANT_SCOPES.flatMap(({ scope, column, where }) =>
      OPEN_GRANT_SUBJECTS.map(subject =>
        Index(
          `UX_scope_capability_grant_open_${scope}_${subject.subject}`,
          [column, subject.column, 'capability'],
          {
            unique: true,
            where: `${where} AND "${subject.column}" IS NOT NULL AND "validTo" IS NULL AND "deletedAt" IS NULL`,
          },
        ),
      ),
    ),
  );
}

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
 *
 * The scope columns, validity period, dates and scope relations come from
 * {@link TemporalScopeGrantEntity}.
 */
@Entity({ name: 'scope_capability_grant' })
@OpenGrantIndexes()
@Index('IDX_scope_capability_grant_subject_user', ['subjectUserId'])
@Index('IDX_scope_capability_grant_community', ['communityId'])
export class ScopeCapabilityGrantEntity extends TemporalScopeGrantEntity {
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

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subjectUserId' })
  subjectUser: UserEntity | null;
}
