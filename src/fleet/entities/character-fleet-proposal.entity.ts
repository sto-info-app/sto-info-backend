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

import { CharacterFleetProposalStatus } from '../enums/character-fleet-proposal-status.enum';
import { StoFleetEntity } from './sto-fleet.entity';

/**
 * A suggestion, awaiting the Character owner's answer, that one of their
 * Characters is in a Fleet.
 *
 * The gap ADR-0002 leaves open between evidence and a personal record. A
 * roster import is evidence that somebody by that name is in a Fleet; a
 * `character_fleet_membership` is the owner's own statement that it is their
 * Character. Nothing may turn the first into the second on its own, so this
 * table is where a suggestion waits for the only person entitled to answer it.
 *
 * ## Nothing here raises one yet
 *
 * FC-014 owns the table, the answer and the routes. What produces proposals
 * from roster evidence is FC-018, which has the identity and confidence work
 * to decide when a row is worth asking about at all. Building the answer first
 * is deliberate: a proposal nobody can decline is worse than no proposal, and
 * the acceptance rules are the part that has to be right before anything
 * starts generating them.
 *
 * ## Competing proposals
 *
 * Two Fleets may hold a pending proposal for the same Character at once, and
 * answering one does not answer the other. That is FC-014's third acceptance
 * criterion and it is the honest model: a Character genuinely may have been in
 * both, at different times, and the site deciding on the owner's behalf which
 * of the two to discard would be the CSV silently choosing a Fleet by another
 * route. What a Fleet may not do is stack duplicates — the unique index allows
 * it one unanswered proposal per Character.
 *
 * ## Expiry is a date, not a status
 *
 * `expiresAt` is set when the proposal is raised and never swept. A status
 * column meaning "expired" is wrong from the moment it lapses until a job next
 * runs, and an outage would leave dead proposals answerable; reading the date
 * cannot be stale. {@link CharacterFleetProposalStatus} therefore holds only
 * things a person did.
 *
 * `fleetId` is `RESTRICT`, as on the membership: a Fleet record cannot be
 * hard-deleted out from under a question somebody has been asked.
 */
@Entity({ name: 'character_fleet_proposal' })
@Index('UX_character_fleet_proposal_open', ['characterId', 'fleetId'], {
  unique: true,
  where: `"status" = 'PENDING' AND "deletedAt" IS NULL`,
})
@Index('IDX_character_fleet_proposal_character_status', [
  'characterId',
  'status',
])
@Index('IDX_character_fleet_proposal_fleet_raised', ['fleetId', 'raisedAt'])
export class CharacterFleetProposalEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Character the proposal is about.' })
  @Column({ type: 'uuid', nullable: false })
  characterId: string;

  @ApiProperty({ description: 'The Fleet it says they are in.' })
  @Column({ type: 'uuid', nullable: false })
  fleetId: string;

  @ApiProperty({
    enum: CharacterFleetProposalStatus,
    description: 'What the owner has done about it, if anything.',
  })
  @Column({
    type: 'enum',
    enum: CharacterFleetProposalStatus,
    enumName: 'character_fleet_proposal_status_enum',
    default: CharacterFleetProposalStatus.PENDING,
  })
  status: CharacterFleetProposalStatus;

  /**
   * When the Fleet's roster said the Character was in it.
   *
   * The instant the proposal claims, which is not the instant it was raised:
   * an import processed today may describe an export taken last month, and the
   * membership it opens has to begin when the fact was true rather than when
   * the site noticed. Null while nothing here raises proposals from evidence;
   * accepting one without it begins the membership now.
   */
  @ApiProperty({
    description: 'When the evidence says the association was true.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  observedAt: Date | null;

  @ApiProperty({ description: 'When the proposal was raised.' })
  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  raisedAt: Date;

  /**
   * When it stops being answerable.
   *
   * Read rather than swept — see the class note. Ninety days, from
   * `CHARACTER_FLEET_PROPOSAL_EXPIRY_DAYS`.
   */
  @ApiProperty({ description: 'When it stops being answerable.' })
  @Column({ type: 'timestamptz', nullable: false })
  expiresAt: Date;

  /**
   * Who raised it, when a person did.
   *
   * Null for a proposal drawn from roster evidence, because no person decided
   * it. That is the usual case rather than the exception, which is why the
   * column is nullable rather than the answer being a synthetic system user.
   */
  @ApiProperty({
    description: 'Who raised it, if a person did.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  proposedByUserId: string | null;

  @ApiProperty({
    description: 'When the owner answered, or null while unanswered.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  answeredAt: Date | null;

  @ApiProperty({
    description: 'Who answered it. The Character owner, or null if unanswered.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  answeredByUserId: string | null;

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

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'proposedByUserId' })
  proposedBy: UserEntity | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'answeredByUserId' })
  answeredBy: UserEntity | null;
}
