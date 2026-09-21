import { ApiPropertyOptional } from '@nestjs/swagger';

import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

import { SearchPaginatedQueryDto } from 'src/shared/dto/paginated-query.dto';

import {
  FleetDirectorySort,
  SORTS_WITHOUT_FRESHNESS,
} from '../enums/fleet-directory-sort.enum';
import { FleetDirectoryStatusFilter } from '../enums/fleet-directory-status-filter.enum';
import { FleetRecruitmentState } from '../enums/fleet-recruitment-state.enum';

/** The longest window the freshness filter accepts, in days. */
export const MAX_FRESHNESS_WINDOW_DAYS = 365;

/**
 * Reads a query-string boolean.
 *
 * Declared once here rather than inline three times, because a filter that
 * silently treated `?withRoster=false` as "present, therefore true" would
 * quietly return the opposite of what was asked for.
 *
 * @param value - The raw query value.
 * @returns The boolean it names, or the value unchanged so validation refuses.
 */
function toQueryBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true' || value === true) {
    return true;
  }

  if (value === 'false' || value === false) {
    return false;
  }

  return value;
}

/**
 * What every directory listing accepts.
 *
 * Search, paging and lifecycle state are the same three questions whichever
 * scope is being listed, so they are asked the same way. Everything a
 * particular scope has of its own is declared on its own subclass, because the
 * global `ValidationPipe` runs with `forbidNonWhitelisted: true` and an
 * undeclared parameter is refused rather than ignored — which is the point: a
 * caller filtering an Armada listing by recruitment state has misunderstood
 * something, and a `400` says so where a quietly ignored parameter would hand
 * them a list that looks filtered and is not.
 */
export class FleetDirectoryQueryDto extends SearchPaginatedQueryDto {
  @ApiPropertyOptional({
    enum: FleetDirectoryStatusFilter,
    default: FleetDirectoryStatusFilter.ACTIVE,
    description:
      'Which lifecycle states to include. Closed scopes are hidden unless ' +
      'asked for; they keep their web address either way.',
  })
  @IsOptional()
  @IsEnum(FleetDirectoryStatusFilter)
  readonly status?: FleetDirectoryStatusFilter;
}

/**
 * Query parameters accepted by the Fleet Community directory.
 */
export class FleetCommunityDirectoryQueryDto extends FleetDirectoryQueryDto {
  @ApiPropertyOptional({
    enum: SORTS_WITHOUT_FRESHNESS,
    default: FleetDirectorySort.NAME,
    description: 'Ordering. Nothing observes a Community, so no freshness.',
  })
  @IsOptional()
  @IsIn(SORTS_WITHOUT_FRESHNESS)
  readonly sort?: FleetDirectorySort;

  @ApiPropertyOptional({
    enum: FleetRecruitmentState,
    description: 'Only Communities with this recruitment posture.',
  })
  @IsOptional()
  @IsEnum(FleetRecruitmentState)
  readonly recruitmentState?: FleetRecruitmentState;
}

/**
 * Query parameters accepted by the Fleet directory.
 *
 * The platform filter matters more here than it looks. Two records with the
 * same name on Windows and on Xbox are different Fleets, so narrowing by
 * platform is how a reader stops comparing records that were never the same
 * thing.
 */
export class StoFleetDirectoryQueryDto extends FleetDirectoryQueryDto {
  @ApiPropertyOptional({
    enum: FleetDirectorySort,
    default: FleetDirectorySort.NAME,
    description: 'Ordering applied to the results.',
  })
  @IsOptional()
  @IsEnum(FleetDirectorySort)
  readonly sort?: FleetDirectorySort;

  @ApiPropertyOptional({ description: 'Only Fleets on this platform.' })
  @IsOptional()
  @IsUUID()
  readonly platformId?: string;

  @ApiPropertyOptional({
    enum: FleetRecruitmentState,
    description: 'Only Fleets with this recruitment posture.',
  })
  @IsOptional()
  @IsEnum(FleetRecruitmentState)
  readonly recruitmentState?: FleetRecruitmentState;

  @ApiPropertyOptional({
    description:
      'Only Fleets of this allegiance. An allegiance is never guessed, so a ' +
      'Fleet whose faction was not given is excluded by this filter rather ' +
      'than assumed to match.',
  })
  @IsOptional()
  @IsUUID()
  readonly allegianceFactionId?: string;

  @ApiPropertyOptional({
    description:
      'When true, only Fleets a roster has ever been imported for. When ' +
      'false, only Fleets none has.',
  })
  @IsOptional()
  @Transform(toQueryBoolean)
  @IsBoolean()
  readonly withRoster?: boolean;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_FRESHNESS_WINDOW_DAYS,
    description:
      'Only Fleets whose newest effective roster import is within this many ' +
      'days. Implies a roster exists, so it cannot be combined with ' +
      '`withRoster=false`.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_FRESHNESS_WINDOW_DAYS)
  readonly freshWithinDays?: number;
}

/**
 * Query parameters accepted by the Armada directory.
 *
 * No recruitment state and no freshness, because an Armada has neither: it
 * groups Fleets rather than recruiting players, and nothing imports a roster
 * for one.
 */
export class StoArmadaDirectoryQueryDto extends FleetDirectoryQueryDto {
  @ApiPropertyOptional({
    enum: SORTS_WITHOUT_FRESHNESS,
    default: FleetDirectorySort.NAME,
    description: 'Ordering. Nothing observes an Armada, so no freshness.',
  })
  @IsOptional()
  @IsIn(SORTS_WITHOUT_FRESHNESS)
  readonly sort?: FleetDirectorySort;

  @ApiPropertyOptional({ description: 'Only Armadas on this platform.' })
  @IsOptional()
  @IsUUID()
  readonly platformId?: string;
}
