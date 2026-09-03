import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { RelationshipDto } from '../../community/dto/friendship.dto';
import { PublicMemberSummaryDto } from '../../shared/dto/public-member-summary.dto';
import { RegistryAccountSummaryDto } from './registry-account.dto';

/**
 * Public summary of a registry member.
 *
 * Deliberately omits the user's email, id, role and real name — the profile
 * username is the only identity shown.
 */
export class RegistryProfileSummaryDto extends PublicMemberSummaryDto {
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
