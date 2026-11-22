import { ApiPropertyOptional } from '@nestjs/swagger';

import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { PaginatedQueryDto } from 'src/shared/dto/paginated-query.dto';

import {
  FleetDirectorySort,
  SORTS_WITHOUT_FRESHNESS,
} from '../enums/fleet-directory-sort.enum';
import { FleetDirectoryStatusFilter } from '../enums/fleet-directory-status-filter.enum';
import { FleetRecruitmentState } from '../enums/fleet-recruitment-state.enum';

/** The longest window the freshness filter accepts, in days. */
export const MAX_FRESHNESS_WINDOW_DAYS = 365;

/**
 * The longest search term any listing accepts.
 *
 * The longest name any scope holds — a Community's 120 characters, against a
 * Fleet's or an Armada's 64 — so every name can be searched for in full.
 * `MaxLength` counts a surrogate pair as one character, as the name rules do,
 * so a name written outside the basic plane fits as well. The directory's
 * search box stops at the same figure.
 */
export const MAX_DIRECTORY_SEARCH_LENGTH = 120;

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
 * Reads a search for an exact in-game name.
 *
 * Kept as typed, edge spaces and all (ADR-0003): a Fleet called `" Omega"`
 * and one called `"Omega"` are two Fleets, and a search that trimmed the
 * first space away could never tell a reader which of them they found. A
 * term that is nothing but spaces is no search at all rather than a search
 * for names containing a space, which is nearly every name with two words.
 *
 * @param value - The raw query value.
 * @returns The term unchanged, undefined for a blank one, or anything else
 *   unchanged so validation refuses it.
 */
function toExactNameSearch({ value }: { value: unknown }): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

/**
 * What every directory listing accepts.
 *
 * Search, paging and lifecycle state are the same three questions whichever
 * scope is being listed, so they are asked the same way — though a search
 * is read by the subclass, since a Community's name is trimmed and a Fleet's
 * or an Armada's is held exactly. Everything a
 * particular scope has of its own is declared on its own subclass, because the
 * global `ValidationPipe` runs with `forbidNonWhitelisted: true` and an
 * undeclared parameter is refused rather than ignored — which is the point: a
 * caller filtering an Armada listing by recruitment state has misunderstood
 * something, and a `400` says so where a quietly ignored parameter would hand
 * them a list that looks filtered and is not.
 */
export class FleetDirectoryQueryDto extends PaginatedQueryDto {
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
 * A listing of scopes whose names are exact in-game names.
 *
 * The search is taken exactly as typed, so a leading or trailing space
 * finds the names that carry one. Matching still folds case and still
 * matches any part of the name.
 */
export class ExactNameDirectoryQueryDto extends FleetDirectoryQueryDto {
  @ApiPropertyOptional({
    description:
      'Case-insensitive partial match on the in-game name. Spaces at either ' +
      'end are kept, because they are part of the name; a term of spaces ' +
      'alone is ignored.',
    example: ' Omega',
    maxLength: MAX_DIRECTORY_SEARCH_LENGTH,
  })
  @IsOptional()
  @Transform(toExactNameSearch)
  @IsString()
  @MaxLength(MAX_DIRECTORY_SEARCH_LENGTH)
  readonly search?: string;
}

/**
 * Query parameters accepted by the Fleet Community directory.
 *
 * A Community's name is this site's own and is trimmed when it is saved, so
 * its search is trimmed too.
 */
export class FleetCommunityDirectoryQueryDto extends FleetDirectoryQueryDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive partial match.',
    example: 'Jupiter',
    maxLength: MAX_DIRECTORY_SEARCH_LENGTH,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(MAX_DIRECTORY_SEARCH_LENGTH)
  readonly search?: string;

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
export class StoFleetDirectoryQueryDto extends ExactNameDirectoryQueryDto {
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
export class StoArmadaDirectoryQueryDto extends ExactNameDirectoryQueryDto {
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
