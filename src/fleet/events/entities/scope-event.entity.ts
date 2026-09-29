import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { EventRecurrence } from '../enums/event-recurrence.enum';
import {
  ScopeEventAudience,
  ScopeEventStatus,
} from '../enums/scope-event.enums';

/**
 * A Community's, a Fleet's or an Armada's event, and the rule it repeats by
 * (FC-028).
 *
 * The time is a local one in the timezone the organiser chose, so a weekly
 * event follows that clock across daylight saving. Its occurrences are
 * written out a year ahead as `scope_event_occurrence` rows.
 */
@Entity({ name: 'scope_event' })
@Index('IDX_scope_event_scope', [
  'communityId',
  'fleetId',
  'armadaId',
  'status',
])
export class ScopeEventEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    description: 'The Community it belongs to, or that holds it.',
  })
  @Column({ type: 'uuid', nullable: false })
  communityId: string;

  @ApiProperty({
    description: 'The Fleet, for a Fleet’s event.',
    nullable: true,
    type: String,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  fleetId: string | null;

  @ApiProperty({
    description: 'The Armada, for an Armada’s event.',
    nullable: true,
    type: String,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  armadaId: string | null;

  @ApiProperty()
  @Column({ type: 'varchar', length: 200 })
  title: string;

  @ApiProperty({ description: 'Markdown.' })
  @Column({ type: 'text', default: '' })
  description: string;

  @ApiProperty({ description: 'One https link.', nullable: true, type: String })
  @Column({ type: 'varchar', length: 2048, nullable: true, default: null })
  externalUrl: string | null;

  @ApiProperty({ enum: ScopeEventAudience })
  @Column({
    type: 'enum',
    enum: ScopeEventAudience,
    enumName: 'scope_event_audience_enum',
  })
  audience: ScopeEventAudience;

  @ApiProperty({ description: 'The IANA timezone its clock follows.' })
  @Column({ type: 'varchar', length: 64 })
  timezone: string;

  @ApiProperty({ enum: EventRecurrence })
  @Column({
    type: 'enum',
    enum: EventRecurrence,
    enumName: 'scope_event_recurrence_enum',
  })
  recurrence: EventRecurrence;

  @ApiProperty({ description: 'Its first day, YYYY-MM-DD, on its own clock.' })
  @Column({ type: 'date' })
  startDate: string;

  @ApiProperty({ description: 'Its start, HH:mm, on its own clock.' })
  @Column({ type: 'varchar', length: 5 })
  startTime: string;

  @ApiProperty({ description: 'Every how many weeks or months.' })
  @Column({ type: 'smallint', default: 1 })
  interval: number;

  @ApiProperty({
    description: 'ISO weekdays of a weekly event.',
    type: [Number],
  })
  @Column({ type: 'smallint', array: true, default: () => "'{}'" })
  weekdays: number[];

  @ApiProperty({ nullable: true, type: Number })
  @Column({ type: 'smallint', nullable: true, default: null })
  monthDay: number | null;

  @ApiProperty({
    description: '1 to 4, or -1 for the last.',
    nullable: true,
    type: Number,
  })
  @Column({ type: 'smallint', nullable: true, default: null })
  monthWeek: number | null;

  @ApiProperty({ nullable: true, type: Number })
  @Column({ type: 'smallint', nullable: true, default: null })
  monthWeekday: number | null;

  @ApiProperty({
    description: 'Its last possible day.',
    nullable: true,
    type: String,
  })
  @Column({ type: 'date', nullable: true, default: null })
  endsOn: string | null;

  @ApiProperty({
    description: 'How many times at most.',
    nullable: true,
    type: Number,
  })
  @Column({ type: 'integer', nullable: true, default: null })
  occurrenceLimit: number | null;

  @ApiProperty()
  @Column({ type: 'integer' })
  durationMinutes: number;

  @ApiProperty({
    description: 'Places for Going, or null for no limit.',
    nullable: true,
    type: Number,
  })
  @Column({ type: 'integer', nullable: true, default: null })
  capacity: number | null;

  @ApiProperty({ enum: ScopeEventStatus })
  @Column({
    type: 'enum',
    enum: ScopeEventStatus,
    enumName: 'scope_event_status_enum',
    default: ScopeEventStatus.ACTIVE,
  })
  status: ScopeEventStatus;

  @ApiProperty({ nullable: true, type: Date })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  cancelledAt: Date | null;

  @ApiProperty({
    description: 'The last day its occurrences are written out to.',
  })
  @Column({ type: 'date' })
  materialisedThrough: string;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  createdByUserId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
