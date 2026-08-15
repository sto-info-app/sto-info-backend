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
import { StorytimeFeatureService } from '../storytime-feature.service';
import { CreateStoryDto } from './dto/create-story.dto';
import { ReorderStoriesDto } from './dto/reorder-stories.dto';
import { ManagedStoryDto } from './dto/story.dto';
import { UpdateStoryDto } from './dto/update-story.dto';
import { StorytimeStoryMapper } from './storytime-story.mapper';
import { StorytimeStoryService } from './storytime-story.service';

/**
 * A creator managing their own Stories.
 *
 * The permission guard answers whether this kind of user may reach these routes
 * at all. Whether they may act on a *particular* Story is decided in the
 * service, which re-reads it and checks ownership — that cannot be known before
 * the Story has been loaded.
 */
@ApiTags('Storytime (creator)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('storytime/manage/stories')
export class StorytimeCreatorStoriesController {
  /**
   * Creates an instance of StorytimeCreatorStoriesController.
   *
   * @param _storyService - The Story service.
   * @param _mapper - Maps Stories to their response shapes.
   * @param _featureService - Reports whether creation is switched on.
   */
  constructor(
    private readonly _storyService: StorytimeStoryService,
    private readonly _mapper: StorytimeStoryMapper,
    private readonly _featureService: StorytimeFeatureService,
  ) {}

  /**
   * Lists the Stories the caller owns.
   *
   * @param userId - The caller.
   * @returns The caller's Stories, in their chosen order.
   */
  @Get()
  @RequiresPermission(PERMISSION_CODES.STORYTIME_STORY_EDIT_OWN)
  @ApiOperation({ summary: 'List the Stories you own' })
  @ApiOkResponse({ type: [ManagedStoryDto] })
  async findMine(@UserId() userId: string): Promise<ManagedStoryDto[]> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.CREATION_ENABLED,
    );

    return this._mapper.toManagedList(
      await this._storyService.findOwnedByUser(userId),
    );
  }

  /**
   * Retrieves one of the caller's Stories for editing.
   *
   * @param storyId - The Story to retrieve.
   * @param userId - The caller.
   * @returns The Story.
   */
  @Get(':storyId')
  @RequiresPermission(PERMISSION_CODES.STORYTIME_STORY_EDIT_OWN)
  @ApiOperation({ summary: 'Retrieve a Story you own' })
  @ApiOkResponse({ type: ManagedStoryDto })
  @ApiNotFoundResponse({ description: 'Story not found.' })
  @ApiForbiddenResponse({ description: 'You do not own this Story.' })
  async findOne(
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @UserId() userId: string,
  ): Promise<ManagedStoryDto> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.CREATION_ENABLED,
    );

    return this._mapper.toManaged(
      await this._storyService.findOwnedOrFail(storyId, userId),
    );
  }

  /**
   * Creates a Story.
   *
   * @param dto - The Story to create.
   * @param userId - The caller, who becomes the owner.
   * @returns The created Story.
   */
  @Post()
  @RequiresPermission(PERMISSION_CODES.STORYTIME_STORY_CREATE)
  @ApiOperation({ summary: 'Create a Story' })
  @ApiOkResponse({ type: ManagedStoryDto })
  @ApiBadRequestResponse({ description: 'Invalid Story.' })
  @ApiForbiddenResponse({ description: 'Story limit reached.' })
  async create(
    @Body() dto: CreateStoryDto,
    @UserId() userId: string,
  ): Promise<ManagedStoryDto> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.CREATION_ENABLED,
    );

    return this._mapper.toManaged(await this._storyService.create(dto, userId));
  }

  /**
   * Updates a Story the caller owns.
   *
   * @param storyId - The Story to update.
   * @param dto - The changes to apply.
   * @param userId - The caller.
   * @returns The updated Story.
   */
  @Patch(':storyId')
  @RequiresPermission(PERMISSION_CODES.STORYTIME_STORY_EDIT_OWN)
  @ApiOperation({ summary: 'Update a Story you own' })
  @ApiOkResponse({ type: ManagedStoryDto })
  @ApiConflictResponse({
    description: 'The Story changed since you loaded it.',
  })
  @ApiForbiddenResponse({ description: 'You do not own this Story.' })
  async update(
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @Body() dto: UpdateStoryDto,
    @UserId() userId: string,
  ): Promise<ManagedStoryDto> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.CREATION_ENABLED,
    );

    return this._mapper.toManaged(
      await this._storyService.update(storyId, dto, userId),
    );
  }

  /**
   * Publishes a Story the caller owns.
   *
   * @param storyId - The Story to publish.
   * @param userId - The caller.
   * @returns The published Story.
   */
  @Post(':storyId/publish')
  @RequiresPermission(PERMISSION_CODES.STORYTIME_STORY_PUBLISH_OWN)
  @ApiOperation({ summary: 'Publish a Story you own' })
  @ApiOkResponse({ type: ManagedStoryDto })
  @ApiBadRequestResponse({ description: 'The Story is not ready to publish.' })
  async publish(
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @UserId() userId: string,
  ): Promise<ManagedStoryDto> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.CREATION_ENABLED,
    );

    return this._mapper.toManaged(
      await this._storyService.publish(storyId, userId),
    );
  }

  /**
   * Withdraws a Story from publication.
   *
   * @param storyId - The Story to unpublish.
   * @param userId - The caller.
   * @returns The unpublished Story.
   */
  @Post(':storyId/unpublish')
  @RequiresPermission(PERMISSION_CODES.STORYTIME_STORY_PUBLISH_OWN)
  @ApiOperation({ summary: 'Withdraw a Story from publication' })
  @ApiOkResponse({ type: ManagedStoryDto })
  async unpublish(
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @UserId() userId: string,
  ): Promise<ManagedStoryDto> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.CREATION_ENABLED,
    );

    return this._mapper.toManaged(
      await this._storyService.unpublish(storyId, userId),
    );
  }

  /**
   * Archives a Story, retiring it without deleting it.
   *
   * @param storyId - The Story to archive.
   * @param userId - The caller.
   * @returns The archived Story.
   */
  @Post(':storyId/archive')
  @RequiresPermission(PERMISSION_CODES.STORYTIME_STORY_EDIT_OWN)
  @ApiOperation({ summary: 'Archive a Story you own' })
  @ApiOkResponse({ type: ManagedStoryDto })
  async archive(
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @UserId() userId: string,
  ): Promise<ManagedStoryDto> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.CREATION_ENABLED,
    );

    return this._mapper.toManaged(
      await this._storyService.archive(storyId, userId),
    );
  }

  /**
   * Reorders the caller's Stories.
   *
   * @param dto - Every Story the caller owns, in the order they want.
   * @param userId - The caller.
   * @returns The reordered Stories.
   */
  @Post('reorder')
  @RequiresPermission(PERMISSION_CODES.STORYTIME_STORY_EDIT_OWN)
  @ApiOperation({ summary: 'Reorder the Stories you own' })
  @ApiOkResponse({ type: [ManagedStoryDto] })
  @ApiBadRequestResponse({
    description: 'The order must list every Story you own exactly once.',
  })
  async reorder(
    @Body() dto: ReorderStoriesDto,
    @UserId() userId: string,
  ): Promise<ManagedStoryDto[]> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.CREATION_ENABLED,
    );

    return this._mapper.toManagedList(
      await this._storyService.reorder(dto.storyIds, userId),
    );
  }

  /**
   * Deletes a Story the caller owns.
   *
   * @param storyId - The Story to delete.
   * @param userId - The caller.
   */
  @Delete(':storyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresPermission(PERMISSION_CODES.STORYTIME_STORY_EDIT_OWN)
  @ApiOperation({ summary: 'Delete a Story you own' })
  @ApiNoContentResponse({ description: 'Story deleted.' })
  async remove(
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.CREATION_ENABLED,
    );

    await this._storyService.remove(storyId, userId);
  }
}
