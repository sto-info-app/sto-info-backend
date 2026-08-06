import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RelationshipDto } from '../../community/dto/friendship.dto';
import { RegistryAccountSummaryDto } from './registry-account.dto';

/**
 * Public summary of a registry member.
 *
 * Deliberately omits the user's email, id, role and real name — the profile
 * username is the only identity shown.
 */
export class RegistryProfileSummaryDto {
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

  @ApiPropertyOptional({
    description:
      'How the authenticated caller relates to this member, and the row IDs ' +
      'the matching action needs. Null for anonymous callers.',
    type: RelationshipDto,
    nullable: true,
  })
  relationship: RelationshipDto | null;
}

/**
 * Public detail view of a registry member, including their visible accounts.
 */
export class RegistryProfileDto extends RegistryProfileSummaryDto {
  @ApiProperty({ type: [RegistryAccountSummaryDto] })
  accounts: RegistryAccountSummaryDto[];
}

/**
 * A page of registry member summaries.
 */
export class PaginatedRegistryProfilesDto {
  @ApiProperty({ type: [RegistryProfileSummaryDto] })
  items: RegistryProfileSummaryDto[];

  @ApiProperty({ example: 128 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 12 })
  pageSize: number;
}
