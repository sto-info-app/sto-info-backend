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

import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetInvitationStatus } from '../enums/fleet-invitation-status.enum';

/**
 * An officer's invitation to join a Fleet (FC-021).
 *
 * Sent to a user, not a Character: the invitee chooses which of their
 * Characters to accept with. Invitations work in every recruitment state,
 * since an invitation is the Fleet reaching out on purpose, and they bypass
 * the Fleet's requirements, since an officer chose the invitee.
 *
 * At most one open per Fleet and user, by a partial unique index. It is open
 * while `PENDING` and before `expiresAt`, 14 days after it was sent.
 */
@Entity({ name: 'fleet_invitation' })
@Index('UX_fleet_invitation_open', ['fleetId', 'invitedUserId'], {
  unique: true,
  where: `"status" = 'PENDING'`,
})
@Index('IDX_fleet_invitation_invited', ['invitedUserId', 'status'])
@Index('IDX_fleet_invitation_fleet', ['fleetId', 'createdAt'])
export class FleetInvitationEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Community holding the Fleet.' })
  @Column({ type: 'uuid', nullable: false })
  communityId: string;

  @ApiProperty({ description: 'The Fleet.' })
  @Column({ type: 'uuid', nullable: false })
  fleetId: string;

  @ApiProperty({ description: 'Who is invited.' })
  @Column({ type: 'uuid', nullable: false })
  invitedUserId: string;

  @ApiProperty({
    description: 'Who sent it, or null once their account is gone.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  invitedByUserId: string | null;

  @ApiProperty({ enum: FleetInvitationStatus })
  @Column({
    type: 'enum',
    enum: FleetInvitationStatus,
    enumName: 'fleet_invitation_status_enum',
    default: FleetInvitationStatus.PENDING,
    nullable: false,
  })
  status: FleetInvitationStatus;

  @ApiProperty({ description: 'When it lapses, if unanswered.' })
  @Column({ type: 'timestamptz', nullable: false })
  expiresAt: Date;

  @ApiProperty({
    description: 'When it was answered, withdrawn or replaced.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  answeredAt: Date | null;

  @ApiProperty({ description: 'When it was sent.' })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ description: 'When it last changed.' })
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => StoFleetEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invitedUserId' })
  invited: UserEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'invitedByUserId' })
  invitedBy: UserEntity | null;
}
