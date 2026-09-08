import { ApiProperty } from '@nestjs/swagger';

import { CollaborationInvitationStatus } from '../../enums/collaboration-invitation-status.enum';

/**
 * A collaboration as the Story's team sees it.
 *
 * `canPublish` is not returned. It is always false, cannot be granted, and
 * sending it would only invite a client to build a control for something that
 * does not exist.
 */
export class CollaboratorDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ description: 'The Story.' })
  storyId: string;

  @ApiProperty({ description: 'The collaborating member.' })
  userId: string;

  @ApiProperty({
    description: 'What the owner calls this collaborator.',
    nullable: true,
  })
  collaborationRole: string | null;

  @ApiProperty({ description: 'May change the Story’s own details.' })
  canEditStory: boolean;

  @ApiProperty({ description: 'May write and edit Chapters.' })
  canManageChapters: boolean;

  @ApiProperty({ description: 'May manage the cast.' })
  canManageCharacters: boolean;

  @ApiProperty({ description: 'May manage Crew credits.' })
  canManageCrew: boolean;

  @ApiProperty({ description: 'May invite and remove other collaborators.' })
  canManageCollaborators: boolean;

  @ApiProperty({
    enum: CollaborationInvitationStatus,
    description: 'Where the invitation has got to.',
  })
  invitationStatus: CollaborationInvitationStatus;

  @ApiProperty({ description: 'Who sent the invitation.' })
  invitedByUserId: string;

  @ApiProperty({ description: 'When the invitation was sent.' })
  invitedAt: Date;

  @ApiProperty({ description: 'When it was accepted.', nullable: true })
  acceptedAt: Date | null;
}
