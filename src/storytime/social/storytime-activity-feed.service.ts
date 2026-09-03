import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, MoreThan, Repository } from 'typeorm';

import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { ChapterStatus } from '../enums/chapter-status.enum';
import { StoryStatus } from '../enums/story-status.enum';
import { StorytimeActivityType } from '../enums/storytime-activity-type.enum';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeVisibility } from '../enums/storytime-visibility.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeActivityFeedItemEntity } from './entities/storytime-activity-feed-item.entity';
import { StorytimeFeedStateEntity } from './entities/storytime-feed-state.entity';
import { StorytimeFollowService } from './storytime-follow.service';

/** How many items a feed page holds. */
const DEFAULT_PAGE_SIZE = 30;

/** One thing that happened, with what a reader may see of it. */
export interface FeedEntry {
  /** The feed item. */
  item: StorytimeActivityFeedItemEntity;
  /** The Story it concerns, when the reader may see it. */
  story: StorytimeStoryEntity | null;
  /** The Chapter it concerns, when the reader may see it. */
  chapter: StorytimeChapterEntity | null;
  /** The Arc it concerns, when the reader may see it. */
  arc: StorytimeArcEntity | null;
}

/**
 * What the people and work a reader follows have been doing.
 *
 * Nothing is copied into the feed. An item names what happened and what it
 * happened to, and the content is resolved when somebody reads — so a Story
 * unpublished, made private or removed since simply stops appearing, rather
 * than being served from a stale copy nobody can withdraw.
 */
@Injectable()
export class StorytimeActivityFeedService {
  private readonly _logger = new Logger(StorytimeActivityFeedService.name);

  /**
   * Creates an instance of StorytimeActivityFeedService.
   *
   * @param _itemRepository - Repository of feed items.
   * @param _stateRepository - How far each reader has got.
   * @param _storyRepository - Resolves the Stories items name.
   * @param _chapterRepository - Resolves the Chapters items name.
   * @param _arcRepository - Resolves the Arcs items name.
   * @param _followService - Who and what a reader follows.
   */
  constructor(
    @InjectRepository(StorytimeActivityFeedItemEntity)
    private readonly _itemRepository: Repository<StorytimeActivityFeedItemEntity>,
    @InjectRepository(StorytimeFeedStateEntity)
    private readonly _stateRepository: Repository<StorytimeFeedStateEntity>,
    @InjectRepository(StorytimeStoryEntity)
    private readonly _storyRepository: Repository<StorytimeStoryEntity>,
    @InjectRepository(StorytimeChapterEntity)
    private readonly _chapterRepository: Repository<StorytimeChapterEntity>,
    @InjectRepository(StorytimeArcEntity)
    private readonly _arcRepository: Repository<StorytimeArcEntity>,
    private readonly _followService: StorytimeFollowService,
  ) {}

  /**
   * Records that something happened.
   *
   * Called by whatever did the thing. Failing to record it must never fail the
   * thing itself, so callers treat this as best effort.
   *
   * @param activityType - What happened.
   * @param actorUserId - Who did it.
   * @param targets - The Story, Chapter or Arc involved.
   * @returns The item written.
   */
  record(
    activityType: StorytimeActivityType,
    actorUserId: string,
    targets: {
      storyId?: string | null;
      chapterId?: string | null;
      arcId?: string | null;
    } = {},
  ): Promise<StorytimeActivityFeedItemEntity> {
    return this._itemRepository.save(
      this._itemRepository.create({
        activityType,
        actorUserId,
        storyId: targets.storyId ?? null,
        chapterId: targets.chapterId ?? null,
        arcId: targets.arcId ?? null,
      }),
    );
  }

