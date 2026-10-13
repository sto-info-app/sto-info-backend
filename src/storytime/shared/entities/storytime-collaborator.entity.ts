import { ApiProperty } from '@nestjs/swagger';

import { Column } from 'typeorm';

import { TimestampedRecordEntity } from '../../../shared/entities/timestamped-record.entity';
import { CollaborationInvitationStatus } from '../../enums/collaboration-invitation-status.enum';

/**
 * Somebody invited to help with a work, and where that invitation has got to.
 *
 * A Story and an Arc are collaborated on the same way, deliberately: access
 * comes only from an accepted invitation, publishing is never delegated, and
 * the capabilities are named one by one rather than bundled into a role.
 * Subclasses supply the work they belong to and the capabilities that work
 * offers.
 */
export abstract class StorytimeCollaboratorEntity extends TimestampedRecordEntity {
  @ApiProperty({ description: 'The invited member.' })
  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @ApiProperty({
    description: 'What the owner calls this collaborator, for their own list.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  collaborationRole: string | null;

  @ApiProperty({
    description:
      'May publish. Never granted — only the owner may publish — and refused by both the DTO and a check constraint.',
  })
  @Column({ type: 'boolean', nullable: false, default: false })
  canPublish: boolean;

  @ApiProperty({ description: 'May invite and remove other collaborators.' })
  @Column({ type: 'boolean', nullable: false, default: false })
  canManageCollaborators: boolean;

  @ApiProperty({
    enum: CollaborationInvitationStatus,
    description: 'Where the invitation has got to.',
  })
  @Column({
    type: 'enum',
    enum: CollaborationInvitationStatus,
    enumName: 'storytime_collaboration_invitation_status_enum',
    default: CollaborationInvitationStatus.INVITED,
  })
  invitationStatus: CollaborationInvitationStatus;

  @ApiProperty({ description: 'Who sent the invitation.' })
  @Column({ type: 'uuid', nullable: false })
  invitedByUserId: string;

  @ApiProperty({ description: 'When the invitation was sent.' })
  @Column({ type: 'timestamp', nullable: false, default: () => 'now()' })
  invitedAt: Date;

  @ApiProperty({ description: 'When it was accepted.', nullable: true })
  @Column({ type: 'timestamp', nullable: true, default: null })
  acceptedAt: Date | null;

  @ApiProperty({ description: 'When it was revoked.', nullable: true })
  @Column({ type: 'timestamp', nullable: true, default: null })
  revokedAt: Date | null;
}
