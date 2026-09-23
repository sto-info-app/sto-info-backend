import { ApiProperty } from '@nestjs/swagger';

import { RosterImportSourceDto } from './roster-import-source.dto';

/**
 * A page of a Fleet's imports, newest first.
 *
 * Offset paging, matching every other listing in the application.
 */
export class RosterImportPageDto {
  @ApiProperty({ type: [RosterImportSourceDto] })
  items: RosterImportSourceDto[];

  @ApiProperty({ description: 'How many imports the Fleet has.', example: 42 })
  total: number;

  @ApiProperty({ description: 'The page returned.', example: 1 })
  page: number;

  @ApiProperty({ description: 'Imports per page.', example: 20 })
  pageSize: number;
}
