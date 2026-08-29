import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { ChapterSummaryDto, ChapterWithNavigationDto } from './dto/chapter.dto';
import { StorytimeAuthorService } from '../shared/storytime-author.service';
import { StorytimeChapterMapper } from './storytime-chapter.mapper';
import { StorytimeChapterService } from './storytime-chapter.service';

/**
 * Reading Chapters, without needing an account.
 *
 * Chapters are reached through their Story, so every route resolves the Story
 * first and refuses if it is not publicly readable. That single check is what
 * keeps a published Chapter inside a private Story unreachable.
 */
@ApiTags('Storytime')
@Controller('storytime/stories/:storySlug/chapters')
export class PublicStorytimeChaptersController {
  /**
   * Creates an instance of PublicStorytimeChaptersController.
   *
   * @param _chapterService - The Chapter service.
   * @param _storyService - Resolves and gates the owning Story.
   * @param _mapper - Maps Chapters to their response shapes.
   * @param _featureService - Reports whether public reading is switched on.
   */
  constructor(
    private readonly _chapterService: StorytimeChapterService,
    private readonly _storyService: StorytimeStoryService,
    private readonly _mapper: StorytimeChapterMapper,
    private readonly _authorService: StorytimeAuthorService,
    private readonly _featureService: StorytimeFeatureService,
  ) {}

  /**
   * Lists the readable Chapters of a Story, in reading order.
   *
   * @param storySlug - The Story slug.
   * @returns The Chapter summaries.
   */
  @Get()
  @ApiOperation({ summary: 'List the Chapters of a published Story' })
  @ApiOkResponse({ type: [ChapterSummaryDto] })
  @ApiNotFoundResponse({ description: 'No readable Story matches the slug.' })
  async findAll(
    @Param('storySlug') storySlug: string,
  ): Promise<ChapterSummaryDto[]> {
    const story = await this.resolveReadableStory(storySlug);

    return this._mapper.toSummaryList(
      await this._chapterService.findPublicByStory(story.id),
    );
  }

  /**
   * Retrieves a Chapter with the links either side of it.
   *
   * @param storySlug - The Story slug.
   * @param chapterSlug - The Chapter slug.
   * @returns The Chapter and its neighbours.
   */
  @Get(':chapterSlug')
  @ApiOperation({ summary: 'Read a Chapter' })
  @ApiOkResponse({ type: ChapterWithNavigationDto })
  @ApiNotFoundResponse({ description: 'No readable Chapter matches.' })
  async findOne(
    @Param('storySlug') storySlug: string,
    @Param('chapterSlug') chapterSlug: string,
  ): Promise<ChapterWithNavigationDto> {
    const story = await this.resolveReadableStory(storySlug);

    const chapter = await this._chapterService.findPublicBySlug(
      story.id,
      chapterSlug,
    );

    if (!chapter) {
      throw new NotFoundException('Chapter not found');
    }

    const neighbours = await this._chapterService.findNeighbours(chapter);

    return {
      chapter: this._mapper.toPublic(
        chapter,
        story,
        await this._authorService.findAuthor(story.ownerUserId),
      ),
      previous: this._mapper.toLink(neighbours.previous),
      next: this._mapper.toLink(neighbours.next),
    };
  }

  /**
   * Resolves a Story that the public may read.
   *
   * @param storySlug - The Story slug.
   * @returns The Story.
   * @throws NotFoundException when the Story is not publicly readable.
   */
  private async resolveReadableStory(storySlug: string) {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
    );

    const story = await this._storyService.findPublicBySlug(storySlug);

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    return story;
  }
}
