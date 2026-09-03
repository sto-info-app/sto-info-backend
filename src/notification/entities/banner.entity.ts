import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { NotificationSeverity } from '../enums/notification-severity.enum';

/**
 * A site-wide banner shown to all visitors while active and within its window.
 *
 * Dismissal is tracked client-side (per browser), so banners are intentionally
 * lightweight and global rather than per-user.
 */
@Entity({ name: 'banner' })
export class BannerEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ enum: NotificationSeverity, description: 'Banner severity.' })
  @Column({
    type: 'enum',
    enum: NotificationSeverity,
    enumName: 'notification_severity_enum',
    default: NotificationSeverity.INFO,
  })
  severity: NotificationSeverity;

  @ApiProperty({ description: 'Optional short title.', nullable: true })
  @Column({ type: 'varchar', length: 120, nullable: true, default: null })
  title: string | null;

  @ApiProperty({ description: 'Banner message (plain text).' })
  @Column({ type: 'varchar', length: 500, nullable: false })
  message: string;

  @ApiProperty({ description: 'Optional call-to-action URL.', nullable: true })
  @Column({ type: 'varchar', length: 2048, nullable: true, default: null })
  linkUrl: string | null;

  @ApiProperty({
    description: 'Optional call-to-action label.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 80, nullable: true, default: null })
  linkLabel: string | null;

  @ApiProperty({ description: 'Whether visitors may dismiss the banner.' })
  @Column({ type: 'boolean', default: true })
  dismissible: boolean;

  @ApiProperty({ description: 'Whether the banner is enabled.' })
  @Index()
  @Column({ type: 'boolean', default: true })
  active: boolean;

  @ApiProperty({
    description: 'Start of the display window (null = immediately).',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  startsAt: Date | null;

  @ApiProperty({
    description: 'End of the display window (null = no end).',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  endsAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