  /**
   * Records something without letting the recording fail the thing itself.
   *
   * Publishing a Chapter is a creator's work; announcing it is bookkeeping. If
   * the bookkeeping fails, the Chapter is still published and visible, and the
   * only cost is that it does not appear in a feed. Callers use this rather
   * than repeating the same try around every site.
   *
   * @param activityType - What happened.
   * @param actorUserId - Who did it.
   * @param targets - The Story, Chapter or Arc involved.
   */
  async recordQuietly(
    activityType: StorytimeActivityType,
    actorUserId: string,
    targets: {
      storyId?: string | null;
      chapterId?: string | null;
      arcId?: string | null;
    } = {},
  ): Promise<void> {
    try {
      await this.record(activityType, actorUserId, targets);
    } catch (error) {
      this._logger.error(
        `Failed to record ${activityType} by ${actorUserId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Reads a reader's feed.
   *
   * @param userId - The reader.
   * @param page - The page wanted.
   * @param pageSize - How many items a page holds.
   * @returns The items they may see, newest first.
   */
  async findFeed(
    userId: string,
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
  ): Promise<FeedEntry[]> {
    const follows = await this._followService.findFollows(userId);
    const items = await this.findCandidates(follows, page, pageSize);

    return this.withVisibleContent(items);
  }

  /**
   * Counts what a reader has not seen yet.
   *
   * Counted against their watermark, and only over things they may actually
   * see: a badge promising three new items that turn out to be one is worse
   * than no badge.
   *
   * @param userId - The reader.
   * @returns How many unseen items they may read.
   */
  async countUnread(userId: string): Promise<number> {
    const state = await this._stateRepository.findOne({ where: { userId } });
    const follows = await this._followService.findFollows(userId);

    if (this.followsNothing(follows)) {
      return 0;
    }

    const items = await this._itemRepository.find({
      where: this.candidateConditions(follows, state?.lastReadAt),
      order: { occurredAt: 'DESC' },
      take: 100,
    });

    return (await this.withVisibleContent(items)).length;
  }

  /**
   * Marks the feed as seen up to now.
   *
   * @param userId - The reader.
   */
  async markRead(userId: string): Promise<void> {
    await this._stateRepository.save(
      this._stateRepository.create({ userId, lastReadAt: new Date() }),
    );
  }

  /**
   * Finds the items a reader's follows could produce.
   *
   * @param follows - What they follow.
   * @param page - The page wanted.
   * @param pageSize - How many items a page holds.
   * @returns The candidate items, newest first.
   */
  private async findCandidates(
    follows: Awaited<ReturnType<StorytimeFollowService['findFollows']>>,
    page: number,
    pageSize: number,
  ): Promise<StorytimeActivityFeedItemEntity[]> {
    if (this.followsNothing(follows)) {
      return [];
    }

    return this._itemRepository.find({
      where: this.candidateConditions(follows),
      order: { occurredAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }

  /**
   * Builds the conditions matching what a reader follows.
   *
   * Three conditions rather than one join: an item is interesting because its
   * actor is followed, or because the Story is, or because the Arc is, and
   * those are three different reasons rather than one.
   *
   * @param follows - What they follow.
   * @param since - Only items after this moment, when counting unread.
   * @returns The conditions.
   */
  private candidateConditions(
    follows: Awaited<ReturnType<StorytimeFollowService['findFollows']>>,
    since?: Date,
  ): Record<string, unknown>[] {
    const occurredAt = since ? { occurredAt: MoreThan(since) } : {};
    const conditions: Record<string, unknown>[] = [];

    if (follows.creatorUserIds.length > 0) {
      conditions.push({
        actorUserId: In(follows.creatorUserIds),
        ...occurredAt,
      });
    }

    if (follows.storyIds.length > 0) {
      conditions.push({ storyId: In(follows.storyIds), ...occurredAt });
    }

    if (follows.arcIds.length > 0) {
      conditions.push({ arcId: In(follows.arcIds), ...occurredAt });
    }

    return conditions;
  }

  /**
   * Attaches the content each item names, dropping what cannot be seen.
   *
   * This is the recheck the design asks for: an item written when a Story was
   * public survives in the table, and stops appearing the moment the Story
   * does not.
   *
   * @param items - The candidate items.
   * @returns The items whose content is still readable.
   */
  private async withVisibleContent(
    items: StorytimeActivityFeedItemEntity[],
  ): Promise<FeedEntry[]> {
    if (items.length === 0) {
      return [];
    }

    const [stories, chapters, arcs] = await Promise.all([
      this.findStories(items),
      this.findChapters(items),
      this.findArcs(items),
    ]);

    return items
      .map(item => ({
        item,
        story: item.storyId ? (stories.get(item.storyId) ?? null) : null,
        chapter: item.chapterId ? (chapters.get(item.chapterId) ?? null) : null,
        arc: item.arcId ? (arcs.get(item.arcId) ?? null) : null,
      }))
      .filter(entry => this.isReadable(entry));
  }

  /**
   * Whether a feed entry still has something a reader may open.
   *
   * @param entry - The entry.
   * @returns True when the content it names is readable.
   */
  private isReadable(entry: FeedEntry): boolean {
    if (entry.item.chapterId) {
      return entry.chapter !== null && entry.story !== null;
    }

    if (entry.item.storyId) {
      return entry.story !== null;
    }

    return entry.arc !== null;
  }

  /**
   * Finds the readable Stories the items name.
   *
   * @param items - The items.
   * @returns The Stories, by identifier.
   */
  private async findStories(
    items: StorytimeActivityFeedItemEntity[],
  ): Promise<Map<string, StorytimeStoryEntity>> {
    const ids = this.identifiers(items, 'storyId');

    if (ids.length === 0) {
      return new Map();
    }

    const stories = await this._storyRepository.find({
      where: { id: In(ids) },
    });

    return new Map(
      stories
        .filter(
          story =>
            story.status === StoryStatus.PUBLISHED &&
            story.visibility !== StorytimeVisibility.PRIVATE &&
            story.moderationStatus === StorytimeModerationStatus.ACTIVE,
        )
        .map(story => [story.id, story]),
    );
  }

  /**
   * Finds the readable Chapters the items name.
   *
   * @param items - The items.
   * @returns The Chapters, by identifier.
   */
  private async findChapters(
    items: StorytimeActivityFeedItemEntity[],
  ): Promise<Map<string, StorytimeChapterEntity>> {
    const ids = this.identifiers(items, 'chapterId');

    if (ids.length === 0) {
      return new Map();
    }

    const chapters = await this._chapterRepository.find({
      where: { id: In(ids) },
    });

    return new Map(
      chapters
        .filter(
          chapter =>
            chapter.status === ChapterStatus.PUBLISHED &&
            chapter.moderationStatus === StorytimeModerationStatus.ACTIVE,
        )
        .map(chapter => [chapter.id, chapter]),
    );
  }

  /**
   * Finds the readable Arcs the items name.
   *
   * @param items - The items.
   * @returns The Arcs, by identifier.
   */
  private async findArcs(
    items: StorytimeActivityFeedItemEntity[],
  ): Promise<Map<string, StorytimeArcEntity>> {
    const ids = this.identifiers(items, 'arcId');

    if (ids.length === 0) {
      return new Map();
    }

    const arcs = await this._arcRepository.find({ where: { id: In(ids) } });

    return new Map(
      arcs
        .filter(
          arc =>
            arc.visibility !== StorytimeVisibility.PRIVATE &&
            arc.moderationStatus === StorytimeModerationStatus.ACTIVE,
        )
        .map(arc => [arc.id, arc]),
    );
  }

  /**
   * Collects one kind of identifier from a set of items.
   *
   * @param items - The items.
   * @param key - Which identifier to collect.
   * @returns The identifiers named.
   */
  private identifiers(
    items: StorytimeActivityFeedItemEntity[],
    key: 'storyId' | 'chapterId' | 'arcId',
  ): string[] {
    return [
      ...new Set(
        items.map(item => item[key]).filter((id): id is string => id !== null),
      ),
    ];
  }

  /**
   * Whether a reader follows nothing at all.
   *
   * @param follows - What they follow.
   * @returns True when there is nothing to build a feed from.
   */
  private followsNothing(
    follows: Awaited<ReturnType<StorytimeFollowService['findFollows']>>,
  ): boolean {
    return (
      follows.creatorUserIds.length === 0 &&
      follows.storyIds.length === 0 &&
      follows.arcIds.length === 0
    );
  }
}
