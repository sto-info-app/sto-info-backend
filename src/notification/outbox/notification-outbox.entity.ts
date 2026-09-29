import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { NotificationOutboxKind } from './notification-outbox-kind.enum';

/**
 * A targeted in-app notice waiting to be sent, or sent (FC-028, FC-029).
 *
 * The one outbox every targeted notice goes through: event reminders and
 * changes, Character association proposals, and later mentions, replies and
 * direct messages. A change writes its notices in its own transaction, so
 * none is lost to a failure after it; the delivery job sends them, asking
 * the person's preference and the feature's handler again whether each is
 * still wanted. `dedupeKey` is unique, so each is sent once however often
 * anything runs, replays or retries.
 *
 * It holds references rather than words: the notice is written from the
 * data as it stands when it is sent, so nothing private is copied here.
 */
@Entity({ name: 'notification_outbox' })
@Unique('UQ_notification_outbox_dedupe', ['dedupeKey'])
@Index('IDX_notification_outbox_pending', ['createdAt'], {
  where: '"deliveredAt" IS NULL AND "skippedAt" IS NULL',
})
export class NotificationOutboxEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Who it is for.' })
  @Column({ type: 'uuid' })
  userId: string;

  @ApiProperty({ enum: NotificationOutboxKind })
  @Column({
    type: 'enum',
    enum: NotificationOutboxKind,
    enumName: 'notification_outbox_kind_enum',
  })
  kind: NotificationOutboxKind;

  @ApiProperty({ description: 'The record it is about, by kind.' })
  @Column({ type: 'uuid' })
  subjectId: string;

  @ApiProperty({
    description: 'Anything else its handler needs, such as a lead.',
    nullable: true,
  })
  @Column({ type: 'jsonb', nullable: true, default: null })
  detail: Record<string, unknown> | null;

  @ApiProperty()
  @Column({ type: 'varchar', length: 200 })
  dedupeKey: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ nullable: true, type: Date })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  deliveredAt: Date | null;

  @ApiProperty({
    description: 'Set when it was no longer wanted.',
    nullable: true,
    type: Date,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  skippedAt: Date | null;

  @ApiProperty()
  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'varchar', length: 200, nullable: true, default: null })
  lastError: string | null;
}
