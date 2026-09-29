import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { ActivityType, ActivityVisibility } from '../enums/activity.enums';

/**
 * One thing that happened in a Community, a Fleet or an Armada, for its
 * activity feed (FC-029).
 *
 * It holds references, never copies: the post, the event, the people and the
 * counts are named by ID, and the sentence a reader sees is written from the
 * data as it stands when they read it, after asking again whether they may
 * see it. So a post narrowed, a Fleet made private or a member gone changes
 * the feed at once, and nothing private is frozen here. `idempotencyKey` is
 * unique, so an import replayed or a change retried writes one item.
 */
@Entity({ name: 'activity_event' })
@Unique('UQ_activity_event_idempotency', ['idempotencyKey'])
@Index('IDX_activity_event_scope', [
  'communityId',
  'fleetId',
  'armadaId',
  'occurredAt',
])
@Index('IDX_activity_event_occurred', ['occurredAt'])
export class ActivityEventEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  communityId: string;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  fleetId: string | null;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  armadaId: string | null;

  @ApiProperty({ enum: ActivityType })
  @Column({
    type: 'enum',
    enum: ActivityType,
    enumName: 'activity_type_enum',
  })
  type: ActivityType;

  @ApiProperty({ enum: ActivityVisibility })
  @Column({
    type: 'enum',
    enum: ActivityVisibility,
    enumName: 'activity_visibility_enum',
  })
  visibility: ActivityVisibility;

  @ApiProperty({ description: 'Who did it.', nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  actorUserId: string | null;

  @ApiProperty({
    description: 'Who it happened to.',
    nullable: true,
    type: String,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  subjectUserId: string | null;

  @ApiProperty({
    description: 'The record it is about, by type.',
    nullable: true,
    type: String,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  sourceId: string | null;

  @ApiProperty({
    description: 'References and counts only, never names or text.',
    nullable: true,
  })
  @Column({ type: 'jsonb', nullable: true, default: null })
  detail: Record<string, unknown> | null;

  @ApiProperty()
  @Column({ type: 'varchar', length: 200 })
  idempotencyKey: string;

  @ApiProperty({ description: 'When it happened.' })
  @Column({ type: 'timestamptz' })
  occurredAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
