import { Injectable } from '@nestjs/common';
import { StorytimeCommentStatus } from '../enums/storytime-comment-status.enum';
import { CommentDto } from './dto/comment.dto';
import { StorytimeCommentEntity } from './entities/storytime-comment.entity';

/**
 * Turns comments into the shape the API returns.
 *
 * This is where a silenced comment stops carrying its words. Doing it here
 * rather than in the query means a reply to a removed comment still has
 * somewhere to hang, and there is one place to be right about it rather than
 * one per route.
 *
 * The author is the exception: somebody must be able to see what they wrote,
 * or they cannot tell what was taken down.
 */
@Injectable()
export class StorytimeCommentMapper {
  /**
   * Maps a comment for a particular reader.
   *
   * @param comment - The comment entity.
   * @param viewerUserId - Who is reading, when somebody is signed in.
   * @returns The comment as that reader may see it.
   */
  toComment(
    comment: StorytimeCommentEntity,
    viewerUserId?: string,
  ): CommentDto {
    const isAuthor = comment.authorUserId === viewerUserId;
    const isVisible = comment.status === StorytimeCommentStatus.VISIBLE;

    return {
      id: comment.id,
      authorUserId: comment.authorUserId,
      parentCommentId: comment.parentCommentId,
      body: isVisible || isAuthor ? comment.body : null,
      status: comment.status,
      editedAt: comment.editedAt,
      createdAt: comment.createdAt,
    };
  }

  /**
   * Maps a conversation.
   *
   * @param comments - The comment entities.
   * @param viewerUserId - Who is reading, when somebody is signed in.
   * @returns The comments as that reader may see them.
   */
  toList(
    comments: StorytimeCommentEntity[],
    viewerUserId?: string,
  ): CommentDto[] {
    return comments.map(comment => this.toComment(comment, viewerUserId));
  }
}
