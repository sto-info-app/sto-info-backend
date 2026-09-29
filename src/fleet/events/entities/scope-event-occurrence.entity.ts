import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { OccurrenceAdjustment } from '../enums/event-recurrence.enum';
import { OccurrenceStatus } from '../enums/scope-event.enums';

/**
 * One occurrence of an event (FC-028).
 *
 * Keyed by the day its rule names, so an edit that keeps the day keeps the
 * occurrence and its answers. Never deleted: one the rule no longer names,
 * or that is called off, is cancelled, so what was answered and attended
 * survives.
 */
@Entity({ name: 'scope_event_occurrence' })
@Unique('UQ_scope_event_occurrence_key', ['eventId', 'occurrenceKey'])
@Index('IDX_scope_event_occurrence_start', ['eventId', 'startsAt'])
@Index('IDX_scope_event_occurrence_scheduled', ['startsAt'], {
  where: `"status" = 'SCHEDULED'`,
})
export class ScopeEventOccurrenceEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  eventId: string;

  @ApiProperty({ description: 'The day its rule names, YYYY-MM-DD.' })
  @Column({ type: 'date' })
  occurrenceKey: string;

  @ApiProperty({
    description: 'Its start on the event’s clock, YYYY-MM-DDTHH:mm.',
  })
  @Column({ type: 'varchar', length: 16 })
  localStart: string;

  @ApiProperty()
  @Column({ type: 'timestamptz' })
  startsAt: Date;

  @ApiProperty()
  @Column({ type: 'timestamptz' })
  endsAt: Date;

  @ApiProperty({ enum: OccurrenceAdjustment })
  @Column({
    type: 'enum',
    enum: OccurrenceAdjustment,
    enumName: 'scope_event_occurrence_adjustment_enum',
    default: OccurrenceAdjustment.NONE,
  })
  adjustment: OccurrenceAdjustment;

  @ApiProperty({ enum: OccurrenceStatus })
  @Column({
    type: 'enum',
    enum: OccurrenceStatus,
    enumName: 'scope_event_occurrence_status_enum',
    default: OccurrenceStatus.SCHEDULED,
  })
  status: OccurrenceStatus;

  @ApiProperty({ nullable: true, type: Date })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  cancelledAt: Date | null;

  @ApiProperty({ description: 'Whether it was moved or cancelled on its own.' })
  @Column({ type: 'boolean', default: false })
  isException: boolean;

  @ApiProperty({
    description: 'When it was first due, once moved.',
    nullable: true,
    type: Date,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  movedFromStartsAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
