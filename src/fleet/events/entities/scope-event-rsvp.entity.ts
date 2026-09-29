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

import { RsvpResponse } from '../enums/scope-event.enums';

/**
 * Somebody's answer to one occurrence (FC-028).
 *
 * One per person per occurrence. Only Going can wait for a place, and one
 * waiting carries when it started to, which is its place in the queue.
 */
@Entity({ name: 'scope_event_rsvp' })
@Unique('UQ_scope_event_rsvp_person', ['occurrenceId', 'userId'])
@Index('IDX_scope_event_rsvp_waitlist', ['occurrenceId', 'waitlistedAt'], {
  where: '"waitlistedAt" IS NOT NULL',
})
export class ScopeEventRsvpEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  occurrenceId: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  userId: string;

  @ApiProperty({ enum: RsvpResponse })
  @Column({
    type: 'enum',
    enum: RsvpResponse,
    enumName: 'scope_event_rsvp_response_enum',
  })
  response: RsvpResponse;

  @ApiProperty({
    description: 'One of their own Characters.',
    nullable: true,
    type: String,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  characterId: string | null;

  @ApiProperty({
    description: 'When they joined the waitlist.',
    nullable: true,
    type: Date,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  waitlistedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  respondedAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
