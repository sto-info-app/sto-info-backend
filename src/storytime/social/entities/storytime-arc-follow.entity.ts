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
 * Somebody following a Arc.
 *
 * One row per person per Arc, which is what makes following idempotent:
 * pressing the button twice is not two follows, and unfollowing is deleting
 * the row rather than counting down.
 */
@Entity({ name: 'storytime_user_arc_follow' })
@Unique(['userId', 'arcId'])
@Index(['arcId'])
export class StorytimeArcFollowEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The follower.' })
  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @ApiProperty({ description: 'The Arc being followed.' })
  @Column({ type: 'uuid', nullable: false })
  arcId: string;

  @CreateDateColumn()
  createdAt: Date;
}
