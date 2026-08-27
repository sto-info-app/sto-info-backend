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

/** Trims a string value, leaving anything else for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Invites somebody to collaborate on a Story.
 *
 * Every capability defaults to off. An invitation that grants nothing is a
 * perfectly reasonable thing to send — it says "come and look" — and it is a
 * far better default than handing over the Story by omission.
 */
export class InviteCollaboratorDto {
  @ApiProperty({ description: 'The member to invite.' })
  @IsUUID('4')
  readonly userId: string;

  @ApiPropertyOptional({
    description: 'What the owner calls this collaborator, for their own list.',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  readonly collaborationRole?: string;

  @ApiPropertyOptional({ description: 'May change the Story’s own details.' })
  @IsOptional()
  @IsBoolean()
  readonly canEditStory?: boolean;

  @ApiPropertyOptional({ description: 'May write and edit Chapters.' })
  @IsOptional()
  @IsBoolean()
  readonly canManageChapters?: boolean;

  @ApiPropertyOptional({ description: 'May manage the cast.' })
  @IsOptional()
  @IsBoolean()
  readonly canManageCharacters?: boolean;

  @ApiPropertyOptional({ description: 'May manage Crew credits.' })
  @IsOptional()
  @IsBoolean()
  readonly canManageCrew?: boolean;

  @ApiPropertyOptional({
    description: 'May invite and remove other collaborators.',
  })
  @IsOptional()
  @IsBoolean()
  readonly canManageCollaborators?: boolean;

  // Rejected rather than ignored. Only the owner may publish, and a request
  // that asks otherwise has misunderstood something worth telling it about
  // rather than quietly dropping.
  @ApiPropertyOptional({
    description:
      'Never granted. Only the owner may publish; sending true is refused.',
  })
  @IsOptional()
  @IsBoolean()
  @Equals(false, {
    message: 'canPublish cannot be granted: only the owner may publish',
  })
  readonly canPublish?: boolean;
}
