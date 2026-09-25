import { ApiPropertyOptional } from '@nestjs/swagger';

import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

import { RosterChangeKind } from '../../projection/enums/roster-change-kind.enum';

/**
 * The kinds of change the History tab lists (FC-020).
 *
 * Contribution rises and resets are left to the interval totals, the
 * member's timeline and the contribution report (Steve's decision of 25
 * September 2026): on a real Fleet they would be most of the list.
 */
export const ROSTER_HISTORY_KINDS: readonly RosterChangeKind[] = [
  RosterChangeKind.JOINED,
  RosterChangeKind.REJOINED,
  RosterChangeKind.LEFT,
  RosterChangeKind.RENAMED,
  RosterChangeKind.RANK_CHANGED,
  RosterChangeKind.JOIN_DATE_CHANGED,
];

/** How many intervals a history page carries unless asked for fewer. */
export const ROSTER_HISTORY_PAGE_SIZE = 10;

/** What a reader of a Fleet's roster history asks for. */
export class RosterHistoryQueryDto {
  @ApiPropertyOptional({ description: 'Page number (1-based).', minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number;

  @ApiPropertyOptional({
    description: 'Intervals per page.',
    minimum: 1,
    maximum: ROSTER_HISTORY_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ROSTER_HISTORY_PAGE_SIZE)
  readonly pageSize?: number;

  @ApiPropertyOptional({
    description:
      'Only these kinds of change, comma-separated. Every listed kind when ' +
      'omitted.',
    enum: ROSTER_HISTORY_KINDS,
    isArray: true,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.split(',').map(kind => kind.trim())
      : value,
  )
  @IsArray()
  @ArrayUnique()
  @IsIn(ROSTER_HISTORY_KINDS, { each: true })
  readonly kinds?: RosterChangeKind[];
}
