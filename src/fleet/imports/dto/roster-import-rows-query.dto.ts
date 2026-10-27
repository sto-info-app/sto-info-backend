import { ApiPropertyOptional } from '@nestjs/swagger';

import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { RosterSortDirection } from 'src/fleet/roster/enums/roster-sort.enum';
import { SearchPaginatedQueryDto } from 'src/shared/dto/paginated-query.dto';

import { RosterImportRowSort } from '../enums/roster-import-row-sort.enum';

/**
 * What a reader of one import's rows asks for (FC-055).
 *
 * The same shape as the roster page's query, so an investigator finds rows
 * here the way they find members there. `search` matches a Character name
 * or an account handle, case-insensitively and anywhere in it.
 */
export class RosterImportRowsQueryDto extends SearchPaginatedQueryDto {
  @ApiPropertyOptional({
    enum: RosterImportRowSort,
    description: 'How the rows are ordered. LINE when omitted.',
  })
  @IsOptional()
  @IsEnum(RosterImportRowSort)
  readonly sort?: RosterImportRowSort;

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
