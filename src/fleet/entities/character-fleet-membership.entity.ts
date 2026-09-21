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

import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import { UserEntity } from 'src/user/entities/user.entity';

import { CharacterFleetMembershipSource } from '../enums/character-fleet-membership-source.enum';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { CharacterFleetProposalEntity } from './character-fleet-proposal.entity';
import { StoFleetEntity } from './sto-fleet.entity';

/**
 * A user's own record that one of their Characters is in a Fleet.
 *
 * The middle of ADR-0002's three independent facts. A roster import is evidence
 * and can propose one of these; an approved `scope_membership` is access. This
 * is neither. It is the owner's personal statement about their own Character,
 * and it is the only one of the three they control outright.
 *
 * One current membership per Character is enforced by a partial unique index on
 * `characterId` where `validTo` is null, not by a service check, because
 * FC-004's second acceptance criterion says "under concurrent writes" and two
 * simultaneous requests would both pass a read-then-write. A Character moving
 * Fleet therefore has to close the open interval in the same transaction as it
 * opens the new one: the index makes a silent overwrite impossible and forces
 * the conflict to surface, which is what plan section 4.2 asks for.
 *
 * Historical intervals may not overlap either. That is a service rule under a
 * Character lock rather than an index, because it is a range property: no
 * constraint can compare a row against the rows it is not. FC-014 enforces it
 * in `CharacterFleetMembershipService`, which takes the lock on the Character
 * before it reads, so two concurrent writes queue rather than interleave.
 *
 * `fleetId` is `RESTRICT`: a Fleet record cannot be hard-deleted out from under
 * someone's personal history.
 */
@Entity({ name: 'character_fleet_membership' })
@Index('UX_character_fleet_membership_open', ['characterId'], {
  unique: true,
  where: '"validTo" IS NULL AND "deletedAt" IS NULL',
})
@Index('IDX_character_fleet_membership_character_from', [
  'characterId',
  'validFrom',
])
@Index('IDX_character_fleet_membership_fleet_from', ['fleetId', 'validFrom'])
export class CharacterFleetMembershipEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Character this is about.' })
  @Column({ type: 'uuid', nullable: false })
  characterId: string;

  @ApiProperty({ description: 'The Fleet they were in.' })
  @Column({ type: 'uuid', nullable: false })
  fleetId: string;

  @ApiProperty({ description: 'When the membership began.' })
  @Column({ type: 'timestamptz', nullable: false })
  validFrom: Date;

  @ApiProperty({
    description: 'When it ended, or null while current.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  validTo: Date | null;

  @ApiProperty({
    enum: CharacterFleetMembershipSource,
    description: 'What established the association.',
  })
  @Column({
    type: 'enum',
    enum: CharacterFleetMembershipSource,
    enumName: 'character_fleet_membership_source_enum',
    default: CharacterFleetMembershipSource.MANUAL,
  })
  source: CharacterFleetMembershipSource;

  /**
   * The proposal the owner accepted to open this, when one did.
   *
   * This is the join that makes {@link CharacterFleetMembershipSource.CONFIRMED_IMPORT}
   * checkable rather than merely claimed: a membership recorded from evidence
   * cites the question that was asked, and a constraint refuses that source
   * without one. A membership the owner recorded directly has none, which is
   * why the column is nullable rather than the site inventing a proposal it
   * then answers on their behalf.
   *
   * `RESTRICT`, like `fleetId`: the answer outlives nothing it was an answer
   * to.
   */
  @ApiProperty({
    description: 'The proposal this was accepted from, if any.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  proposalId: string | null;

  /**
   * Who may see that this Character is in this Fleet.
   *
   * Defaults to `PRIVATE`. Recording your own Character's Fleet must not
   * publish it, so the safe value is the default and widening it is a
   * deliberate act.
   */
  @ApiProperty({
    enum: FleetAudience,
    description: 'Who may see this association.',
  })
  @Column({
    type: 'enum',
    enum: FleetAudience,
    enumName: 'fleet_audience_enum',
    default: FleetAudience.PRIVATE,
  })
  visibility: FleetAudience;

  @ApiProperty({ description: 'Who recorded it.', nullable: true })
  @Column({ type: 'uuid', nullable: true, default: null })
  actorUserId: string | null;

  @ApiProperty({ description: 'When it was recorded.' })
  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  recordedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt: Date | null;

  @ManyToOne(() => CharacterEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'characterId' })
  character: CharacterEntity;

  @ManyToOne(() => StoFleetEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity;

  @ManyToOne(() => CharacterFleetProposalEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'proposalId' })
  proposal: CharacterFleetProposalEntity | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actorUserId' })
  actor: UserEntity | null;
}
