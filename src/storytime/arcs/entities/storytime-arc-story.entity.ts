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

import { ArcMembershipStatus } from '../../enums/arc-membership-status.enum';

/**
 * A Story's place in an Arc.
 *
 * Inclusion is agreed by both sides. A curator may invite a Story or its owner
 * may ask to join, and only an `APPROVED` membership counts — which is what
 * stops an Arc from being a way to attach yourself to somebody else's work
 * without their agreement, in either direction.
 *
 * A membership may name an unpublished Story so a curator can assemble an Arc
 * before its Stories are released, but public navigation and Arc progress both
 * filter to approved memberships of Stories a reader can actually open.
 */
@Entity({ name: 'storytime_arc_story' })
@Index(['arcId', 'orderIndex'])
@Index(['storyId'])
export class StorytimeArcStoryEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Arc.' })
  @Column({ type: 'uuid', nullable: false })
  arcId: string;

  @ApiProperty({ description: 'The Story.' })
  @Column({ type: 'uuid', nullable: false })
  storyId: string;

  @ApiProperty({ description: 'Position in the Arc’s reading order.' })
  @Column({ type: 'integer', nullable: false })
  orderIndex: number;

  @ApiProperty({
    enum: ArcMembershipStatus,
    description: 'Where the inclusion has got to.',
  })
  @Column({
    type: 'enum',
    enum: ArcMembershipStatus,
    enumName: 'storytime_arc_membership_status_enum',
    default: ArcMembershipStatus.REQUESTED,
  })
  membershipStatus: ArcMembershipStatus;

  @ApiProperty({ description: 'Who asked for or offered the inclusion.' })
  @Column({ type: 'uuid', nullable: false })
  requestedByUserId: string;

  @ApiProperty({ description: 'Who agreed to it.', nullable: true })
  @Column({ type: 'uuid', nullable: true, default: null })
  approvedByUserId: string | null;

  @ApiProperty({ description: 'When it was asked for.' })
  @Column({ type: 'timestamp', nullable: false, default: () => 'now()' })
  requestedAt: Date;

  @ApiProperty({ description: 'When it was agreed.', nullable: true })
  @Column({ type: 'timestamp', nullable: true, default: null })
  approvedAt: Date | null;

  @ApiProperty({ description: 'When it was turned down.', nullable: true })
  @Column({ type: 'timestamp', nullable: true, default: null })
  declinedAt: Date | null;

  @ApiProperty({
    description: 'When the Story left the Arc, either way.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  removedAt: Date | null;

  @ApiProperty({
    description: 'What the curator says about this Story’s place in the Arc.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 1000, nullable: true, default: null })
  introductoryNote: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
