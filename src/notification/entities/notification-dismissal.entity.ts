import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A notification one user has deleted from their inbox.
 *
 * A notification is one row, shared by everyone for a broadcast or addressed
 * to one user, so a reader deleting one cannot remove the row: it hides it
 * for that reader alone, the way `notification_read` records reading for
 * that reader alone. A dismissed notification leaves the inbox, its count
 * and its unread count, and stays for every other recipient and for the
 * admin list. There is no way back from the inbox; the row itself is kept.
 */
@Entity({ name: 'notification_dismissal' })
@Index(['notificationId', 'userId'], { unique: true })
export class NotificationDismissalEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: false })
  notificationId: string;

  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @CreateDateColumn()
  dismissedAt: Date;
}
