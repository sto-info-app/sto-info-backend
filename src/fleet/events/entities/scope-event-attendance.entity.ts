import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * What a manager recorded happened at an occurrence, for one person (FC-028).
 *
 * Kept apart from the answer and never worked out from it: somebody who said
 * Going may not have come, and somebody who never answered may have.
 */
@Entity({ name: 'scope_event_attendance' })
@Unique('UQ_scope_event_attendance_person', ['occurrenceId', 'userId'])
export class ScopeEventAttendanceEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  occurrenceId: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  userId: string;

  @ApiProperty()
  @Column({ type: 'boolean' })
  attended: boolean;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  characterId: string | null;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  recordedByUserId: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  recordedAt: Date;
}
