import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../../user/enums/user-role.enum';

/**
 * A member as the admin user list shows them.
 *
 * Carries the email because it is the only identifier that always exists — a
 * member may never have set a profile username — and administrators need to
 * match an account against the report or support request in front of them.
 */
export class ModeratedUserDto {
  @ApiProperty({ description: 'The member’s user ID.' })
  id: string;

  @ApiProperty({ description: 'The member’s email address.' })
  email: string;

  @ApiPropertyOptional({
    description: 'The member’s profile username, if they have one.',
    nullable: true,
  })
  username: string | null;

  @ApiProperty({ description: 'The member’s role.', enum: UserRole })
  role: UserRole;

  @ApiProperty({ description: 'Whether the account is currently disabled.' })
  isAccountDisabled: boolean;

  @ApiPropertyOptional({
    description: 'When the account was disabled.',
    nullable: true,
  })
  disabledAt: Date | null;

  @ApiPropertyOptional({
    description: 'Why the account was disabled.',
    nullable: true,
  })
  disabledReason: string | null;

  @ApiPropertyOptional({
    description: 'When the member last signed in.',
    nullable: true,
  })
  lastLoginAt: Date | null;

  @ApiProperty({ description: 'When the member registered.' })
  createdAt: Date;

  @ApiProperty({
    description: 'How many unresolved reports name this member.',
  })
  openReportCount: number;
}

/**
 * A page of members.
 */
export class PaginatedModeratedUsersDto {
  @ApiProperty({
    description: 'The members on this page.',
    type: [ModeratedUserDto],
  })
  items: ModeratedUserDto[];

  @ApiProperty({ description: 'Total members matching the query.' })
  total: number;

  @ApiProperty({ description: 'The 1-based page number.' })
  page: number;

  @ApiProperty({ description: 'Items per page.' })
  pageSize: number;
}
