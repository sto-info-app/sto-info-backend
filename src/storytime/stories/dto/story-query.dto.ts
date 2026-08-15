import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginatedQueryDto } from '../../../shared/dto/paginated-query.dto';
import { STORYTIME_LANGUAGE_CODES } from '../../constants/storytime-language.constants';
import { CompletionState } from '../../enums/completion-state.enum';
import { ContentRating } from '../../enums/content-rating.enum';

/**
 * Filters for the public Story listing.
 */
export class StoryQueryDto extends PaginatedQueryDto {
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
