import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { UserEntity } from 'src/user/entities/user.entity';

import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { OwnershipTransferStatus } from '../enums/ownership-transfer-status.enum';

/**
 * An offer of a Community's ownership to one of its Admins (FC-022).
 *
 * Ownership itself stays where it always was, in `fleet_community.ownerUserId`:
 * one column, so a Community cannot have two Owners or none, whatever two
 * requests do at once. This row is only the offer, which the Admin accepts
 * or declines within seven days.
 *
 * At most one offer per Community is open at a time, by a partial unique
 * index. An answered offer never changes again, by trigger.
 */
@Entity({ name: 'scope_ownership_transfer' })
@Index('UX_scope_ownership_transfer_open', ['communityId'], {
  unique: true,
  where: `"status" = 'PENDING'`,
})
@Index('IDX_scope_ownership_transfer_to', ['toUserId', 'status'])
export class OwnershipTransferEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Community on offer.' })
  @Column({ type: 'uuid', nullable: false })
  communityId: string;

  @ApiProperty({
    description: 'The Owner who made the offer, or null once they have gone.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true })
  fromUserId: string | null;

  @ApiProperty({
    description: 'The Admin it was offered to, or null once they have gone.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true })
  toUserId: string | null;

  @ApiProperty({ enum: OwnershipTransferStatus })
  @Column({
    type: 'enum',
    enum: OwnershipTransferStatus,
    enumName: 'scope_ownership_transfer_status_enum',
    default: OwnershipTransferStatus.PENDING,
    nullable: false,
  })
  status: OwnershipTransferStatus;

  @ApiProperty({ description: 'When it was offered.' })
  @Column({ type: 'timestamptz', nullable: false })
  offeredAt: Date;

  @ApiProperty({ description: 'When it stops being answerable.' })
  @Column({ type: 'timestamptz', nullable: false })
  expiresAt: Date;

  @ApiProperty({
    description: 'When it was answered or taken back, or null while open.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  answeredAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => FleetCommunityEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'communityId' })
  community: FleetCommunityEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'fromUserId' })
  from: UserEntity | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'toUserId' })
  to: UserEntity | null;
}
