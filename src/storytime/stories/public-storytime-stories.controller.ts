import {
  Controller,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { PaginatedStoriesDto, StoryQueryDto } from './dto/story-query.dto';
import { StoryDto } from './dto/story.dto';
import { StorytimeAuthorService } from '../shared/storytime-author.service';
import { StorytimeStoryMapper } from './storytime-story.mapper';
import { StorytimeStoryService } from './storytime-story.service';

/** Where a retired Story slug redirects to. */
const STORY_PATH_PREFIX = '/api/storytime/stories';

/**
 * Reading Stories, without needing an account.
 *
 * Unauthenticated throughout: published Stories are readable by anyone.
 */
@ApiTags('Storytime')
@Controller('storytime/stories')
export class PublicStorytimeStoriesController {
  /**
   * Creates an instance of PublicStorytimeStoriesController.
   *
   * @param _storyService - The Story service.
   * @param _mapper - Maps Stories to their response shapes.
   * @param _featureService - Reports whether public reading is switched on.
   */
  constructor(
    private readonly _storyService: StorytimeStoryService,
    private readonly _mapper: StorytimeStoryMapper,
    private readonly _authorService: StorytimeAuthorService,
    private readonly _featureService: StorytimeFeatureService,
  ) {}

  /**
   * Lists publicly readable Stories, newest first.
   *
   * @param query - Paging and filtering options.
   * @returns A page of Stories.
   */
  @Get()
  @ApiOperation({ summary: 'List published Stories' })
  @ApiOkResponse({ type: PaginatedStoriesDto })
  async findAll(@Query() query: StoryQueryDto): Promise<PaginatedStoriesDto> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
    );

    const result = await this._storyService.findPublicPaginated(query);

    return {
      items: this._mapper.toPublicList(result.items),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  /**
   * Retrieves a published Story by slug.
   *
   * A slug the Story used to have redirects permanently to its current URL,
   * so links shared before a rename keep working and search engines consolidate
   * on one address rather than treating the two as duplicates.
   *
   * @param slug - The Story slug from the URL.
   * @param response - Used to issue the redirect for a retired slug.
   * @returns The Story, or nothing when a redirect was issued instead.
   * @throws NotFoundException when no readable Story matches.
   */
  @Get(':slug')
  @ApiOperation({ summary: 'Retrieve a published Story by slug' })
  @ApiOkResponse({ type: StoryDto })
  @ApiResponse({
    status: HttpStatus.MOVED_PERMANENTLY,
    description:
      'The slug is a former slug; the response redirects to the current URL.',
  })
  @ApiNotFoundResponse({ description: 'No readable Story matches the slug.' })
  async findOne(
    @Param('slug') slug: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StoryDto | undefined> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
    );

    const story = await this._storyService.findPublicBySlug(slug);

    if (story) {
      return this._mapper.toPublic(
        story,
        await this._authorService.findAuthor(story.ownerUserId),
      );
    }

    const renamed = await this._storyService.findPublicByRetiredSlug(slug);

    if (renamed) {
      response.status(HttpStatus.MOVED_PERMANENTLY);
      response.setHeader(
        'Location',
        `${STORY_PATH_PREFIX}/${encodeURIComponent(renamed.slug)}`,
      );
      return undefined;
    }

    throw new NotFoundException('Story not found');
  }
}
