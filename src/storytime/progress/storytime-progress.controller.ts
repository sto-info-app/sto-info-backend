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
import { StorytimeFeatureService } from '../storytime-feature.service';
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
   * @param _featureService - Reports whether reading is switched on.
   */
  constructor(
    private readonly _progressService: StorytimeProgressService,
    private readonly _mapper: StorytimeProgressMapper,
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
  @ApiOkResponse({ type: [StoryProgressDto] })
  async findLibrary(
    @UserId() userId: string,
    @Query('status') status?: ReaderStoryStatus,
  ): Promise<StoryProgressDto[]> {
    await this.assertEnabled();

    const rows = await this._progressService.findLibrary(userId, status);
    const summaries = await Promise.all(
      rows.map(row =>
        this._progressService.getStoryProgress(userId, row.storyId),
      ),
    );

    return this._mapper.toDtoList(summaries);
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
