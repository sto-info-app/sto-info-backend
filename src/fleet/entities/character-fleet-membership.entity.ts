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
 * Character lock rather than an index, because it is a range property, and it
 * belongs to FC-014 along with `character_fleet_proposal` and the `proposalId`
 * column that will reference it.
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

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actorUserId' })
  actor: UserEntity | null;
}
