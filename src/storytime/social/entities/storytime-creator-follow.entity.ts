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
 * Somebody following a creator.
 *
 * One row per person per creator, which is what makes following idempotent:
 * pressing the button twice is not two follows, and unfollowing is deleting
 * the row rather than counting down.
 */
@Entity({ name: 'storytime_user_creator_follow' })
@Unique(['userId', 'creatorUserId'])
@Index(['creatorUserId'])
export class StorytimeCreatorFollowEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The follower.' })
  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @ApiProperty({ description: 'The creator being followed.' })
  @Column({ type: 'uuid', nullable: false })
  creatorUserId: string;

  @CreateDateColumn()
  createdAt: Date;
}
