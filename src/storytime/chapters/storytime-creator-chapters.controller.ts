import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PERMISSION_CODES } from 'src/access-control/constants/permission-codes.constants';
import { PermissionsGuard } from 'src/access-control/permissions.guard';
import { RequiresPermission } from 'src/access-control/requires-permission.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StoryCapability } from '../collaboration/storytime-story-capability.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { ManagedChapterDto } from './dto/chapter.dto';
import { CreateChapterDto } from './dto/create-chapter.dto';
import { ReorderChaptersDto } from './dto/reorder-chapters.dto';
import { ScheduleChapterDto } from './dto/schedule-chapter.dto';
import { UpdateChapterDto } from './dto/update-chapter.dto';
import { StorytimeChapterMapper } from './storytime-chapter.mapper';
import { StorytimeChapterService } from './storytime-chapter.service';

/**
 * A creator managing the Chapters of their own Stories.
 *
 * The permission guard decides whether this kind of user may reach these
 * routes; whether they may act on a particular Chapter is settled in the
 * service, which resolves the owning Story and checks it.
 */
@ApiTags('Storytime (creator)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequiresPermission(PERMISSION_CODES.STORYTIME_STORY_EDIT_OWN)
@Controller('storytime/manage')
export class StorytimeCreatorChaptersController {
  /**
   * Creates an instance of StorytimeCreatorChaptersController.
   *
   * @param _chapterService - The Chapter service.
   * @param _storyService - Resolves the owning Story for mapping.
   * @param _mapper - Maps Chapters to their response shapes.
   * @param _featureService - Reports whether creation is switched on.
   */
  constructor(
    private readonly _chapterService: StorytimeChapterService,
    private readonly _storyService: StorytimeStoryService,
    private readonly _mapper: StorytimeChapterMapper,
    private readonly _featureService: StorytimeFeatureService,
  ) {}

  /**
   * Lists every Chapter of a Story the caller owns.
   *
   * @param storyId - The Story.
   * @param userId - The caller.
   * @returns The Chapters, in reading order.
   */
  @Get('stories/:storyId/chapters')
  @ApiOperation({ summary: 'List the Chapters of a Story you own' })
  @ApiOkResponse({ type: [ManagedChapterDto] })
  @ApiForbiddenResponse({ description: 'You do not own this Story.' })
  async findAll(
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @UserId() userId: string,
  ): Promise<ManagedChapterDto[]> {
    await this.assertEnabled();

    const story = await this._storyService.findEditableOrFail(
      storyId,
      userId,
      StoryCapability.MANAGE_CHAPTERS,
    );
    const chapters = await this._chapterService.findForOwner(storyId, userId);

    return this._mapper.toManagedList(chapters, story);
  }

  /**
   * Creates a Chapter in a Story the caller owns.
   *
   * @param storyId - The Story to add to.
   * @param dto - The Chapter to create.
   * @param userId - The caller.
   * @returns The created Chapter.
   */
  @Post('stories/:storyId/chapters')
  @ApiOperation({ summary: 'Create a Chapter' })
  @ApiOkResponse({ type: ManagedChapterDto })
  @ApiBadRequestResponse({ description: 'Invalid Chapter.' })
  @ApiForbiddenResponse({ description: 'Chapter limit reached.' })
  async create(
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @Body() dto: CreateChapterDto,
    @UserId() userId: string,
  ): Promise<ManagedChapterDto> {
    await this.assertEnabled();

    const chapter = await this._chapterService.create(storyId, dto, userId);
    const story = await this._storyService.findEditableOrFail(
      storyId,
      userId,
      StoryCapability.MANAGE_CHAPTERS,
    );

    return this._mapper.toManaged(chapter, story);
  }

  /**
   * Retrieves a Chapter for editing.
   *
   * @param chapterId - The Chapter.
   * @param userId - The caller.
   * @returns The Chapter.
   */
  @Get('chapters/:chapterId')
  @ApiOperation({ summary: 'Retrieve a Chapter you own' })
  @ApiOkResponse({ type: ManagedChapterDto })
  @ApiNotFoundResponse({ description: 'Chapter not found.' })
  async findOne(
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
    @UserId() userId: string,
  ): Promise<ManagedChapterDto> {
    await this.assertEnabled();

    const chapter = await this._chapterService.findEditableOrFail(
      chapterId,
      userId,
    );

    return this._mapper.toManaged(
      chapter,
      await this.loadStory(chapter, userId),
    );
  }

  /**
   * Updates a Chapter.
   *
   * @param chapterId - The Chapter to update.
   * @param dto - The changes to apply.
   * @param userId - The caller.
   * @returns The updated Chapter.
   */
  @Patch('chapters/:chapterId')
  @ApiOperation({ summary: 'Update a Chapter you own' })
  @ApiOkResponse({ type: ManagedChapterDto })
  @ApiConflictResponse({
    description: 'The Chapter changed since you loaded it.',
  })
  async update(
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
    @Body() dto: UpdateChapterDto,
    @UserId() userId: string,
  ): Promise<ManagedChapterDto> {
    await this.assertEnabled();

    const chapter = await this._chapterService.update(chapterId, dto, userId);

    return this._mapper.toManaged(
      chapter,
      await this.loadStory(chapter, userId),
    );
  }

  /**
   * Publishes a Chapter.
   *
   * @param chapterId - The Chapter to publish.
   * @param userId - The caller.
   * @returns The published Chapter.
   */
  @Post('chapters/:chapterId/publish')
  @ApiOperation({ summary: 'Publish a Chapter' })
  @ApiOkResponse({ type: ManagedChapterDto })
  @ApiBadRequestResponse({ description: 'The Chapter is not ready.' })
  async publish(
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
    @UserId() userId: string,
  ): Promise<ManagedChapterDto> {
    await this.assertEnabled();

    const chapter = await this._chapterService.publish(chapterId, userId);

    return this._mapper.toManaged(
      chapter,
      await this.loadStory(chapter, userId),
    );
  }

  /**
   * Withdraws a Chapter from publication.
   *
   * @param chapterId - The Chapter to unpublish.
   * @param userId - The caller.
   * @returns The unpublished Chapter.
   */
  @Post('chapters/:chapterId/unpublish')
  @ApiOperation({ summary: 'Withdraw a Chapter from publication' })
  @ApiOkResponse({ type: ManagedChapterDto })
  async unpublish(
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
    @UserId() userId: string,
  ): Promise<ManagedChapterDto> {
    await this.assertEnabled();

    const chapter = await this._chapterService.unpublish(chapterId, userId);

    return this._mapper.toManaged(
      chapter,
      await this.loadStory(chapter, userId),
    );
  }

  /**
   * Schedules a Chapter to publish automatically.
   *
   * @param chapterId - The Chapter to schedule.
   * @param dto - When it should publish.
   * @param userId - The caller.
   * @returns The scheduled Chapter.
   */
  @Post('chapters/:chapterId/schedule')
  @ApiOperation({ summary: 'Schedule a Chapter to publish' })
  @ApiOkResponse({ type: ManagedChapterDto })
  @ApiBadRequestResponse({ description: 'The time must be in the future.' })
  async schedule(
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
    @Body() dto: ScheduleChapterDto,
    @UserId() userId: string,
  ): Promise<ManagedChapterDto> {
    await this.assertEnabled();

    const chapter = await this._chapterService.schedule(
      chapterId,
      dto.publishAt,
      userId,
    );

    return this._mapper.toManaged(
      chapter,
      await this.loadStory(chapter, userId),
    );
  }

  /**
   * Reorders the Chapters of a Story.
   *
   * @param storyId - The Story.
   * @param dto - Every Chapter, in the order they should appear.
   * @param userId - The caller.
   * @returns The reordered Chapters.
   */
  @Post('stories/:storyId/chapters/reorder')
  @ApiOperation({ summary: 'Reorder the Chapters of a Story' })
  @ApiOkResponse({ type: [ManagedChapterDto] })
  @ApiBadRequestResponse({
    description: 'The order must list every Chapter exactly once.',
  })
  async reorder(
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @Body() dto: ReorderChaptersDto,
    @UserId() userId: string,
  ): Promise<ManagedChapterDto[]> {
    await this.assertEnabled();

    const story = await this._storyService.findEditableOrFail(
      storyId,
      userId,
      StoryCapability.MANAGE_CHAPTERS,
    );
    const chapters = await this._chapterService.reorder(
      storyId,
      dto.chapterIds,
      userId,
    );

    return this._mapper.toManagedList(chapters, story);
  }

  /**
   * Deletes a Chapter.
   *
   * @param chapterId - The Chapter to delete.
   * @param userId - The caller.
   */
  @Delete('chapters/:chapterId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a Chapter you own' })
  @ApiNoContentResponse({ description: 'Chapter deleted.' })
  async remove(
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
    @UserId() userId: string,
  ): Promise<void> {
    await this.assertEnabled();

    await this._chapterService.remove(chapterId, userId);
  }

  /**
   * Loads the Story a Chapter belongs to.
   *
   * Needed for the language a Chapter inherits, so it is fetched rather than
   * the language being guessed at.
   *
   * @param chapter - The Chapter.
   * @param userId - The caller.
   * @returns The owning Story.
   */
  private loadStory(
    chapter: { storyId: string },
    userId: string,
  ): Promise<StorytimeStoryEntity> {
    return this._storyService.findEditableOrFail(
      chapter.storyId,
      userId,
      StoryCapability.MANAGE_CHAPTERS,
    );
  }

  /**
   * Requires that Storytime creation is switched on.
   */
  private async assertEnabled(): Promise<void> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.CREATION_ENABLED,
    );
  }
}
