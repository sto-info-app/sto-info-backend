import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { RosterProfession } from '../enums/roster-profession.enum';
import { RosterImportSourceEntity } from './roster-import-source.entity';

/**
 * What one roster export said about one member.
 *
 * An observation, not a member. It records a Character name and an account
 * handle as one export wrote them on one date, and two rows agreeing are two
 * observations rather than one person: FC-018 builds identity on top of
 * these, from evidence and reversibly. Nothing here links to a user or to a
 * Character, because an observation that had already decided who it was
 * about could not be revisited when the decision turned out to be wrong.
 *
 * Every date keeps three things — the local text as the file wrote it, the
 * instant it was read as, and whether that instant was one of two. The text
 * is the observation and the instant is an interpretation through a zone
 * somebody supplied; a zone supplied wrongly is correctable only while the
 * text it was applied to still exists.
 *
 * Whether an import counts is not recorded here. That is its asset
 * placement's job: `file_asset_placement` already models
 * accepted-not-yet-in-force and in-force, with the partial unique index that
 * makes one effective import at a time a database rule.
 */
@Entity({ name: 'fleet_roster_observation' })
@Index('IDX_roster_observation_import_line', ['importSourceId', 'line'])
@Index('IDX_roster_observation_fleet_account', [
  'fleetId',
  'accountHandleNormalised',
])
export class RosterObservationEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The import this row was read from.' })
  @Column({ type: 'uuid', nullable: false })
  importSourceId: string;

  @ApiProperty({
    description:
      'The Fleet the export was of. Carried here as well as on the import ' +
      'so that no read of a Fleet’s roster history depends on a join to ' +
      'reach its own tenancy.',
  })
  @Column({ type: 'uuid', nullable: false })
  fleetId: string;

  @ApiProperty({
    description:
      'Which line of the sanitised file this came from, with the header as ' +
      'line one. The only way back from a row to the bytes it was read out ' +
      'of, once those bytes are all that is kept.',
  })
  @Column({ type: 'integer', nullable: false })
  line: number;

  @ApiProperty({ description: 'The Character’s name, exactly as exported.' })
  @Column({ type: 'varchar', length: 255, nullable: false })
  characterName: string;

  @ApiProperty({
    description:
      'The same name, case-folded and trimmed, for matching. Never shown ' +
      'and never the thing displayed: a name is evidence in the form it was ' +
      'written in.',
  })
  @Column({ type: 'varchar', length: 255, nullable: false })
  characterNameNormalised: string;

  @ApiProperty({ description: 'The account handle, exactly as exported.' })
  @Column({ type: 'varchar', length: 255, nullable: false })
  accountHandle: string;

  @ApiProperty({ description: 'The same handle, case-folded and trimmed.' })
  @Column({ type: 'varchar', length: 255, nullable: false })
  accountHandleNormalised: string;

  @ApiProperty({ description: 'The Character’s level.' })
  @Column({ type: 'integer', nullable: false })
  level: number;

  @ApiProperty({
    description:
      'The Class value, exactly as exported. Never replaced by the ' +
      'profession read out of it: the export writes a career-and-rank ' +
      'phrase, and the phrase is what was observed.',
  })
  @Column({ type: 'varchar', length: 255, nullable: false })
  className: string;

  @ApiProperty({
    description: 'The profession read out of that phrase, where one could be.',
    enum: RosterProfession,
    nullable: true,
  })
  @Column({
    type: 'enum',
    enum: RosterProfession,
    enumName: 'roster_profession_enum',
    nullable: true,
    default: null,
  })
  profession: RosterProfession | null;

  @ApiProperty({
    description:
      'The Fleet’s own label for this member’s rank. Fleets rename their ' +
      'ranks freely, so this is text and never an enumeration.',
  })
  @Column({ type: 'varchar', length: 255, nullable: false })
  guildRank: string;

  @ApiProperty({
    description:
      'The cumulative contribution figure. A running total, never a delta: ' +
      'a difference between two imports is computed and not stored.',
  })
  @Column({ type: 'bigint', nullable: false })
  contributionTotal: string;

  @ApiProperty({
    description: 'When the game says this Character joined, as written.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 19, nullable: true, default: null })
  joinedAtLocal: string | null;

  @ApiProperty({
    description: 'The same moment, read through the export’s timezone.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  joinedAt: Date | null;

  @ApiProperty({
    description:
      'Whether that reading was one of two, on the morning a clock went ' +
      'back. The earlier instant is recorded; this says the choice existed.',
  })
  @Column({ type: 'boolean', nullable: false, default: false })
  joinedAtAmbiguous: boolean;

  @ApiProperty({
    description: 'When the game says their rank last changed, as written.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 19, nullable: true, default: null })
  rankChangedAtLocal: string | null;

  @ApiProperty({
    description: 'The same moment, read through the export’s timezone.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  rankChangedAt: Date | null;

  @ApiProperty({ description: 'Whether that reading was one of two.' })
  @Column({ type: 'boolean', nullable: false, default: false })
  rankChangedAtAmbiguous: boolean;

  @ApiProperty({
    description: 'When the game last saw them, as written.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 19, nullable: true, default: null })
  lastActiveAtLocal: string | null;

  @ApiProperty({
    description: 'The same moment, read through the export’s timezone.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  lastActiveAt: Date | null;

  @ApiProperty({ description: 'Whether that reading was one of two.' })
  @Column({ type: 'boolean', nullable: false, default: false })
  lastActiveAtAmbiguous: boolean;

  @ApiProperty({
    description: 'The member’s status text, exactly as exported.',
  })
  @Column({ type: 'varchar', length: 255, nullable: false })
  status: string;

  @ApiProperty({
    description:
      'The member’s public comment, exactly as exported. Text rather than a ' +
      'bounded column: it is the one place a long value is something ' +
      'somebody wrote rather than a sign of tampering.',
  })
  @Column({ type: 'text', nullable: false })
  publicComment: string;

  @ApiProperty({
    description: 'When that comment was last edited, as written.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 19, nullable: true, default: null })
  publicCommentEditedAtLocal: string | null;

  @ApiProperty({
    description: 'The same moment, read through the export’s timezone.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  publicCommentEditedAt: Date | null;

  @ApiProperty({ description: 'Whether that reading was one of two.' })
  @Column({ type: 'boolean', nullable: false, default: false })
  publicCommentEditedAtAmbiguous: boolean;

  @ApiProperty({ description: 'When the row was written.' })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ description: 'When the row was last touched.' })
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => RosterImportSourceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'importSourceId' })
  importSource: RosterImportSourceEntity;

  @ManyToOne(() => StoFleetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity;
}
