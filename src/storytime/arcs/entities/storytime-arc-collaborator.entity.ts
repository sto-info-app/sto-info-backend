import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { CollaborationInvitationStatus } from '../../enums/collaboration-invitation-status.enum';

/**
 * Somebody the curator has invited to help assemble an Arc.
 *
 * Mirrors Story collaboration deliberately: access comes only from an accepted
 * invitation, publishing is never delegated, and the capabilities are named
 * one by one rather than bundled into a role. Somebody brought in to chase up
 * Story owners has not thereby been handed the Arc itself.
 */
@Entity({ name: 'storytime_arc_collaborator' })
@Index(['userId', 'invitationStatus'])
export class StorytimeArcCollaboratorEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Arc being helped with.' })
  @Column({ type: 'uuid', nullable: false })
  arcId: string;

  @ApiProperty({ description: 'The invited member.' })
  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @ApiProperty({
    description: 'What the curator calls this collaborator.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  collaborationRole: string | null;

  @ApiProperty({ description: 'May change the Arc’s own details.' })
  @Column({ type: 'boolean', nullable: false, default: false })
  canEditArc: boolean;

  @ApiProperty({
    description: 'May invite Stories, answer requests and set the order.',
  })
  @Column({ type: 'boolean', nullable: false, default: false })
  canManageStories: boolean;

  @ApiProperty({ description: 'May invite and remove other collaborators.' })
  @Column({ type: 'boolean', nullable: false, default: false })
  canManageCollaborators: boolean;

  @ApiProperty({
    description:
      'May publish. Never granted — only the curator may publish — and refused by both the DTO and a check constraint.',
  })
  @Column({ type: 'boolean', nullable: false, default: false })
  canPublish: boolean;

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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
