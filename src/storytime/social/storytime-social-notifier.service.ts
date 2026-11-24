import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { NotificationEmailType } from 'src/notification/email/notification-email-type.enum';
import { NotificationSeverity } from 'src/notification/enums/notification-severity.enum';
import { NotificationTarget } from 'src/notification/enums/notification-target.enum';
import { NotificationService } from 'src/notification/notification.service';

import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { ChapterStatus } from '../enums/chapter-status.enum';
import { StoryStatus } from '../enums/story-status.enum';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeVisibility } from '../enums/storytime-visibility.enum';
import { StorytimeAuthorService } from '../shared/storytime-author.service';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeCreatorFollowEntity } from './entities/storytime-creator-follow.entity';
import { StorytimeStoryFollowEntity } from './entities/storytime-story-follow.entity';

/** Where Storytime's pages are, below the frontend's address. */
const STORYTIME = '/storytime';

/** A piece of work a notice is about: what it is called and where it is. */
interface Work {
  /** Who answers for it. */
  readonly ownerUserId: string;
  /** How a notice names it, such as `your Story "The Long Watch"`. */
  readonly described: string;
  /** Where it is read. */
  readonly linkUrl: string;
}

/** What the notices call each kind of work. */
const KIND_NAMES: Partial<Record<StorytimeTargetType, string>> = {
  [StorytimeTargetType.STORY]: 'Story',
  [StorytimeTargetType.CHAPTER]: 'Chapter',
  [StorytimeTargetType.ARC]: 'Arc',
};

/**
 * Tells Storytime authors and readers what people did with their work
 * (sc-1067).
 *
 * Authors hear of new followers, comments on their work, replies to their
 * comments and reactions; readers hear of new Stories and Chapters from the
 * creators and Stories they follow. Each notice may also send its email.
 * Nobody is told of their own doing, and every notice is best effort: the
 * follow, comment or reaction stands whether or not anybody hears of it.
 * Comment text is never repeated, so nothing said is copied into an inbox.
 */
@Injectable()
export class StorytimeSocialNotifier {
  private readonly _logger = new Logger(StorytimeSocialNotifier.name);

  /**
   * Creates an instance of StorytimeSocialNotifier.
   *
   * @param _storyRepository - Stories.
   * @param _chapterRepository - Chapters.
   * @param _arcRepository - Arcs.
   * @param _creatorFollowRepository - Who follows which creators.
   * @param _storyFollowRepository - Who follows which Stories.
   * @param _authors - Names people.
   * @param _notifications - Writes the notices.
   */
  constructor(
    @InjectRepository(StorytimeStoryEntity)
    private readonly _storyRepository: Repository<StorytimeStoryEntity>,
    @InjectRepository(StorytimeChapterEntity)
    private readonly _chapterRepository: Repository<StorytimeChapterEntity>,
    @InjectRepository(StorytimeArcEntity)
    private readonly _arcRepository: Repository<StorytimeArcEntity>,
    @InjectRepository(StorytimeCreatorFollowEntity)
    private readonly _creatorFollowRepository: Repository<StorytimeCreatorFollowEntity>,
    @InjectRepository(StorytimeStoryFollowEntity)
    private readonly _storyFollowRepository: Repository<StorytimeStoryFollowEntity>,
    private readonly _authors: StorytimeAuthorService,
    private readonly _notifications: NotificationService,
  ) {}

  /**
   * Tells a creator somebody followed them, or a Story or Arc of theirs.
   *
   * @param targetType - A creator is the person; otherwise the work's kind.
   * @param targetId - Whom, or what.
   * @param followerId - Who followed.
   */
  async followed(
    targetType: 'CREATOR' | StorytimeTargetType,
    targetId: string,
    followerId: string,
  ): Promise<void> {
    await this.quietly('followed', async () => {
      const name = await this.nameOf(followerId);

      if (targetType === 'CREATOR') {
        await this.tell(
          targetId,
          followerId,
          NotificationEmailType.STORYTIME_FOLLOWER,
          {
            title: 'New follower',
            body: `${name} followed you on Storytime.`,
            linkUrl: `${STORYTIME}/creators/${followerId}`,
          },
        );

        return;
      }

      const work = await this.workOf(targetType, targetId);

      if (work !== null) {
        await this.tell(
          work.ownerUserId,
          followerId,
          NotificationEmailType.STORYTIME_FOLLOWER,
          {
            title: 'New follower',
            body: `${name} followed ${work.described}.`,
            linkUrl: work.linkUrl,
          },
        );
      }
    });
  }

