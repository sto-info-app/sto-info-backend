import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Records that a specific user has read a specific notification.
 *
 * Rows are created lazily when a user reads a notification, which keeps
 * broadcast notifications cheap to create.
 */
@Entity({ name: 'notification_read' })
@Index(['notificationId', 'userId'], { unique: true })
export class NotificationReadEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: false })
  notificationId: string;

  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @CreateDateColumn()
  readAt: Date;
}
