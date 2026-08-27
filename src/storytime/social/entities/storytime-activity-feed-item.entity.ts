import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { StorytimeActivityType } from '../../enums/storytime-activity-type.enum';

/**
 * One thing that happened, for the feeds that care about it.
 *
 * Records the event and the identifiers involved and copies no content. A feed
 * is read long after it is written, by which time a Story may have been
 * unpublished, made private or removed — storing its title would mean serving
 * one that is no longer true. What a reader may see is decided when they read.
 */
@Entity({ name: 'storytime_activity_feed_item' })
@Index(['actorUserId', 'occurredAt'])
export class StorytimeActivityFeedItemEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    enum: StorytimeActivityType,
    description: 'What happened.',
  })
  @Column({
    type: 'enum',
    enum: StorytimeActivityType,
    enumName: 'storytime_activity_type_enum',
  })
  activityType: StorytimeActivityType;

  @ApiProperty({ description: 'Who did it.' })
  @Column({ type: 'uuid', nullable: false })
  actorUserId: string;

  @ApiProperty({ description: 'The Story involved, if any.', nullable: true })
  @Column({ type: 'uuid', nullable: true, default: null })
  storyId: string | null;

  @ApiProperty({ description: 'The Chapter involved, if any.', nullable: true })
  @Column({ type: 'uuid', nullable: true, default: null })
  chapterId: string | null;

  @ApiProperty({ description: 'The Arc involved, if any.', nullable: true })
  @Column({ type: 'uuid', nullable: true, default: null })
  arcId: string | null;

  @ApiProperty({ description: 'When it happened.' })
  @CreateDateColumn()
  occurredAt: Date;
}
