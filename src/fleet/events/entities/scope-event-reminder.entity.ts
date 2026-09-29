import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Somebody's request to be reminded of an event's occurrences (FC-028).
 *
 * For every occurrence of the event, a one-off or a whole series, at one or
 * more of fifteen minutes, an hour and a day before.
 */
@Entity({ name: 'scope_event_reminder' })
@Unique('UQ_scope_event_reminder_person', ['eventId', 'userId'])
export class ScopeEventReminderEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  eventId: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  userId: string;

  @ApiProperty({ type: [Number] })
  @Column({ type: 'smallint', array: true })
  leadMinutes: number[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
