import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * How far through their feed one reader has got.
 *
 * A watermark rather than a row per item per reader. The unread badge only
 * needs to know what somebody has seen up to, and a per-item table would grow
 * with readers times events for the sake of a number.
 */
@Entity({ name: 'storytime_user_activity_feed_state' })
export class StorytimeFeedStateEntity {
  @ApiProperty({ description: 'The reader.' })
  @PrimaryColumn({ type: 'uuid' })
  userId: string;

  @ApiProperty({ description: 'When they last looked.' })
  @Column({ type: 'timestamp', nullable: false, default: () => 'now()' })
  lastReadAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
