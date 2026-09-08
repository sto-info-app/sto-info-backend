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
} from 'typeorm';

import { UserEntity } from '../../user/entities/user.entity';

/**
 * One member's decision to block another.
 *
 * Blocks are one-sided records but are enforced symmetrically: a single row
 * hides each member's registry record from the other and stops friend requests
 * in either direction. The blocked member is never told, so nothing here is
 * ever exposed to anyone but the blocker.
 *
 * Unblocking soft-deletes the row, which the partial unique index treats as
 * gone so the pair can be blocked again later.
 */
@Entity({ name: 'user_block' })
@Index(['blockerId'])
@Index(['blockedId'])
export class UserBlockEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The user who created the block.' })
  @Column({ type: 'uuid', nullable: false })
  blockerId: string;

  @ApiProperty({ description: 'The user who was blocked.' })
  @Column({ type: 'uuid', nullable: false })
  blockedId: string;

  @ApiProperty({
    description: 'Private note kept for the blocker only.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  reason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'blockerId' })
  blocker: UserEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'blockedId' })
  blocked: UserEntity;
}
