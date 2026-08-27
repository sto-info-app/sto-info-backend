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

/**
 * A per-user replacement for a configured numeric limit.
 *
 * Limits such as the maximum number of Stories a user may own are configured
 * globally through environment variables, which is the right default but the
 * wrong answer for a prolific creator. This table lets an administrator raise
 * (or lower) a single user's ceiling without changing the deployment-wide value
 * and without a redeploy.
 *
 * Overrides soft-delete so a lapsed exemption leaves the pair free to be
 * granted again, which is why uniqueness is a partial index over live rows.
 */
@Entity({ name: 'user_limit_override' })
@Index(['userId', 'limitKey'])
export class UserLimitOverrideEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The user the exemption applies to.' })
  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @ApiProperty({
    description: 'The configuration key being overridden.',
    example: 'STORYTIME_MAX_STORIES_PER_USER',
  })
  @Column({ type: 'varchar', length: 80, nullable: false })
  limitKey: string;

  @ApiProperty({
    description: 'The value that applies to this user in place of the default.',
    minimum: 0,
  })
  @Column({ type: 'integer', nullable: false })
  limitValue: number;

  @ApiProperty({ description: 'Why the exemption was granted.' })
  @Column({ type: 'varchar', length: 500, nullable: false })
  reason: string;

  @ApiProperty({ description: 'Administrator who granted the exemption.' })
  @Column({ type: 'uuid', nullable: false })
  grantedByUserId: string;

  @ApiProperty({
    description: 'When the exemption lapses. Null means indefinite.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  expiresAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
