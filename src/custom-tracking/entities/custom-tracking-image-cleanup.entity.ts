import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { CustomTrackingImageCleanupReason } from '../enums/custom-tracking-image-cleanup-reason.enum';

/**
 * A picture in Cloudflare Images that nothing on the site points at any more.
 *
 * The row is written in the same transaction that drops the reference, and
 * removed once Cloudflare confirms the picture has gone. That order is the
 * whole point. Deleting from Cloudflare first and writing the row afterwards
 * leaves a window in which the site has forgotten a picture that still exists
 * and still costs storage; nothing would ever look for it again, because
 * nothing would know it was there.
 *
 * The queue is therefore normally empty. Rows accumulate only while Cloudflare
 * is refusing deletions, and the nightly reconciliation drains them when it
 * comes back. A row that will not drain is a fault worth a person's attention,
 * which is what the attempt count is for.
 *
 * No foreign key to anything. The reference is gone by the time this row
 * exists — that is what it means — so there is nothing left to point at.
 */
@Entity({ name: 'custom_tracking_image_cleanup' })
@Index('UX_custom_tracking_image_cleanup_image', ['cloudflareImageId'], {
  unique: true,
})
@Index('IDX_custom_tracking_image_cleanup_created', ['createdAt'])
export class CustomTrackingImageCleanupEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * The Cloudflare Images identifier to delete.
   *
   * Unique, so the same picture cannot be queued twice by a replacement that
   * was itself retried.
   */
  @ApiProperty({ description: 'The Cloudflare Images identifier to delete.' })
  @Column({ type: 'varchar', length: 160, nullable: false })
  cloudflareImageId: string;

  /** What stopped the site pointing at the picture. */
  @ApiProperty({
    description: 'Why the picture is no longer referenced.',
    enum: CustomTrackingImageCleanupReason,
  })
  @Column({
    type: 'enum',
    enum: CustomTrackingImageCleanupReason,
    enumName: 'custom_tracking_image_cleanup_reason_enum',
    nullable: false,
  })
  reason: CustomTrackingImageCleanupReason;

  /** How many times deletion has been tried and failed. */
  @ApiProperty({ description: 'How many deletion attempts have failed.' })
  @Column({ type: 'integer', nullable: false, default: 0 })
  attempts: number;

  /** When the last attempt was made, or null before the first. */
  @ApiProperty({
    description: 'When deletion was last attempted.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  lastAttemptedAt: Date | null;

  /**
   * What Cloudflare said when the last attempt failed.
   *
   * Truncated on the way in. It describes a request to a third party and
   * never carries anything the picture's owner wrote.
   */
  @ApiProperty({
    description: 'Why the last attempt failed.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 300, nullable: true, default: null })
  lastError: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
