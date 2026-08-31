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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
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
import { StorytimeArcService } from '../arcs/storytime-arc.service';
import { ArcCapability } from '../collaboration/storytime-arc-capability.enum';
import { StoryCapability } from '../collaboration/storytime-story-capability.enum';
import { StorytimeTagCategory } from '../enums/storytime-tag-category.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import {
  CreateTagDto,
  SetTagsDto,
  TagDto,
  UpdateTagDto,
} from './dto/create-tag.dto';
import { StorytimeTagMapper } from './storytime-tag.mapper';
import { StorytimeTagService } from './storytime-tag.service';
import { StorytimeTaggingService } from './storytime-tagging.service';

/**
 * The tag vocabulary, and putting tags on content.
 *
 * Reading the vocabulary needs no account: tags are filter links, and a reader
 * following one has to be able to see what it means.
 *
 * Changing the vocabulary needs the configure permission, because a tag is a
 * shared classification rather than one creator's label. Putting tags on a
 * Story or an Arc needs whatever that Story or Arc needs to edit — tagging is
 * editing it.
 */
@ApiTags('Storytime')
@Controller('storytime')
export class StorytimeTagsController {
  /**
   * Creates an instance of StorytimeTagsController.
   *
   * @param _tagService - The vocabulary.
   * @param _taggingService - Tags attached to content.
   * @param _storyService - Decides who may edit a Story.
   * @param _arcService - Decides who may edit an Arc.
   * @param _mapper - Maps tags to their response shape.
   */
  constructor(
    private readonly _tagService: StorytimeTagService,
    private readonly _taggingService: StorytimeTaggingService,
    private readonly _storyService: StorytimeStoryService,
    private readonly _arcService: StorytimeArcService,
    private readonly _mapper: StorytimeTagMapper,
  ) {}

  /**
   * Lists the tag vocabulary.
   *
   * @param category - The category to limit to, if any.
   * @returns The tags.
   */
  @Get('tags')
  @ApiOperation({ summary: 'List the Storytime tag vocabulary' })
  @ApiOkResponse({ type: [TagDto] })
  async findAll(
    @Query('category') category?: StorytimeTagCategory,
  ): Promise<TagDto[]> {
    return this._mapper.toList(await this._tagService.findAll(category));
  }

  /**
   * Reads the tags on one Story.
   *
   * @param storyId - The Story.
   * @returns Its tags.
   */
  @Get('stories/:storyId/tags')
  @ApiOperation({ summary: 'Read the tags on a Story' })
  @ApiOkResponse({ type: [TagDto] })
  async findStoryTags(
    @Param('storyId', ParseUUIDPipe) storyId: string,
  ): Promise<TagDto[]> {
    return this._mapper.toList(
      await this._taggingService.findFor(StorytimeTargetType.STORY, storyId),
    );
  }

  /**
   * Sets the tags on a Story.
   *
   * @param storyId - The Story.
   * @param dto - The tags it should carry.
   * @param userId - The caller.
   * @returns The tags it now carries.
   */
  @Put('manage/stories/:storyId/tags')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(PERMISSION_CODES.STORYTIME_STORY_EDIT_OWN)
  @ApiOperation({ summary: 'Set the tags on a Story you may edit' })
  @ApiOkResponse({ type: [TagDto] })
  @ApiBadRequestResponse({ description: 'One of those tags does not exist.' })
  @ApiForbiddenResponse({ description: 'You may not edit this Story.' })
  async setStoryTags(
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @Body() dto: SetTagsDto,
    @UserId() userId: string,
  ): Promise<TagDto[]> {
    await this._storyService.findEditableOrFail(
      storyId,
      userId,
      StoryCapability.EDIT_STORY,
    );

    return this._mapper.toList(
      await this._taggingService.setTags(
        StorytimeTargetType.STORY,
        storyId,
        dto.tagIds,
      ),
    );
  }

  /**
   * Reads the tags on one Arc.
   *
   * @param arcId - The Arc.
   * @returns Its tags.
   */
  @Get('arcs/:arcId/tags')
  @ApiOperation({ summary: 'Read the tags on an Arc' })
  @ApiOkResponse({ type: [TagDto] })
  async findArcTags(
    @Param('arcId', ParseUUIDPipe) arcId: string,
  ): Promise<TagDto[]> {
    return this._mapper.toList(
      await this._taggingService.findFor(StorytimeTargetType.ARC, arcId),
    );
  }

  /**
   * Sets the tags on an Arc.
   *
   * @param arcId - The Arc.
   * @param dto - The tags it should carry.
   * @param userId - The caller.
   * @returns The tags it now carries.
   */
  @Put('manage/arcs/:arcId/tags')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Set the tags on an Arc you may edit' })
  @ApiOkResponse({ type: [TagDto] })
  @ApiForbiddenResponse({ description: 'You may not edit this Arc.' })
  async setArcTags(
    @Param('arcId', ParseUUIDPipe) arcId: string,
    @Body() dto: SetTagsDto,
    @UserId() userId: string,
  ): Promise<TagDto[]> {
    await this._arcService.findEditableOrFail(
      arcId,
      userId,
      ArcCapability.EDIT_ARC,
    );

    return this._mapper.toList(
      await this._taggingService.setTags(
        StorytimeTargetType.ARC,
        arcId,
        dto.tagIds,
      ),
    );
  }

  /**
   * Adds a tag to the vocabulary.
   *
   * @param dto - The tag to add.
   * @param userId - The administrator.
   * @returns The tag.
   */
  @Post('admin/tags')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(PERMISSION_CODES.STORYTIME_TAG_MANAGE)
  @ApiOperation({ summary: 'Add a tag to the vocabulary' })
  @ApiOkResponse({ type: TagDto })
  @ApiBadRequestResponse({ description: 'That tag already exists.' })
  async create(
    @Body() dto: CreateTagDto,
    @UserId() userId: string,
  ): Promise<TagDto> {
    return this._mapper.toTag(await this._tagService.create(dto, userId));
  }

  /**
   * Changes a tag.
   *
   * @param tagId - The tag.
   * @param dto - The changes.
   * @param userId - The administrator.
   * @returns The tag after the change.
   */
  @Patch('admin/tags/:tagId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(PERMISSION_CODES.STORYTIME_TAG_MANAGE)
  @ApiOperation({ summary: 'Change a tag' })
  @ApiOkResponse({ type: TagDto })
  @ApiNotFoundResponse({ description: 'No tag has that identifier.' })
  async update(
    @Param('tagId', ParseUUIDPipe) tagId: string,
    @Body() dto: UpdateTagDto,
    @UserId() userId: string,
  ): Promise<TagDto> {
    return this._mapper.toTag(
      await this._tagService.update(tagId, dto, userId),
    );
  }

  /**
   * Removes a tag from the vocabulary.
   *
   * @param tagId - The tag.
   * @param userId - The administrator.
   */
  @Delete('admin/tags/:tagId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(PERMISSION_CODES.STORYTIME_TAG_MANAGE)
  @ApiOperation({ summary: 'Remove a tag from the vocabulary' })
  @ApiNoContentResponse({ description: 'The tag was removed.' })
  @ApiNotFoundResponse({ description: 'No tag has that identifier.' })
  async remove(
    @Param('tagId', ParseUUIDPipe) tagId: string,
    @UserId() userId: string,
  ): Promise<void> {
    await this._tagService.remove(tagId, userId);
  }
}
