import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, PrimaryColumn, Unique } from 'typeorm';

/**
 * What happened between two consecutive effective exports of a Fleet, as a
 * projection revision reads it (FC-019).
 *
 * Derived and rebuildable. Only changes lying within the interval are
 * counted in it; one bounded more widely is counted in `acrossGap` and in no
 * interval's other totals, so no delta is ever allocated to an interval it
 * may not belong to. The four contribution counts account for every member
 * listed at either end exactly once.
 */
@Entity({ name: 'fleet_roster_interval_summary' })
@Unique('UQ_roster_interval_summary_to', ['fleetId', 'revision', 'toAt'])
export class RosterIntervalSummaryEntity {
  @ApiProperty({ description: 'The Fleet.' })
  @PrimaryColumn({ type: 'uuid' })
  fleetId: string;

  @ApiProperty({ description: 'The projection revision it belongs to.' })
  @PrimaryColumn({ type: 'integer' })
  revision: number;

  @ApiProperty({ description: 'The earlier export.' })
  @PrimaryColumn({ type: 'uuid' })
  fromImportId: string;

  @ApiProperty({ description: 'The earlier export’s instant.' })
  @Column({ type: 'timestamptz', nullable: false })
  fromAt: Date;

  @ApiProperty({ description: 'The later export.' })
  @Column({ type: 'uuid', nullable: false })
  toImportId: string;

  @ApiProperty({ description: 'The later export’s instant.' })
  @Column({ type: 'timestamptz', nullable: false })
  toAt: Date;

  @ApiProperty({ description: 'Whether the later export is partial.' })
  @Column({ type: 'boolean', nullable: false })
  partial: boolean;

  @ApiProperty({ description: 'Identities the earlier export listed.' })
  @Column({ type: 'integer', nullable: false })
  membersAtStart: number;

  @ApiProperty({ description: 'Identities the later export listed.' })
  @Column({ type: 'integer', nullable: false })
  membersAtEnd: number;

  @ApiProperty({ description: 'First episodes begun within it.' })
  @Column({ type: 'integer', nullable: false })
  joined: number;

  @ApiProperty({ description: 'Later episodes begun within it.' })
  @Column({ type: 'integer', nullable: false })
  rejoined: number;

  @ApiProperty({ description: 'Episodes ended within it.' })
  @Column({ type: 'integer', nullable: false })
  left: number;

  @ApiProperty({
    description: 'Open episodes the later export leaves unknown.',
  })
  @Column({ type: 'integer', nullable: false })
  unknown: number;

  @ApiProperty({ description: 'Renames within it.' })
  @Column({ type: 'integer', nullable: false })
  renamed: number;

  @ApiProperty({ description: 'Rank label changes within it.' })
  @Column({ type: 'integer', nullable: false })
  rankChanged: number;

  @ApiProperty({ description: 'Join Date changes within it.' })
  @Column({ type: 'integer', nullable: false })
  joinDateChanged: number;

  @ApiProperty({
    description:
      'Changes that became known at the later export but are bounded more ' +
      'widely, and first sightings no export bounds.',
  })
  @Column({ type: 'integer', nullable: false })
  acrossGap: number;

  @ApiProperty({ description: 'The sum of every known delta within it.' })
  @Column({ type: 'bigint', nullable: false })
  contributionDelta: string;

  @ApiProperty({ description: 'Members with a known delta, zero included.' })
  @Column({ type: 'integer', nullable: false })
  contributionKnown: number;

  @ApiProperty({ description: 'Members whose total fell within it.' })
  @Column({ type: 'integer', nullable: false })
  contributionReset: number;

  @ApiProperty({ description: 'Members whose episode began at its end.' })
  @Column({ type: 'integer', nullable: false })
  contributionBaseline: number;

  @ApiProperty({ description: 'Every other member listed at either end.' })
  @Column({ type: 'integer', nullable: false })
  contributionUnknown: number;
}
