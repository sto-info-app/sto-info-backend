import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Trims a string value, leaving anything else for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * A member who may be named in a Story's credits.
 *
 * Carries the username and nothing else identifying. A credit is written
 * against a username and the server resolves it, so no user identifier ever
 * has to leave the server for crediting to work — the same rule the registry
 * listing keeps.
 */
export class CreditableMemberDto {
  @ApiProperty({
    description: 'The member’s profile username.',
    example: 'captain.picard',
  })
  username: string;

  @ApiProperty({
    description: 'Their avatar, or null when they have not set one.',
    nullable: true,
  })
  profilePicture100: string | null;

  @ApiProperty({
    description:
      'Whether they are already working on this Story, rather than found ' +
      'through their public profile.',
  })
  isCollaborator: boolean;
}

/**
 * What to search the creditable members by.
 *
 * Every accepted parameter must be declared here — the global `ValidationPipe`
 * runs with `forbidNonWhitelisted: true`, so undeclared params are rejected.
 */
export class CreditableMembersQueryDto {
  @ApiPropertyOptional({
    description:
      'Part of a username to match. Omitted, only the Story’s own ' +
      'collaborators come back.',
    minLength: 2,
    maxLength: 50,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  readonly search?: string;
}
