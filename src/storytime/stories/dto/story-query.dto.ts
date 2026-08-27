import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginatedQueryDto } from '../../../shared/dto/paginated-query.dto';
import { STORYTIME_LANGUAGE_CODES } from '../../constants/storytime-language.constants';
import { CompletionState } from '../../enums/completion-state.enum';
import { ContentRating } from '../../enums/content-rating.enum';

/**
 * How a listing of Stories is ordered.
 *
 * Two different questions, which is why they are two orderings rather than one
 * "recent": a reader looking for something new wants what was published last,
 * and a reader following work in progress wants what was written in last.
 */
export enum StorySort {
  /** Newest publications first. */
  RECENTLY_PUBLISHED = 'RECENTLY_PUBLISHED',
  /** Most recently changed first, which surfaces new Chapters. */
  RECENTLY_UPDATED = 'RECENTLY_UPDATED',
}

/**
 * Filters for the public Story listing.
 */
export class StoryQueryDto extends PaginatedQueryDto {
  @ApiPropertyOptional({
    enum: StorySort,
    description: 'How to order the results.',
    default: StorySort.RECENTLY_PUBLISHED,
  })
  @IsOptional()
  @IsEnum(StorySort)
  readonly sort?: StorySort;

  @ApiPropertyOptional({
    enum: ContentRating,
    description: 'Show only Stories with this rating.',
  })
  @IsOptional()
  @IsEnum(ContentRating)
  readonly contentRating?: ContentRating;

  @ApiPropertyOptional({
    description: 'Show only Stories written in this language.',
    enum: STORYTIME_LANGUAGE_CODES,
  })
  @IsOptional()
  @IsIn(STORYTIME_LANGUAGE_CODES)
  readonly languageCode?: string;

  @ApiPropertyOptional({
    enum: CompletionState,
    description: 'Show only Stories in this state of completion.',
  })
  @IsOptional()
  @IsEnum(CompletionState)
  readonly completionState?: CompletionState;

  @ApiPropertyOptional({ description: 'Show only Stories by this creator.' })
  @IsOptional()
  @IsUUID('4')
  readonly ownerUserId?: string;
}

/**
 * A page of publicly readable Stories.
 */
export class PaginatedStoriesDto {
  @ApiPropertyOptional({ description: 'The Stories on this page.' })
  readonly items: unknown[];

  @ApiPropertyOptional({ description: 'Total Stories matching the filters.' })
  readonly total: number;

  @ApiPropertyOptional({ description: 'The page returned.' })
  readonly page: number;

  @ApiPropertyOptional({ description: 'How many Stories are on a page.' })
  readonly pageSize: number;
}
