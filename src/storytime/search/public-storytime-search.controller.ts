import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { SearchQueryDto, SearchResultsDto } from './dto/search-query.dto';
import { StorytimeSearchService } from './storytime-search.service';

/**
 * Searching Storytime, without needing an account.
 *
 * Finding something to read is the least private thing anybody does here, and
 * requiring a sign-in to look would only push people to a search engine that
 * indexes the same pages anyway.
 */
@ApiTags('Storytime')
@Controller('storytime/search')
export class PublicStorytimeSearchController {
  /**
   * Creates an instance of PublicStorytimeSearchController.
   *
   * @param _searchService - The search service.
   * @param _featureService - Reports whether public reading is switched on.
   */
  constructor(
    private readonly _searchService: StorytimeSearchService,
    private readonly _featureService: StorytimeFeatureService,
  ) {}

  /**
   * Searches published Stories, Chapters, Characters and Arcs.
   *
   * @param query - What to look for, and what to look in.
   * @returns The page of results.
   */
  @Get()
  @ApiOperation({ summary: 'Search published Storytime content' })
  @ApiOkResponse({ type: SearchResultsDto })
  async search(@Query() query: SearchQueryDto): Promise<SearchResultsDto> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
    );

    const results = await this._searchService.search(query);

    return {
      // The rank is what ordered the results; it means nothing to a reader and
      // would only invite a client to render it.
      items: results.items.map(({ rank, ...hit }) => {
        void rank;
        return hit;
      }),
      total: results.total,
      page: results.page,
      pageSize: results.pageSize,
      countsByType: results.countsByType,
    };
  }
}
