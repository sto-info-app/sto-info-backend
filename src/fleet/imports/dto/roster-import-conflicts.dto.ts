import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsEnum, IsOptional } from 'class-validator';

import { PaginatedQueryDto } from 'src/shared/dto/paginated-query.dto';

import { RosterImportConflictFilter } from '../enums/roster-import-conflict-filter.enum';
import { RosterImportSourceDto } from './roster-import-source.dto';

/** What a reader of a Fleet's conflict groups asks for (FC-020). */
export class RosterImportConflictQueryDto extends PaginatedQueryDto {
  @ApiPropertyOptional({
    enum: RosterImportConflictFilter,
    description: 'Which groups. OPEN when omitted.',
  })
  @IsOptional()
  @IsEnum(RosterImportConflictFilter)
  readonly state?: RosterImportConflictFilter;
}

/**
 * Exports of one Fleet that claim one moment and disagree, and which of them
 * stands.
 */
export class RosterImportConflictGroupDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'The moment every export in it claims.' })
  exportedAt: Date;

  @ApiProperty({ description: 'When the disagreement was found.' })
  openedAt: Date;

  @ApiProperty({
    nullable: true,
    description:
      'When somebody last settled it, or null while it waits: never ' +
      'settled, or reopened by an export that disagrees with the selection.',
  })
  resolvedAt: Date | null;

  @ApiProperty({
    nullable: true,
    description:
      'The export selected to stand for the moment. A reopened group keeps ' +
      'the one it had.',
  })
  selectedImportId: string | null;

  @ApiProperty({
    type: [RosterImportSourceDto],
    description: 'Its exports, in the order they arrived.',
  })
  members: RosterImportSourceDto[];
}

/** A page of a Fleet's conflict groups, latest moment first. */
export class RosterImportConflictPageDto {
  @ApiProperty({ type: [RosterImportConflictGroupDto] })
  items: RosterImportConflictGroupDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;
}
