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
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PERMISSION_CODES } from 'src/access-control/constants/permission-codes.constants';
import { PermissionsGuard } from 'src/access-control/permissions.guard';
import { RequiresPermission } from 'src/access-control/requires-permission.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { AddChapterMediaDto } from './dto/add-chapter-media.dto';
import { ChapterMediaDto } from './dto/chapter-media.dto';
import {
  ReorderChapterMediaDto,
  UpdateChapterMediaDto,
} from './dto/update-chapter-media.dto';
import { StorytimeMediaMapper } from './storytime-media.mapper';
import { StorytimeMediaService } from './storytime-media.service';

/**
 * A creator managing the videos on their own Chapters.
 *
 * Whether the caller may act on a particular Chapter is settled in the
 * service, which resolves the owning Story and checks it — a collaborator
 * granted Chapters may add videos, and nobody else may.
 */
@ApiTags('Storytime (creator)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequiresPermission(PERMISSION_CODES.STORYTIME_STORY_EDIT_OWN)
@Controller('storytime/manage')
export class StorytimeMediaController {
  /**
   * Creates an instance of StorytimeMediaController.
   *
   * @param _mediaService - The media service.
   * @param _mapper - Maps media to its response shape.
   */
  constructor(
    private readonly _mediaService: StorytimeMediaService,
    private readonly _mapper: StorytimeMediaMapper,
  ) {}

  /**
   * Adds a video to a Chapter.
   *
   * @param chapterId - The Chapter.
   * @param dto - The share URL and how to present it.
   * @param userId - The caller.
   * @returns The saved video.
   */
  @Post('chapters/:chapterId/media')
  @ApiOperation({ summary: 'Add a video to one of your Chapters' })
  @ApiOkResponse({ type: ChapterMediaDto })
  @ApiBadRequestResponse({ description: 'Not an acceptable YouTube link.' })
  @ApiForbiddenResponse({ description: 'Not your Story, or embedding is off.' })
  async add(
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
    @Body() dto: AddChapterMediaDto,
    @UserId() userId: string,
  ): Promise<ChapterMediaDto> {
    return this._mapper.toDto(
      await this._mediaService.add(chapterId, dto, userId),
    );
  }

  /**
   * Lists the videos on a Chapter the caller may edit.
   *
   * @param chapterId - The Chapter.
   * @returns The videos, in order.
   */
  @Get('chapters/:chapterId/media')
  @ApiOperation({ summary: 'List the videos on one of your Chapters' })
  @ApiOkResponse({ type: [ChapterMediaDto] })
  async findByChapter(
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
  ): Promise<ChapterMediaDto[]> {
    return this._mapper.toDtoList(
      await this._mediaService.findByChapter(chapterId),
    );
  }

  /**
   * Changes how a video is presented.
   *
   * @param mediaId - The video.
   * @param dto - The changes.
   * @param userId - The caller.
   * @returns The updated video.
   */
  @Patch('media/:mediaId')
  @ApiOperation({ summary: 'Change a video’s title, caption or clip' })
  @ApiOkResponse({ type: ChapterMediaDto })
  @ApiBadRequestResponse({ description: 'The clip makes no sense.' })
  async update(
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Body() dto: UpdateChapterMediaDto,
    @UserId() userId: string,
  ): Promise<ChapterMediaDto> {
    return this._mapper.toDto(
      await this._mediaService.update(mediaId, dto, userId),
    );
  }

  /**
   * Reorders the videos on a Chapter.
   *
   * @param chapterId - The Chapter.
   * @param dto - Every video, in order.
   * @param userId - The caller.
   * @returns The videos in their new order.
   */
  @Post('chapters/:chapterId/media/reorder')
  @ApiOperation({ summary: 'Reorder the videos on one of your Chapters' })
  @ApiOkResponse({ type: [ChapterMediaDto] })
  @ApiBadRequestResponse({
    description: 'The order did not list every video exactly once.',
  })
  async reorder(
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
    @Body() dto: ReorderChapterMediaDto,
    @UserId() userId: string,
  ): Promise<ChapterMediaDto[]> {
    return this._mapper.toDtoList(
      await this._mediaService.reorder(chapterId, dto.mediaIds, userId),
    );
  }

  /**
   * Removes a video from a Chapter.
   *
   * @param mediaId - The video.
   * @param userId - The caller.
   */
  @Delete('media/:mediaId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a video from one of your Chapters' })
  @ApiNoContentResponse({ description: 'The video was removed.' })
  async remove(
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @UserId() userId: string,
  ): Promise<void> {
    await this._mediaService.remove(mediaId, userId);
  }
}
