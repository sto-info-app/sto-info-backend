import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';

import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { ReaderStoryStatus } from '../enums/reader-story-status.enum';
import { StorytimeStoryMapper } from '../stories/storytime-story.mapper';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { ChapterProgressDto } from './dto/chapter-progress.dto';
import { LibraryEntryDto } from './dto/library-entry.dto';
import { SetChapterReadDto } from './dto/set-chapter-read.dto';
import { StoryProgressDto } from './dto/story-progress.dto';
import { UpdateChapterProgressDto } from './dto/update-chapter-progress.dto';
import { UpdateStoryProgressDto } from './dto/update-story-progress.dto';
import { StorytimeProgressMapper } from './storytime-progress.mapper';
import { StorytimeProgressService } from './storytime-progress.service';

/**
 * A reader's own progress.
 *
 * Every route acts on the caller's progress and takes the reader from the
 * token, never from the request. Progress is personal, so there is no way to
 * name somebody else's.
 */
@ApiTags('Storytime (reader)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('storytime/progress')
export class StorytimeProgressController {
  /**
   * Creates an instance of StorytimeProgressController.
   *
   * @param _progressService - The progress service.
   * @param _mapper - Maps progress to its response shape.
   * @param _storyService - Finds the Stories a library entry refers to.
   * @param _storyMapper - Maps those Stories to their reader-facing shape.
   * @param _featureService - Reports whether reading is switched on.
   */
  constructor(
    private readonly _progressService: StorytimeProgressService,
    private readonly _mapper: StorytimeProgressMapper,
    private readonly _storyService: StorytimeStoryService,
    private readonly _storyMapper: StorytimeStoryMapper,
    private readonly _featureService: StorytimeFeatureService,
  ) {}

  /**
   * Lists the Stories the caller has progress on.
   *
   * @param userId - The reader.
   * @param status - An optional status to filter by.
   * @returns The reader's library.
   */
  @Get()
  @ApiOperation({ summary: 'List the Stories you have progress on' })
  @ApiQuery({ name: 'status', enum: ReaderStoryStatus, required: false })
  @ApiOkResponse({ type: [LibraryEntryDto] })
  async findLibrary(
    @UserId() userId: string,
    @Query('status') status?: ReaderStoryStatus,
  ): Promise<LibraryEntryDto[]> {
    await this.assertEnabled();

    const rows = await this._progressService.findLibrary(userId, status);
    const summaries = await Promise.all(
      rows.map(row =>
        this._progressService.getStoryProgress(userId, row.storyId),
      ),
    );

    // The Stories travel with the progress: rows hold identifiers, and a
    // library of identifiers would be useless. Fetched in one go rather than
    // one request per row.
    const stories = await this._storyService.findPublicByIds(
      summaries.map(summary => summary.progress.storyId),
    );

    return this._mapper.toLibraryDtoList(
      summaries,
      new Map(
        stories.map(story => [story.id, this._storyMapper.toPublic(story)]),
      ),
    );
  }

  /**
   * Reports the caller's progress through one Story.
   *
   * @param storyId - The Story.
   * @param userId - The reader.
   * @returns The progress.
   */
  @Get('stories/:storyId')
  @ApiOperation({ summary: 'Report your progress through a Story' })
  @ApiOkResponse({ type: StoryProgressDto })
  async findOne(
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @UserId() userId: string,
  ): Promise<StoryProgressDto> {
    await this.assertEnabled();

    return this._mapper.toDto(
      await this._progressService.getStoryProgress(userId, storyId),
    );
  }

  /**
   * Reports the caller's progress through one Chapter.
   *
   * @param chapterId - The Chapter.
   * @param userId - The reader.
   * @returns The progress, empty when they have never opened it.
   */
  @Get('chapters/:chapterId')
  @ApiOperation({ summary: 'Report your progress through a Chapter' })
  @ApiOkResponse({ type: ChapterProgressDto })
  async findChapterProgress(
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
    @UserId() userId: string,
  ): Promise<ChapterProgressDto> {
    await this.assertEnabled();

    return this._mapper.toChapterDto(
      chapterId,
      await this._progressService.findChapterProgress(userId, chapterId),
    );
  }

  /**
   * Sets the caller's own status for a Story.
   *
   * @param storyId - The Story.
   * @param dto - The chosen status.
   * @param userId - The reader.
   * @returns The progress after the change.
   */
  @Patch('stories/:storyId')
  @ApiOperation({ summary: 'Set your own status for a Story' })
  @ApiOkResponse({ type: StoryProgressDto })
  async setStoryStatus(
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @Body() dto: UpdateStoryProgressDto,
    @UserId() userId: string,
  ): Promise<StoryProgressDto> {
    await this.assertEnabled();

    return this._mapper.toDto(
      await this._progressService.setStoryStatus(userId, storyId, dto),
    );
  }

  /**
   * Records how far the caller has got through a Chapter.
   *
   * @param chapterId - The Chapter.
   * @param dto - The reported position.
   * @param userId - The reader.
   * @returns The Story's progress after the update.
   */
  @Patch('chapters/:chapterId')
  @ApiOperation({ summary: 'Record how far you have read' })
  @ApiOkResponse({ type: StoryProgressDto })
  @ApiNotFoundResponse({ description: 'Chapter not found.' })
  async updateChapterProgress(
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
    @Body() dto: UpdateChapterProgressDto,
    @UserId() userId: string,
  ): Promise<StoryProgressDto> {
    await this.assertEnabled();

    return this._mapper.toDto(
      await this._progressService.updateChapterProgress(userId, chapterId, dto),
    );
  }

  /**
   * Marks a Chapter read or unread.
   *
   * @param chapterId - The Chapter.
   * @param dto - Whether it is now read.
   * @param userId - The reader.
   * @returns The Story's progress after the change.
   */
  @Post('chapters/:chapterId/read')
  @ApiOperation({ summary: 'Mark a Chapter read or unread' })
  @ApiOkResponse({ type: StoryProgressDto })
  @ApiNotFoundResponse({ description: 'Chapter not found.' })
  async setChapterRead(
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
    @Body() dto: SetChapterReadDto,
    @UserId() userId: string,
  ): Promise<StoryProgressDto> {
    await this.assertEnabled();

    return this._mapper.toDto(
      await this._progressService.setChapterRead(userId, chapterId, dto.isRead),
    );
  }

  /**
   * Marks every readable Chapter of a Story as read.
   *
   * @param storyId - The Story.
   * @param userId - The reader.
   * @returns The progress after the change.
   */
  @Post('stories/:storyId/complete')
  @ApiOperation({ summary: 'Mark a whole Story as read' })
  @ApiOkResponse({ type: StoryProgressDto })
  async completeStory(
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @UserId() userId: string,
  ): Promise<StoryProgressDto> {
    await this.assertEnabled();

    return this._mapper.toDto(
      await this._progressService.completeStory(userId, storyId),
    );
  }

  /**
   * Discards the caller's progress through a Story.
   *
   * @param storyId - The Story.
   * @param userId - The reader.
   * @returns The progress after the reset.
   */
  @Post('stories/:storyId/reset')
  @ApiOperation({ summary: 'Start a Story again' })
  @ApiOkResponse({ type: StoryProgressDto })
  async resetStory(
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @UserId() userId: string,
  ): Promise<StoryProgressDto> {
    await this.assertEnabled();

    return this._mapper.toDto(
      await this._progressService.resetStory(userId, storyId),
    );
  }

  /**
   * Requires that Storytime reading is switched on.
   */
  private async assertEnabled(): Promise<void> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
    );
  }
}
