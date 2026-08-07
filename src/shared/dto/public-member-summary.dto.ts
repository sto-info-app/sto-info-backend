import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Public member fields shared across community and registry responses.
 */
export class PublicMemberSummaryDto {
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

  @ApiPropertyOptional({
    description:
      'When the member started playing STO, taken from the oldest of their ' +
      'publicly visible accounts. Null when none of them records a date.',
    nullable: true,
  })
  playingSince: Date | null;

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
}