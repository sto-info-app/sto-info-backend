import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeCommentStatus } from '../enums/storytime-comment-status.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { CreateCommentDto } from './dto/comment.dto';
import { StorytimeCommentEntity } from './entities/storytime-comment.entity';

/** The things a reader may comment on. */
export const COMMENTABLE_TARGET_TYPES = [
  StorytimeTargetType.STORY,
  StorytimeTargetType.CHAPTER,
  StorytimeTargetType.ARC,
] as const;

/**
 * Discussion on Stories, Chapters and Arcs.
 *
 * Three people may silence a comment, and which of them did it is part of the
 * record: an author thinking better of it, an owner tidying their own page,
 * and an administrator enforcing the content policy are different events, and
 * only the last is a moderation decision anybody may appeal.
 */
@Injectable()
export class StorytimeCommentService {
  private readonly _logger = new Logger(StorytimeCommentService.name);

  /**
   * Creates an instance of StorytimeCommentService.
   *
   * @param _commentRepository - Repository of comments.
   * @param _storyRepository - Resolves who owns a Story or Chapter.
   * @param _chapterRepository - Resolves the Story a Chapter belongs to.
   * @param _arcRepository - Resolves who curates an Arc.
   */
  constructor(
    @InjectRepository(StorytimeCommentEntity)
    private readonly _commentRepository: Repository<StorytimeCommentEntity>,
    @InjectRepository(StorytimeStoryEntity)
    private readonly _storyRepository: Repository<StorytimeStoryEntity>,
    @InjectRepository(StorytimeChapterEntity)
    private readonly _chapterRepository: Repository<StorytimeChapterEntity>,
    @InjectRepository(StorytimeArcEntity)
    private readonly _arcRepository: Repository<StorytimeArcEntity>,
  ) {}

