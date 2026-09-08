import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { NotificationSeverity } from '../enums/notification-severity.enum';
import { NotificationTarget } from '../enums/notification-target.enum';

/**
 * An inbox-style notification, either broadcast to everyone or targeted at a
 * single user. Per-user read state lives in `notification_read` so broadcasts
 * do not fan out a row per recipient at creation time.
 */
@Entity({ name: 'notification' })
@Index(['target', 'userId'])
export class NotificationEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ enum: NotificationTarget, description: 'Audience.' })
  @Column({
    type: 'enum',
    enum: NotificationTarget,
    enumName: 'notification_target_enum',
    default: NotificationTarget.BROADCAST,
  })
  target: NotificationTarget;

  @ApiProperty({
    description: 'Recipient user ID for USER-targeted notifications.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  userId: string | null;

  @ApiProperty({ enum: NotificationSeverity, description: 'Severity / type.' })
  @Column({
    type: 'enum',
    enum: NotificationSeverity,
    enumName: 'notification_severity_enum',
    default: NotificationSeverity.INFO,
  })
  severity: NotificationSeverity;

  @ApiProperty({ description: 'Notification title.' })
  @Column({ type: 'varchar', length: 160, nullable: false })
  title: string;

  @ApiProperty({ description: 'Notification body (plain text).' })
  @Column({ type: 'varchar', length: 2000, nullable: false })
  body: string;

  @ApiProperty({ description: 'Optional deep link.', nullable: true })
  @Column({ type: 'varchar', length: 2048, nullable: true, default: null })
  linkUrl: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
