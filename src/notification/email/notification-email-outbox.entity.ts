import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { UserEntity } from 'src/user/entities/user.entity';

import { NotificationEmailType } from './notification-email-type.enum';

/**
 * A notification email waiting to be sent, or sent (sc-1067).
 *
 * Queued wherever an in-app notice is written, when its person has opted in
 * to that type. It copies the notice's title, text and link rather than
 * pointing at it: somebody who clears their inbox before a digest goes out
 * has still asked for the email. Nothing else is copied: chat and comment
 * text never reach a notice, so they never reach here.
 *
 * `dueAt` is when it may go out, worked out from the person's frequency and
 * zone when it is queued, and again when either changes. A sent or skipped
 * row is deleted after 30 days, and every row goes with its account.
 */
@Entity({ name: 'notification_email_outbox' })
@Index('IDX_notification_email_outbox_due', ['dueAt'], {
  where: '"sentAt" IS NULL AND "skippedAt" IS NULL',
})
@Index('IDX_notification_email_outbox_user_type', ['userId', 'type'])
export class NotificationEmailOutboxEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: UserEntity;

  @Column({
    type: 'enum',
    enum: NotificationEmailType,
    enumName: 'notification_email_type_enum',
  })
  type: NotificationEmailType;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text' })
  body: string;

  /** Where the notice leads, as an absolute address, or null. */
  @Column({ type: 'varchar', length: 2048, nullable: true, default: null })
  linkUrl: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz' })
  dueAt: Date;

  @Column({ type: 'timestamptz', nullable: true, default: null })
  sentAt: Date | null;

  /** Set when it was no longer wanted, or could never be sent. */
  @Column({ type: 'timestamptz', nullable: true, default: null })
  skippedAt: Date | null;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ type: 'varchar', length: 200, nullable: true, default: null })
  lastError: string | null;
}
