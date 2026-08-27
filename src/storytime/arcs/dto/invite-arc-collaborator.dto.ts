import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { CollaborationInvitationStatus } from '../../enums/collaboration-invitation-status.enum';

/** Trims a string value, leaving anything else for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Invites somebody to help assemble an Arc.
 *
 * Every capability defaults to off, exactly as for Stories: an invitation that
 * grants nothing is a reasonable thing to send, and a far better default than
 * handing over the Arc by omission.
 */
export class InviteArcCollaboratorDto {
  @ApiProperty({ description: 'The member to invite.' })
  @IsUUID('4')
  readonly userId: string;

  @ApiPropertyOptional({
    description: 'What the curator calls this collaborator.',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  readonly collaborationRole?: string;

  @ApiPropertyOptional({ description: 'May change the Arc’s own details.' })
  @IsOptional()
  @IsBoolean()
  readonly canEditArc?: boolean;

  @ApiPropertyOptional({
    description: 'May invite Stories, answer requests and set the order.',
  })
  @IsOptional()
  @IsBoolean()
  readonly canManageStories?: boolean;

  @ApiPropertyOptional({
    description: 'May invite and remove other collaborators.',
  })
  @IsOptional()
  @IsBoolean()
  readonly canManageCollaborators?: boolean;

  // Rejected rather than ignored: a request that asks for it has
  // misunderstood something worth telling it about.
  @ApiPropertyOptional({
    description:
      'Never granted. Only the curator may publish; sending true is refused.',
  })
  @IsOptional()
  @IsBoolean()
  @Equals(false, {
    message: 'canPublish cannot be granted: only the curator may publish',
  })
  readonly canPublish?: boolean;
}

/**
 * An Arc collaboration as the team sees it.
 *
 * `canPublish` is not returned: it is always false and cannot be granted, so
 * sending it would only invite a client to build a control for something that
 * does not exist.
 */
export class ArcCollaboratorDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ description: 'The Arc.' })
  arcId: string;

  @ApiProperty({ description: 'The collaborating member.' })
  userId: string;

  @ApiProperty({
    description: 'What the curator calls them.',
    nullable: true,
  })
  collaborationRole: string | null;

  @ApiProperty({ description: 'May change the Arc’s own details.' })
  canEditArc: boolean;

  @ApiProperty({
    description: 'May invite Stories, answer requests and set the order.',
  })
  canManageStories: boolean;

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
