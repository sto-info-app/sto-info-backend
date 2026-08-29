import {
  Body,
  Controller,
  Delete,
  Get,
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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PERMISSION_CODES } from 'src/access-control/constants/permission-codes.constants';
import { PermissionsGuard } from 'src/access-control/permissions.guard';
import { RequiresPermission } from 'src/access-control/requires-permission.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from 'src/auth/optional-jwt-auth.guard';
import { OptionalUserId, UserId } from 'src/auth/user-id.decorator';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { ParseStorytimeTargetTypePipe } from '../shared/parse-storytime-target-type.pipe';
import {
  CommentDto,
  CreateCommentDto,
  RemoveCommentDto,
  UpdateCommentDto,
} from './dto/comment.dto';
import { StorytimeCommentMapper } from './storytime-comment.mapper';
import { StorytimeCommentService } from './storytime-comment.service';
import { StorytimeAuthorService } from '../shared/storytime-author.service';
import { StorytimeCommentEntity } from './entities/storytime-comment.entity';

/**
 * Discussion on Stories, Chapters and Arcs.
 *
 * Reading a conversation needs no account. Joining one does, and everything
 * that silences a comment is checked against who is asking: an author may take
 * their own back, an owner may hide one from their own page, and only an
 * administrator may remove one under the content policy.
 */
@ApiTags('Storytime')
@Controller('storytime/comments')
export class StorytimeCommentsController {
  /**
   * Creates an instance of StorytimeCommentsController.
   *
   * @param _commentService - The comment service.
   * @param _mapper - Maps comments to what a given reader may see.
   */
  constructor(
    private readonly _commentService: StorytimeCommentService,
    private readonly _mapper: StorytimeCommentMapper,
    private readonly _authorService: StorytimeAuthorService,
  ) {}

  /**
   * Reads the conversation on one piece of content.
   *
   * @param targetType - What kind of thing.
   * @param targetId - The thing.
   * @param userId - The reader, or null when nobody is signed in.
   * @returns The comments, oldest first.
   */
  @Get(':targetType/:targetId')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Read the comments on a piece of content' })
  @ApiOkResponse({ type: [CommentDto] })
  async findFor(
    @Param('targetType', ParseStorytimeTargetTypePipe)
    targetType: StorytimeTargetType,
    @Param('targetId', ParseUUIDPipe) targetId: string,
    @OptionalUserId() userId: string | null,
  ): Promise<CommentDto[]> {
    const comments = await this._commentService.findFor(targetType, targetId);

    return this._mapper.toList(
      comments,
      userId,
      await this._authorService.findAuthors(
        comments.map(comment => comment.authorUserId),
      ),
    );
  }

  /**
   * Posts a comment, or a reply to one.
   *
   * @param dto - What is being commented on, and what was said.
   * @param userId - The commenter.
   * @returns The comment.
   */
  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(PERMISSION_CODES.STORYTIME_COMMENT_CREATE)
  @ApiOperation({ summary: 'Comment on a Story, Chapter or Arc' })
  @ApiOkResponse({ type: CommentDto })
  @ApiBadRequestResponse({ description: 'That cannot be commented on.' })
  async create(
    @Body() dto: CreateCommentDto,
    @UserId() userId: string,
  ): Promise<CommentDto> {
    return this.present(await this._commentService.create(dto, userId), userId);
  }

  /**
   * Changes what one of the caller's comments says.
   *
   * @param commentId - The comment.
   * @param dto - What it should say.
   * @param userId - The author.
   * @returns The comment after the edit.
   */
  @Patch(':commentId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Edit your own comment' })
  @ApiOkResponse({ type: CommentDto })
  @ApiForbiddenResponse({ description: 'The comment is not the caller’s.' })
  @ApiBadRequestResponse({ description: 'It can no longer be edited.' })
  async update(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: UpdateCommentDto,
    @UserId() userId: string,
  ): Promise<CommentDto> {
    return this.present(
      await this._commentService.update(commentId, dto.body, userId),
      userId,
    );
  }

  /**
   * Takes one of the caller's comments back.
   *
   * @param commentId - The comment.
   * @param userId - The author.
   * @returns The comment, now taken back.
   */
  @Delete(':commentId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Delete your own comment' })
  @ApiOkResponse({ type: CommentDto })
  @ApiForbiddenResponse({ description: 'The comment is not the caller’s.' })
  async remove(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @UserId() userId: string,
  ): Promise<CommentDto> {
    return this.present(
      await this._commentService.deleteOwn(commentId, userId),
      userId,
    );
  }

  /**
   * Hides a comment from the caller's own page.
   *
   * @param commentId - The comment.
   * @param userId - The owner of the content.
   * @returns The comment, now hidden.
   */
  @Post(':commentId/hide')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Hide a comment on your own content' })
  @ApiOkResponse({ type: CommentDto })
  @ApiForbiddenResponse({ description: 'The content is not the caller’s.' })
  async hide(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @UserId() userId: string,
  ): Promise<CommentDto> {
    return this.present(
      await this._commentService.hide(commentId, userId),
      userId,
    );
  }

  /**
   * Puts back a comment the caller hid.
   *
   * @param commentId - The comment.
   * @param userId - The owner of the content.
   * @returns The comment, shown again.
   */
  @Post(':commentId/unhide')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Unhide a comment you hid' })
  @ApiOkResponse({ type: CommentDto })
  @ApiBadRequestResponse({ description: 'It was not hidden by the caller.' })
  async unhide(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @UserId() userId: string,
  ): Promise<CommentDto> {
    return this.present(
      await this._commentService.unhide(commentId, userId),
      userId,
    );
  }

  /**
   * Removes a comment under the content policy.
   *
   * @param commentId - The comment.
   * @param dto - What the author is told.
   * @param userId - The administrator.
   * @returns The comment, now removed.
   */
  @Post(':commentId/remove')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(PERMISSION_CODES.STORYTIME_MODERATE)
  @ApiOperation({ summary: 'Remove a comment under the content policy' })
  @ApiOkResponse({ type: CommentDto })
  @ApiNotFoundResponse({ description: 'No comment has that identifier.' })
  async removeAsAdmin(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: RemoveCommentDto,
    @UserId() userId: string,
  ): Promise<CommentDto> {
    return this.present(
      await this._commentService.removeAsAdmin(commentId, dto.message, userId),
      userId,
    );
  }

  /**
   * Answers with one comment, named.
   *
   * Every write returns the comment it just changed, and a comment says who
   * wrote it, so each of them would otherwise resolve the author itself.
   *
   * @param comment - The comment.
   * @param viewerUserId - Who is reading it back.
   * @returns The comment as that reader may see it.
   */
  private async present(
    comment: StorytimeCommentEntity,
    viewerUserId: string,
  ): Promise<CommentDto> {
    return this._mapper.toComment(
      comment,
      viewerUserId,
      await this._authorService.findAuthors([comment.authorUserId]),
    );
  }
}
