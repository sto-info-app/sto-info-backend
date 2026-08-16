import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { StorytimeChapterService } from '../chapters/storytime-chapter.service';
import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { ChapterMediaDto } from './dto/chapter-media.dto';
import { StorytimeMediaMapper } from './storytime-media.mapper';
import { StorytimeMediaService } from './storytime-media.service';

/**
 * The videos on a published Chapter.
 *
 * Fetched separately from the Chapter itself, which keeps Chapters unaware of
 * media entirely and means a Chapter still renders when embedding is switched
 * off — the videos simply are not there.
 */
@ApiTags('Storytime')
@Controller('storytime/stories/:storySlug/chapters/:chapterSlug/media')
export class PublicStorytimeMediaController {
  /**
   * Creates an instance of PublicStorytimeMediaController.
   *
   * @param _mediaService - The media service.
   * @param _chapterService - Resolves the readable Chapter.
   * @param _storyService - Resolves and gates the owning Story.
   * @param _mapper - Maps media to its response shape.
   * @param _featureService - Reports whether reading and embedding are on.
   */
  constructor(
    private readonly _mediaService: StorytimeMediaService,
    private readonly _chapterService: StorytimeChapterService,
    private readonly _storyService: StorytimeStoryService,
    private readonly _mapper: StorytimeMediaMapper,
    private readonly _featureService: StorytimeFeatureService,
  ) {}

  /**
   * Lists the videos on a published Chapter.
   *
   * Returns nothing at all when embedding is switched off, rather than
   * refusing: a Chapter with its videos hidden is still a Chapter worth
   * reading, and a reader should not meet an error over one.
   *
   * @param storySlug - The Story slug.
   * @param chapterSlug - The Chapter slug.
   * @returns The videos, in order.
   */
  @Get()
  @ApiOperation({ summary: 'List the videos on a published Chapter' })
  @ApiOkResponse({ type: [ChapterMediaDto] })
  @ApiNotFoundResponse({ description: 'No readable Chapter matches.' })
  async findAll(
    @Param('storySlug') storySlug: string,
    @Param('chapterSlug') chapterSlug: string,
  ): Promise<ChapterMediaDto[]> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
    );

    const story = await this._storyService.findPublicBySlug(storySlug);

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    const chapter = await this._chapterService.findPublicBySlug(
      story.id,
      chapterSlug,
    );

    if (!chapter) {
      throw new NotFoundException('Chapter not found');
    }

    const embeddingEnabled = await this._featureService.isFlagEnabled(
      STORYTIME_FEATURE_FLAGS.YOUTUBE_ENABLED,
    );

    if (!embeddingEnabled) {
      return [];
    }

    return this._mapper.toDtoList(
      await this._mediaService.findByChapter(chapter.id),
    );
  }
}