  /**
   * Tells an author of a comment on their work, or a commenter of a reply.
   *
   * Somebody who wrote both the work and the comment replied to hears once,
   * of the reply.
   *
   * @param comment - The comment.
   * @param comment.targetType - What it is on.
   * @param comment.targetId - Which.
   * @param comment.authorUserId - Who wrote it.
   * @param parentAuthorId - Who wrote the comment it answers, or null.
   */
  async commented(
    comment: {
      targetType: StorytimeTargetType;
      targetId: string;
      authorUserId: string;
    },
    parentAuthorId: string | null,
  ): Promise<void> {
    await this.quietly('commented', async () => {
      const [name, work] = await Promise.all([
        this.nameOf(comment.authorUserId),
        this.workOf(comment.targetType, comment.targetId),
      ]);

      if (work === null) {
        return;
      }

      if (parentAuthorId !== null) {
        await this.tell(
          parentAuthorId,
          comment.authorUserId,
          NotificationEmailType.STORYTIME_REPLY,
          {
            title: 'New reply to your comment',
            body: `${name} replied to your comment on ${work.described.replace(/^your /, '')}.`,
            linkUrl: work.linkUrl,
          },
        );
      }

      if (work.ownerUserId !== parentAuthorId) {
        await this.tell(
          work.ownerUserId,
          comment.authorUserId,
          NotificationEmailType.STORYTIME_COMMENT,
          {
            title: 'New comment on your work',
            body: `${name} commented on ${work.described}.`,
            linkUrl: work.linkUrl,
          },
        );
      }
    });
  }

  /**
   * Tells an author somebody reacted to their work.
   *
   * @param targetType - The kind of work.
   * @param targetId - Which.
   * @param reactorId - Who reacted.
   */
  async reacted(
    targetType: StorytimeTargetType,
    targetId: string,
    reactorId: string,
  ): Promise<void> {
    await this.quietly('reacted', async () => {
      const [name, work] = await Promise.all([
        this.nameOf(reactorId),
        this.workOf(targetType, targetId),
      ]);

      if (work !== null) {
        await this.tell(
          work.ownerUserId,
          reactorId,
          NotificationEmailType.STORYTIME_REACTION,
          {
            title: 'New reaction to your work',
            body: `${name} reacted to ${work.described}.`,
            linkUrl: work.linkUrl,
          },
        );
      }
    });
  }

  /**
   * Tells the followers of a Story and of its creator that something new is
   * out, while it is published, not private and not removed.
   *
   * @param storyId - The Story.
   * @param chapterId - The Chapter published, or null for the Story itself.
   * @param actorUserId - Who published it.
   */
  async published(
    storyId: string,
    chapterId: string | null,
    actorUserId: string,
  ): Promise<void> {
    await this.quietly('published', async () => {
      const story = await this._storyRepository.findOne({
        where: { id: storyId },
      });

      if (!story || !this.isReadable(story)) {
        return;
      }

      const chapter = chapterId
        ? await this._chapterRepository.findOne({ where: { id: chapterId } })
        : null;

      if (chapterId !== null && !this.isReadableChapter(chapter)) {
        return;
      }

      const followers = await this.followersOf(story);
      const name = await this.nameOf(story.ownerUserId);
      const storyUrl = `${STORYTIME}/stories/${story.slug}`;
      const notice = chapter
        ? {
            title: 'New Chapter',
            body: `"${chapter.title}" is out in "${story.title}".`,
            linkUrl: `${storyUrl}/chapters/${chapter.slug}`,
          }
        : {
            title: 'New Story',
            body: `${name} published "${story.title}".`,
            linkUrl: storyUrl,
          };

      for (const userId of followers) {
        if (userId !== story.ownerUserId) {
          await this.tell(
            userId,
            actorUserId,
            NotificationEmailType.STORYTIME_FOLLOWED_PUBLICATION,
            notice,
          );
        }
      }
    });
  }

  /**
   * Whether readers may see a Story.
   *
   * @param story - The Story.
   * @returns True while it is published, not private and not removed.
   */
  private isReadable(story: StorytimeStoryEntity): boolean {
    return (
      story.status === StoryStatus.PUBLISHED &&
      story.visibility !== StorytimeVisibility.PRIVATE &&
      story.moderationStatus === StorytimeModerationStatus.ACTIVE
    );
  }

