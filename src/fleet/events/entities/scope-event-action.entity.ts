import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { ScopeEventActionKind } from '../enums/scope-event.enums';

/**
 * One change to an event, for its managers' change log (FC-028).
 *
 * Write-once by trigger, but for the people it names going.
 */
@Entity({ name: 'scope_event_action' })
@Index('IDX_scope_event_action_event', ['eventId', 'createdAt'])
export class ScopeEventActionEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  eventId: string;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  occurrenceId: string | null;

  @ApiProperty({ enum: ScopeEventActionKind })
  @Column({
    type: 'enum',
    enum: ScopeEventActionKind,
    enumName: 'scope_event_action_enum',
  })
  action: ScopeEventActionKind;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  actorUserId: string | null;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  subjectUserId: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'jsonb', nullable: true, default: null })
  detail: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
