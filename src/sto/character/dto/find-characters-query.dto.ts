import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsEnum, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

import {
  CharacterSortBy,
  CharacterSortOrder,
  DEFAULT_CHARACTER_SORT_BY,
  DEFAULT_CHARACTER_SORT_ORDER,
} from '../character-sort.utility';

/**
 * Listing options for an account's captains.
 *
 * Pinned captains always lead, whichever ordering is asked for.
 */
export class FindCharactersQueryDto {
  @ApiProperty({
    description: 'The account whose captains to list.',
  })
  @IsNotEmpty()
  @IsUUID()
  accountId: string;

  @ApiPropertyOptional({
    description: 'Field to order the captains by.',
    enum: CharacterSortBy,
    default: DEFAULT_CHARACTER_SORT_BY,
  })
  @IsOptional()
  @IsEnum(CharacterSortBy)
  sortBy?: CharacterSortBy;

  @ApiPropertyOptional({
    description: 'Direction to order the captains in.',
    enum: CharacterSortOrder,
    default: DEFAULT_CHARACTER_SORT_ORDER,
  })
  @IsOptional()
  @IsEnum(CharacterSortOrder)
  sortOrder?: CharacterSortOrder;
}
