import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * Somebody following a Story.
 *
 * One row per person per Story, which is what makes following idempotent:
 * pressing the button twice is not two follows, and unfollowing is deleting
 * the row rather than counting down.
 */
@Entity({ name: 'storytime_user_story_follow' })
@Unique(['userId', 'storyId'])
@Index(['storyId'])
export class StorytimeStoryFollowEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The follower.' })
  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @ApiProperty({ description: 'The Story being followed.' })
  @Column({ type: 'uuid', nullable: false })
  storyId: string;

  @CreateDateColumn()
  createdAt: Date;
}
