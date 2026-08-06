import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The public face of a member as shown in a friend or blocked list.
 *
 * Carries exactly what the registry itself exposes — the username and avatar,
 * never the email, real name or user ID — so a friend list can never reveal
 * more about someone than their registry record already does.
 */
export class CommunityMemberDto {
  @ApiProperty({ example: 'captain.picard' })
  username: string;

  @ApiPropertyOptional({ nullable: true })
  profilePicture100: string | null;

  @ApiPropertyOptional({ nullable: true })
  profilePicture300: string | null;

  @ApiProperty({
    description: 'When the member joined STO Info.',
    example: '2026-01-14T09:21:00.000Z',
  })
  joinedAt: Date;

  @ApiPropertyOptional({
    description: 'When the member last signed in, or null if they never have.',
    nullable: true,
  })
  lastActiveAt: Date | null;

  @ApiProperty({
    description: 'Number of publicly visible STO accounts.',
    example: 2,
  })
  publicAccountCount: number;

  @ApiProperty({
    description: 'Number of publicly visible captains across those accounts.',
    example: 11,
  })
  publicCharacterCount: number;

  @ApiProperty({
    description:
      'Whether the member still has a public registry record. A friend who ' +
      'has since gone private stays in the list but can no longer be opened.',
    example: true,
  })
  publiclyVisible: boolean;
}