  /**
   * Whether readers may see a Chapter.
   *
   * @param chapter - The Chapter, or null when it has gone.
   * @returns True while it is published and not removed.
   */
  private isReadableChapter(chapter: StorytimeChapterEntity | null): boolean {
    return (
      chapter?.status === ChapterStatus.PUBLISHED &&
      chapter.moderationStatus === StorytimeModerationStatus.ACTIVE
    );
  }

  /**
   * Everybody following a Story or its creator, once each.
   *
   * @param story - The Story.
   * @returns Their user IDs.
   */
  private async followersOf(story: StorytimeStoryEntity): Promise<string[]> {
    const [ofStory, ofCreator] = await Promise.all([
      this._storyFollowRepository.find({ where: { storyId: story.id } }),
      this._creatorFollowRepository.find({
        where: { creatorUserId: story.ownerUserId },
      }),
    ]);

    return [
      ...new Set([...ofStory, ...ofCreator].map(follow => follow.userId)),
    ];
  }

  /**
   * Finds a piece of work, its owner and its page.
   *
   * @param targetType - The kind of work.
   * @param targetId - Which.
   * @returns The work, or null when it has gone or is not a kind told of.
   */
  private async workOf(
    targetType: StorytimeTargetType,
    targetId: string,
  ): Promise<Work | null> {
    const kind = KIND_NAMES[targetType];

    if (targetType === StorytimeTargetType.ARC) {
      const arc = await this._arcRepository.findOne({
        where: { id: targetId },
      });

      return arc
        ? {
            ownerUserId: arc.ownerUserId,
            described: `your ${kind} "${arc.title}"`,
            linkUrl: `${STORYTIME}/arcs/${arc.slug}`,
          }
        : null;
    }

    if (targetType === StorytimeTargetType.CHAPTER) {
      const chapter = await this._chapterRepository.findOne({
        where: { id: targetId },
      });
      const story = chapter
        ? await this._storyRepository.findOne({
            where: { id: chapter.storyId },
          })
        : null;

      return chapter && story
        ? {
            ownerUserId: story.ownerUserId,
            described: `your ${kind} "${chapter.title}"`,
            linkUrl: `${STORYTIME}/stories/${story.slug}/chapters/${chapter.slug}`,
          }
        : null;
    }

    if (targetType !== StorytimeTargetType.STORY) {
      return null;
    }

    const story = await this._storyRepository.findOne({
      where: { id: targetId },
    });

    return story
      ? {
          ownerUserId: story.ownerUserId,
          described: `your ${kind} "${story.title}"`,
          linkUrl: `${STORYTIME}/stories/${story.slug}`,
        }
      : null;
  }

  /**
   * Names somebody by their username.
   *
   * @param userId - Who.
   * @returns Their username, or "Someone" when they have none.
   */
  private async nameOf(userId: string): Promise<string> {
    return (await this._authors.findAuthor(userId))?.username ?? 'Someone';
  }

  /**
   * Writes one notice, unless it would tell somebody of their own doing.
   *
   * @param userId - Who it is for.
   * @param actorUserId - Who did the thing.
   * @param email - The kind of email that mirrors it.
   * @param notice - What it says.
   * @param notice.title - Its title.
   * @param notice.body - Its text.
   * @param notice.linkUrl - Where it leads.
   */
  private async tell(
    userId: string,
    actorUserId: string,
    email: NotificationEmailType,
    notice: { title: string; body: string; linkUrl: string },
  ): Promise<void> {
    if (userId === actorUserId) {
      return;
    }

    await this._notifications.createNotification(
      {
        target: NotificationTarget.USER,
        userId,
        severity: NotificationSeverity.INFO,
        ...notice,
      },
      { email },
    );
  }

  /**
   * Runs a notice, logging rather than throwing.
   *
   * @param step - What it was, for the log.
   * @param work - The notice.
   */
  private async quietly(
    step: string,
    work: () => Promise<void>,
  ): Promise<void> {
    try {
      await work();
    } catch (error) {
      this._logger.warn(
        `[${step}] A Storytime notice was not sent - Reason: ${(error as Error).name}`,
      );
    }
  }
}
