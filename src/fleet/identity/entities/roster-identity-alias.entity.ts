import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { RosterIdentityEntity } from './roster-identity.entity';

/**
 * One exact Character name and account handle a Fleet's roster has used.
 *
 * The join between evidence and identity. An observation carries the
 * normalised name and handle it was read with, and the alias with the same
 * two, in the same Fleet, says which identity that observation is of. Nothing
 * is written to the observation itself, by Steve's decision of 24 September
 * 2026, so changing who an alias belongs to is one row rather than every
 * export the Fleet ever imported.
 *
 * ## Two identities, one of which never changes
 *
 * `originIdentityId` is the identity the alias was born with, one to one and
 * fixed. `identityId` is the one it belongs to now, recomputed from the
 * confirmed renames. Before any rename is confirmed the two are equal; after
 * one, several aliases point at one identity; and after the confirmation is
 * undone each goes back to its origin. That is what makes a merge reversible
 * without the site having to remember what it merged.
 *
 * ## Names as first seen
 *
 * `characterName` and `accountHandle` are the spelling of the first
 * observation that made the alias. Later ones may differ in case, since they
 * share the normalised key; which of them is shown is a display choice, and
 * the observations keep every spelling.
 */
@Entity({ name: 'fleet_roster_identity_alias' })
@Unique('UQ_roster_identity_alias_tenancy', ['id', 'fleetId'])
@Unique('UQ_roster_identity_alias_origin', ['originIdentityId'])
@Index(
  'UX_roster_identity_alias_key',
  ['fleetId', 'characterNameNormalised', 'accountHandleNormalised'],
  { unique: true },
)
@Index('IDX_roster_identity_alias_identity', ['identityId'])
export class RosterIdentityAliasEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Fleet whose roster used this name.' })
  @Column({ type: 'uuid', nullable: false })
  fleetId: string;

  @ApiProperty({ description: 'The identity this alias belongs to now.' })
  @Column({ type: 'uuid', nullable: false })
  identityId: string;

  @ApiProperty({
    description:
      'The identity this alias was first recorded under, and returns to ' +
      'when a rename that joined it to another is undone.',
  })
  @Column({ type: 'uuid', nullable: false })
  originIdentityId: string;

  @ApiProperty({ description: 'The Character name, as first exported.' })
  @Column({ type: 'varchar', length: 255, nullable: false })
  characterName: string;

  @ApiProperty({ description: 'The Character name, normalised for matching.' })
  @Column({ type: 'varchar', length: 255, nullable: false })
  characterNameNormalised: string;

  @ApiProperty({ description: 'The account handle, as first exported.' })
  @Column({ type: 'varchar', length: 255, nullable: false })
  accountHandle: string;

  @ApiProperty({ description: 'The account handle, normalised for matching.' })
  @Column({ type: 'varchar', length: 255, nullable: false })
  accountHandleNormalised: string;

  @ApiProperty({
    description:
      'The export instant of the earliest in-force import listing this ' +
      'name, or null while no in-force import does.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  firstObservedAt: Date | null;

  @ApiProperty({
    description:
      'The export instant of the latest in-force import listing this name, ' +
      'or null while no in-force import does.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  lastObservedAt: Date | null;

  @ApiProperty({ description: 'When the alias was first recorded.' })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ description: 'When the row was last touched.' })
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => StoFleetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity;

  @ManyToOne(() => RosterIdentityEntity, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'identityId', referencedColumnName: 'id' },
    { name: 'fleetId', referencedColumnName: 'fleetId' },
  ])
  identity: RosterIdentityEntity;

  @ManyToOne(() => RosterIdentityEntity, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'originIdentityId', referencedColumnName: 'id' },
    { name: 'fleetId', referencedColumnName: 'fleetId' },
  ])
  originIdentity: RosterIdentityEntity;
}
