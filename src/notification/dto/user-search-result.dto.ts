import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { UserRole } from '../../user/enums/user-role.enum';

/**
 * One user returned by the admin user-search endpoint.
 *
 * No email address. These notifications are read inside the site, not sent to
 * anybody's inbox, and putting an address on the screen that chooses a
 * recipient invited the reading that one was about to be emailed.
 *
 * The member is named the way they are named everywhere else — by username —
 * with their real name beside it for an administrator who knows the person
 * rather than the handle. The role and the last sign-in come with it because
 * two accounts often read alike by name alone, and those two facts are what
 * tell an administrator which of them they meant: what the account is allowed
 * to do, and whether it is still in use.
 */
export class UserSearchResultDto {
  @ApiProperty({ description: 'The user UUID.' })
  id: string;

  @ApiProperty({ description: 'The username.' })
  username: string;

  @ApiPropertyOptional({
    description: 'The member’s real name, when they have given one.',
    nullable: true,
  })
  fullName: string | null;

  @ApiProperty({ description: 'The member’s role.', enum: UserRole })
  role: UserRole;

  @ApiPropertyOptional({
    description: 'When the member last signed in, if they ever have.',
    nullable: true,
  })
  lastLoginAt: Date | null;
}

/**
 * A paginated page of user-search results.
 */
export class UserSearchPageDto {
  @ApiProperty({ type: [UserSearchResultDto] })
  items: UserSearchResultDto[];

  @ApiProperty({ description: 'Total matching users.' })
  total: number;

  @ApiProperty({ description: 'The page returned.' })
  page: number;

  @ApiProperty({ description: 'Results per page.' })
  pageSize: number;
}