  /**
   * Reads the conversation on one piece of content.
   *
   * Everything comes back, silenced comments included, because a reply to a
   * removed comment still needs somewhere to hang. What a silenced comment
   * shows is decided when it is mapped, not by leaving it out here.
   *
   * @param targetType - What kind of thing.
   * @param targetId - The thing.
   * @returns The comments, oldest first.
   */
  findFor(
    targetType: StorytimeTargetType,
    targetId: string,
  ): Promise<StorytimeCommentEntity[]> {
    return this._commentRepository.find({
      where: { targetType, targetId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Posts a comment, or a reply to one.
   *
   * @param dto - What is being commented on, and what was said.
   * @param authorUserId - The commenter.
   * @returns The comment.
   */
  async create(
    dto: CreateCommentDto,
    authorUserId: string,
  ): Promise<StorytimeCommentEntity> {
    this.assertCommentable(dto.targetType);

    if (dto.parentCommentId) {
      await this.assertRepliable(dto);
    }

    const comment = await this._commentRepository.save(
      this._commentRepository.create({
        targetType: dto.targetType,
        targetId: dto.targetId,
        authorUserId,
        parentCommentId: dto.parentCommentId ?? null,
        body: dto.body,
        status: StorytimeCommentStatus.VISIBLE,
      }),
    );

    this._logger.log(
      `Comment ${comment.id} posted on ${dto.targetType} ${dto.targetId}`,
    );

    return comment;
  }

  /**
   * Changes what a comment says.
   *
   * Only the author, and only while it is still shown: editing a comment an
   * administrator removed would let somebody rewrite what was moderated.
   *
   * @param commentId - The comment.
   * @param body - What it should say.
   * @param actingUserId - The caller.
   * @returns The comment after the edit.
   */
  async update(
    commentId: string,
    body: string,
    actingUserId: string,
  ): Promise<StorytimeCommentEntity> {
    const comment = await this.findOneOrFail(commentId);

    if (comment.authorUserId !== actingUserId) {
      throw new ForbiddenException('That comment is not yours to edit.');
    }

    if (comment.status !== StorytimeCommentStatus.VISIBLE) {
      throw new BadRequestException('That comment can no longer be edited.');
    }

    comment.body = body;
    comment.editedAt = new Date();

    return this._commentRepository.save(comment);
  }

  /**
   * Takes a comment back.
   *
   * @param commentId - The comment.
   * @param actingUserId - The author.
   * @returns The comment, now marked as taken back.
   */
  async deleteOwn(
    commentId: string,
    actingUserId: string,
  ): Promise<StorytimeCommentEntity> {
    const comment = await this.findOneOrFail(commentId);

    if (comment.authorUserId !== actingUserId) {
      throw new ForbiddenException('That comment is not yours to delete.');
    }

    return this.silence(
      comment,
      StorytimeCommentStatus.DELETED_BY_AUTHOR,
      actingUserId,
      null,
    );
  }

  /**
   * Hides a comment from the owner's own page.
   *
   * The owner of the content may do this and nothing more: hiding is not
   * moderation, it leaves no policy record, and the comment stays visible to
   * whoever wrote it.
   *
   * @param commentId - The comment.
   * @param actingUserId - The owner.
   * @returns The comment, now hidden.
   */
  async hide(
    commentId: string,
    actingUserId: string,
  ): Promise<StorytimeCommentEntity> {
    const comment = await this.findOneOrFail(commentId);
    const ownerUserId = await this.ownerOf(
      comment.targetType,
      comment.targetId,
    );

    if (ownerUserId !== actingUserId) {
      throw new ForbiddenException(
        'Only the owner of this content may hide a comment on it.',
      );
    }

    return this.silence(
      comment,
      StorytimeCommentStatus.HIDDEN_BY_OWNER,
      actingUserId,
      null,
    );
  }

  /**
   * Puts a hidden comment back.
   *
   * Only what the owner hid. A comment an administrator removed is not theirs
   * to restore, which is the difference between tidying and moderating.
   *
   * @param commentId - The comment.
   * @param actingUserId - The owner.
   * @returns The comment, shown again.
   */
  async unhide(
    commentId: string,
    actingUserId: string,
  ): Promise<StorytimeCommentEntity> {
    const comment = await this.findOneOrFail(commentId);
    const ownerUserId = await this.ownerOf(
      comment.targetType,
      comment.targetId,
    );

    if (ownerUserId !== actingUserId) {
      throw new ForbiddenException(
        'Only the owner of this content may unhide a comment on it.',
      );
    }

    if (comment.status !== StorytimeCommentStatus.HIDDEN_BY_OWNER) {
      throw new BadRequestException('That comment was not hidden by you.');
    }

    comment.status = StorytimeCommentStatus.VISIBLE;
    comment.moderatedByUserId = null;
    comment.moderatedAt = null;

    return this._commentRepository.save(comment);
  }

  /**
   * Removes a comment under the content policy.
   *
   * @param commentId - The comment.
   * @param message - What the author is told, word for word.
   * @param actingUserId - The administrator.
   * @returns The comment, now removed.
   */
  async removeAsAdmin(
    commentId: string,
    message: string,
    actingUserId: string,
  ): Promise<StorytimeCommentEntity> {
    const comment = await this.findOneOrFail(commentId);

    this._logger.log(`Comment ${commentId} removed by ${actingUserId}`);

    return this.silence(
      comment,
      StorytimeCommentStatus.REMOVED_BY_ADMIN,
      actingUserId,
      message,
    );
  }

  /**
   * Counts the comments shown on one piece of content.
   *
   * @param targetType - What kind of thing.
   * @param targetId - The thing.
   * @returns How many are visible.
   */
  countVisible(
    targetType: StorytimeTargetType,
    targetId: string,
  ): Promise<number> {
    return this._commentRepository.count({
      where: {
        targetType,
        targetId,
        status: StorytimeCommentStatus.VISIBLE,
      },
    });
  }

  /**
   * Retrieves one comment.
   *
   * @param commentId - The comment.
   * @returns The comment.
   * @throws NotFoundException when no comment has that identifier.
   */
  async findOneOrFail(commentId: string): Promise<StorytimeCommentEntity> {
    const comment = await this._commentRepository.findOne({
      where: { id: commentId },
    });

    if (!comment) {
      throw new NotFoundException('That comment could not be found.');
    }

    return comment;
  }

  /**
   * Writes a silencing to a comment.
   *
   * @param comment - The comment.
   * @param status - Which kind of silencing.
   * @param actingUserId - Who did it.
   * @param message - What was said about it, when anything was.
   * @returns The comment.
   */
  private silence(
    comment: StorytimeCommentEntity,
    status: StorytimeCommentStatus,
    actingUserId: string,
    message: string | null,
  ): Promise<StorytimeCommentEntity> {
    comment.status = status;
    comment.moderatedByUserId = actingUserId;
    comment.moderatedAt = new Date();
    comment.moderationMessage = message;

    return this._commentRepository.save(comment);
  }

  /**
   * Refuses a reply that would nest too deep, or answer something elsewhere.
   *
   * @param dto - The comment being posted.
   * @throws BadRequestException when the parent cannot be replied to.
   */
  private async assertRepliable(dto: CreateCommentDto): Promise<void> {
    const parent = await this.findOneOrFail(dto.parentCommentId as string);

    if (parent.parentCommentId) {
      throw new BadRequestException(
        'Replies go one level deep. Reply to the comment above instead.',
      );
    }

    if (
      parent.targetType !== dto.targetType ||
      parent.targetId !== dto.targetId
    ) {
      throw new BadRequestException('That comment belongs to something else.');
    }
  }

  /**
   * Finds who answers for a piece of content.
   *
   * A Chapter has no owner of its own, so its Story's owner is who may tidy
   * the comments on it.
   *
   * @param targetType - What kind of thing.
   * @param targetId - The thing.
   * @returns The owner, or null when the content has gone.
   */
  private async ownerOf(
    targetType: StorytimeTargetType,
    targetId: string,
  ): Promise<string | null> {
    if (targetType === StorytimeTargetType.ARC) {
      const arc = await this._arcRepository.findOne({
        where: { id: targetId },
      });

      return arc?.ownerUserId ?? null;
    }

    if (targetType === StorytimeTargetType.CHAPTER) {
      const chapter = await this._chapterRepository.findOne({
        where: { id: targetId },
      });

      if (!chapter) {
        return null;
      }

      const story = await this._storyRepository.findOne({
        where: { id: chapter.storyId },
      });

      return story?.ownerUserId ?? null;
    }

    const story = await this._storyRepository.findOne({
      where: { id: targetId },
    });

    return story?.ownerUserId ?? null;
  }

  /**
   * Refuses a kind of thing nobody may comment on.
   *
   * @param targetType - What kind of thing.
   * @throws BadRequestException when it carries no discussion.
   */
  private assertCommentable(targetType: StorytimeTargetType): void {
    const commentable = COMMENTABLE_TARGET_TYPES.includes(
      targetType as (typeof COMMENTABLE_TARGET_TYPES)[number],
    );

    if (!commentable) {
      throw new BadRequestException('That cannot be commented on.');
    }
  }
}
