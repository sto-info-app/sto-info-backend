import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

import { RosterEpisodeEnd } from '../enums/roster-episode-end.enum';
import { RosterEpisodeStart } from '../enums/roster-episode-start.enum';

/**
 * One stretch of one roster identity's membership, as a projection revision
 * reads it from the Fleet's exports (FC-019).
 *
 * Derived and rebuildable. Its dates are bounds, never events: it began
 * after `startedAfterAt`, if known, and by `firstObservedAt`; it ended after
 * `lastObservedAt` and by `endedBefore`, if it has ended.
 *
 * Relations are left out on purpose. Every row is written in bulk by the
 * replay and read by revision; the keys the migration declares are what hold
 * it to its Fleet, identity and imports.
 */
@Entity({ name: 'fleet_roster_episode' })
@Unique('UQ_roster_episode_ordinal', [
  'fleetId',
  'revision',
  'identityId',
  'ordinal',
])
@Index('IDX_roster_episode_span', [
  'fleetId',
  'revision',
  'firstObservedAt',
  'lastObservedAt',
])
@Index('IDX_roster_episode_identity', ['identityId'])
export class RosterEpisodeEntity {
  @ApiProperty({ description: 'Unique identifier, new in every revision.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Fleet.' })
  @Column({ type: 'uuid', nullable: false })
  fleetId: string;

  @ApiProperty({ description: 'The projection revision it belongs to.' })
  @Column({ type: 'integer', nullable: false })
  revision: number;

  @ApiProperty({ description: 'The roster identity.' })
  @Column({ type: 'uuid', nullable: false })
  identityId: string;

  @ApiProperty({ description: 'Which of the identity’s episodes, from one.' })
  @Column({ type: 'integer', nullable: false })
  ordinal: number;

  @ApiProperty({
    enum: RosterEpisodeStart,
    description: 'How it is known to have begun.',
  })
  @Column({
    type: 'enum',
    enum: RosterEpisodeStart,
    enumName: 'roster_episode_start_enum',
    nullable: false,
  })
  startKind: RosterEpisodeStart;

  @ApiProperty({
    description: 'The latest export known not to list them before it.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  startedAfterImportId: string | null;

  @ApiProperty({ description: 'That export’s instant.', nullable: true })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  startedAfterAt: Date | null;

  @ApiProperty({ description: 'The first export that listed them in it.' })
  @Column({ type: 'uuid', nullable: false })
  firstImportId: string;

  @ApiProperty({ description: 'That export’s instant.' })
  @Column({ type: 'timestamptz', nullable: false })
  firstObservedAt: Date;

  @ApiProperty({
    description: 'The Join Date the game reported on that first export.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  reportedJoinedAt: Date | null;

  @ApiProperty({ description: 'Whether that Join Date was one of two.' })
  @Column({ type: 'boolean', nullable: false })
  reportedJoinedAtAmbiguous: boolean;

  @ApiProperty({ description: 'The last export that listed them in it.' })
  @Column({ type: 'uuid', nullable: false })
  lastImportId: string;

  @ApiProperty({ description: 'That export’s instant.' })
  @Column({ type: 'timestamptz', nullable: false })
  lastObservedAt: Date;

  @ApiProperty({
    enum: RosterEpisodeEnd,
    description: 'How it is known to have ended, or null while open.',
    nullable: true,
  })
  @Column({
    type: 'enum',
    enum: RosterEpisodeEnd,
    enumName: 'roster_episode_end_enum',
    nullable: true,
    default: null,
  })
  endKind: RosterEpisodeEnd | null;

  @ApiProperty({
    description: 'The instant it had ended by, or null while open.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  endedBefore: Date | null;

  @ApiProperty({
    description: 'For LEFT, the complete export that did not list them.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  endedBeforeImportId: string | null;

  @ApiProperty({
    description: 'The first cumulative contribution known in it.',
    nullable: true,
  })
  @Column({ type: 'bigint', nullable: true, default: null })
  baselineContribution: string | null;

  @ApiProperty({
    description:
      'The last cumulative contribution observed in it — never a final ' +
      'total, which for a leaver is unknown.',
    nullable: true,
  })
  @Column({ type: 'bigint', nullable: true, default: null })
  lastObservedContribution: string | null;
}
