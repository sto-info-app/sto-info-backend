import { ApiPropertyOptional } from '@nestjs/swagger';

import { IsEnum, IsOptional } from 'class-validator';

import {
  AccountSortBy,
  AccountSortOrder,
  DEFAULT_ACCOUNT_SORT_BY,
  DEFAULT_ACCOUNT_SORT_ORDER,
} from '../account-sort.utility';

/**
 * Ordering options for listing the authenticated user's STO accounts.
 *
 * Pinned accounts always lead, whichever ordering is asked for.
 */
export class FindAccountsQueryDto {
  @ApiPropertyOptional({
    description: 'Field to order the accounts by.',
    enum: AccountSortBy,
    default: DEFAULT_ACCOUNT_SORT_BY,
  })
  @IsOptional()
  @IsEnum(AccountSortBy)
  sortBy?: AccountSortBy;

  @ApiPropertyOptional({
    description: 'Direction to order the accounts in.',
    enum: AccountSortOrder,
    default: DEFAULT_ACCOUNT_SORT_ORDER,
  })
  @IsOptional()
  @IsEnum(AccountSortOrder)
  sortOrder?: AccountSortOrder;
}
