import { ApiPropertyOptional } from '@nestjs/swagger';

import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { SearchPaginatedQueryDto } from 'src/shared/dto/paginated-query.dto';

import { RosterSort, RosterSortDirection } from '../enums/roster-sort.enum';

/**
 * What a reader of a Fleet's roster asks for (FC-020).
 *
 * `search` matches a Character name or an account handle, case-insensitively
 * and anywhere in it.
 */
export class RosterQueryDto extends SearchPaginatedQueryDto {
  @ApiPropertyOptional({
    description:
      'Show the roster as the last effective export at or before this ' +
      'instant listed it. The latest export when omitted.',
    example: '2024-11-15T23:59:59.999Z',
  })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  readonly asOf?: string;

  @ApiPropertyOptional({
    enum: RosterSort,
    description: 'How the rows are ordered. NAME when omitted.',
  })
  @IsOptional()
  @IsEnum(RosterSort)
  readonly sort?: RosterSort;

  @ApiPropertyOptional({
    enum: RosterSortDirection,
    description: 'Which way the ordering runs. ASC when omitted.',
  })
  @IsOptional()
  @IsEnum(RosterSortDirection)
  readonly direction?: RosterSortDirection;

  @ApiPropertyOptional({
    description: 'Only rows with exactly this rank label.',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  readonly rank?: string;
}
