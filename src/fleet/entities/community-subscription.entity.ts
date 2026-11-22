import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { UserEntity } from 'src/user/entities/user.entity';

import { FleetCommunityEntity } from './fleet-community.entity';

/**
 * A user following a Community.
 *
 * Following is the weakest relationship in the feature and grants nothing: no
 * Fleet access, no private roster, no handles, no comments. That separation is
 * ADR-0002 and it is what FC-005's second acceptance criterion tests. Access is
 * `scope_membership`, and only when approved.
 *
 * Leaving stamps `leftAt` rather than deleting, so "followed once" stays
 * answerable. The partial unique index covers only live rows, which lets
 * someone follow, leave and follow again without a second live row appearing.
 */
@Entity({ name: 'community_subscription' })
@Index('UX_community_subscription_live', ['communityId', 'userId'], {
  unique: true,
  where: '"leftAt" IS NULL AND "deletedAt" IS NULL',
})
@Index('IDX_community_subscription_user', ['userId'])
export class CommunitySubscriptionEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Community being followed.' })
  @Column({ type: 'uuid', nullable: false })
  communityId: string;

  @ApiProperty({ description: 'The follower.' })
  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @ApiProperty({ description: 'When they started following.' })
  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  joinedAt: Date;

  @ApiProperty({
    description: 'When they stopped, or null while following.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  leftAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt: Date | null;

  @ManyToOne(() => FleetCommunityEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'communityId' })
  community: FleetCommunityEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;
}
