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

import { StorytimeStoryArcsService } from '../arcs/storytime-story-arcs.service';
import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeAuthorService } from '../shared/storytime-author.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeTagMapper } from '../tags/storytime-tag.mapper';
import { StorytimeTaggingService } from '../tags/storytime-tagging.service';
import { PaginatedStoriesDto, StoryQueryDto } from './dto/story-query.dto';
import { StoryDto } from './dto/story.dto';
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
   * @param _authorService - Names whoever published a Story.
   * @param _storyArcsService - Names the Arcs a Story is read as part of.
   * @param _taggingService - Reads what a Story is tagged with.
   * @param _tagMapper - Maps those tags to their response shape.
   * @param _featureService - Reports whether public reading is switched on.
   */
  constructor(
    private readonly _storyService: StorytimeStoryService,
    private readonly _mapper: StorytimeStoryMapper,
    private readonly _authorService: StorytimeAuthorService,
    private readonly _storyArcsService: StorytimeStoryArcsService,
    private readonly _taggingService: StorytimeTaggingService,
    private readonly _tagMapper: StorytimeTagMapper,
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

    // One lookup apiece for the whole page. A reader scanning a listing is
    // choosing what to open, and who wrote a Story, what it is about and which
    // reading order it belongs to decide that as much as its title does —
    // asking them to open it to find out is the wrong way round.
    const storyIds = result.items.map(story => story.id);
    const [tagsByTarget, authors, arcs] = await Promise.all([
      this._taggingService.findForMany(StorytimeTargetType.STORY, storyIds),
      this._authorService.findAuthors(
        result.items.map(story => story.ownerUserId),
      ),
      this._storyArcsService.findForStories(storyIds),
    ]);

    return {
      items: this._mapper.toPublicList(
        result.items,
        this._tagMapper.toListsByTarget(tagsByTarget),
        authors,
        arcs,
      ),
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
        this._tagMapper.toList(
          await this._taggingService.findFor(
            StorytimeTargetType.STORY,
            story.id,
          ),
        ),
        await this._storyArcsService.findForStory(story.id),
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
