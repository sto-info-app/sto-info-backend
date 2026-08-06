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
import { UserEntity } from '../../user/entities/user.entity';
import { FriendshipStatus } from '../enums/friendship-status.enum';

/**
 * A directed friend request and, once accepted, the friendship it became.
 *
 * Direction is preserved rather than normalised into a canonical pair because
 * who asked determines who may cancel and who may respond. A single row
 * therefore covers the pair in both directions: the service always looks the
 * pair up with an OR over both orderings, and the partial unique indexes added
 * by the migration stop a second live row appearing either way round.
 *
 * Cancelling a request and unfriending both soft-delete the row, which frees
 * the pair for a fresh request. A declined row is kept so the decline is not
 * silently lost, and is revived in place if the requester asks again.
 */
@Entity({ name: 'friendship' })
@Index(['requesterId', 'status'])
@Index(['addresseeId', 'status'])
export class FriendshipEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The user who sent the request.' })
  @Column({ type: 'uuid', nullable: false })
  requesterId: string;

  @ApiProperty({ description: 'The user the request was sent to.' })
  @Column({ type: 'uuid', nullable: false })
  addresseeId: string;

  @ApiProperty({ enum: FriendshipStatus, description: 'Lifecycle state.' })
  @Column({
    type: 'enum',
    enum: FriendshipStatus,
    enumName: 'friendship_status_enum',
    default: FriendshipStatus.PENDING,
  })
  status: FriendshipStatus;

  @ApiProperty({
    description: 'When the addressee accepted or declined.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  respondedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requesterId' })
  requester: UserEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'addresseeId' })
  addressee: UserEntity;

  /**
   * Resolves the other party in this friendship, from one member's point of
   * view.
   *
   * @param userId - The member whose counterpart is wanted.
   * @returns The other member's user ID.
   */
  otherUserId(userId: string): string {
    return this.requesterId === userId ? this.addresseeId : this.requesterId;
  }
}
