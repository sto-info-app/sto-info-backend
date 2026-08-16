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
 * Somebody the owner has invited to help write a Story.
 *
 * This table, and only this table, decides who may edit a Story besides its
 * owner. A Crew credit is public acknowledgement and confers nothing: the two
 * are deliberately separate, so thanking somebody in the credits can never
 * hand them the keys.
 *
 * Access comes only from an `ACCEPTED` invitation. An invitation nobody has
 * answered grants nothing, which is what stops an owner from quietly adding
 * somebody to a Story without their agreement.
 */
@Entity({ name: 'storytime_story_collaborator' })
@Index(['userId', 'invitationStatus'])
export class StorytimeStoryCollaboratorEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Story being collaborated on.' })
  @Column({ type: 'uuid', nullable: false })
  storyId: string;

  @ApiProperty({ description: 'The invited member.' })
  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @ApiProperty({
    description: 'What the owner calls this collaborator, for their own list.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  collaborationRole: string | null;

  @ApiProperty({ description: 'May change the Story’s own details.' })
  @Column({ type: 'boolean', nullable: false, default: false })
  canEditStory: boolean;

  @ApiProperty({ description: 'May write and edit Chapters.' })
  @Column({ type: 'boolean', nullable: false, default: false })
  canManageChapters: boolean;

  @ApiProperty({
    description:
      'May publish. Never granted today — only the owner may publish — and refused by both the DTO and a check constraint.',
  })
  @Column({ type: 'boolean', nullable: false, default: false })
  canPublish: boolean;

  @ApiProperty({ description: 'May manage the cast.' })
  @Column({ type: 'boolean', nullable: false, default: false })
  canManageCharacters: boolean;

  @ApiProperty({ description: 'May manage Crew credits.' })
  @Column({ type: 'boolean', nullable: false, default: false })
  canManageCrew: boolean;

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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
