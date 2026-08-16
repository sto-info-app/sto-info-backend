import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ChapterStatus } from '../enums/chapter-status.enum';
import { ReaderChapterStatus } from '../enums/reader-chapter-status.enum';
import { ReaderStoryStatus } from '../enums/reader-story-status.enum';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import {
  CHAPTER_COMPLETE_PERCENT,
  MEANINGFUL_PROGRESS_PERCENT,
  POSITION_TYPE_BLOCK,
} from './constants/storytime-progress.constants';
import { UpdateChapterProgressDto } from './dto/update-chapter-progress.dto';
import { UpdateStoryProgressDto } from './dto/update-story-progress.dto';
import { StorytimeUserChapterProgressEntity } from './entities/storytime-user-chapter-progress.entity';
import { StorytimeUserStoryProgressEntity } from './entities/storytime-user-story-progress.entity';

/**
 * Statuses a reader has chosen deliberately.
 *
 * Reading on must not drag a Story out of one of these; a reader who put a
 * Story on hold and then dipped back in has not changed their mind.
 */
const DELIBERATE_STATUSES = [
  ReaderStoryStatus.ON_HOLD,
  ReaderStoryStatus.ABANDONED,
];

/**
 * A Story's progress with the figures a reader is shown.
 */
export interface StoryProgressSummary {
  progress: StorytimeUserStoryProgressEntity;
  /** Published, readable Chapters in the Story right now. */
  totalChapters: number;
  /** How many of those the reader has finished. */
  readChapters: number;
  /** Whole percent, 0 when the Story has no readable Chapters. */
  percentComplete: number;
  /** Chapters published since the reader was last up to date. */
  newChapterCount: number;
  /** Where Continue Reading should send them, if anywhere. */
  continueChapterId: string | null;
}

/**
 * Tracking how far a reader has got.
 *
 * Two rules shape everything here. Opening a Chapter is not reading it, so
 * progress only begins once a reader passes a threshold; and a status the
 * reader chose deliberately is never overwritten by them reading on.
 */
@Injectable()
export class StorytimeProgressService {
  private readonly _logger = new Logger(StorytimeProgressService.name);

  /**
   * Creates an instance of StorytimeProgressService.
   *
   * @param _storyProgressRepository - Repository of Story progress.
   * @param _chapterProgressRepository - Repository of Chapter progress.
   * @param _chapterRepository - Repository of Chapters, for the readable set.
   */
  constructor(
    @InjectRepository(StorytimeUserStoryProgressEntity)
    private readonly _storyProgressRepository: Repository<StorytimeUserStoryProgressEntity>,
    @InjectRepository(StorytimeUserChapterProgressEntity)
    private readonly _chapterProgressRepository: Repository<StorytimeUserChapterProgressEntity>,
    @InjectRepository(StorytimeChapterEntity)
    private readonly _chapterRepository: Repository<StorytimeChapterEntity>,
  ) {}

  /**
   * Reports a reader's progress through a Story.
   *
   * @param userId - The reader.
   * @param storyId - The Story.
   * @returns The progress and the figures derived from it.
   */
  async getStoryProgress(
    userId: string,
    storyId: string,
  ): Promise<StoryProgressSummary> {
    const progress = await this.findOrCreateStoryProgress(userId, storyId);

    return this.summarise(userId, progress);
  }

  /**
   * Lists every Story a reader has progress on.
   *
   * @param userId - The reader.
   * @param status - An optional status to filter by, for library tabs.
   * @returns The reader's progress rows, most recently read first.
   */
  findLibrary(
    userId: string,
    status?: ReaderStoryStatus,
  ): Promise<StorytimeUserStoryProgressEntity[]> {
    return this._storyProgressRepository.find({
      where: status ? { userId, status } : { userId },
      order: { lastReadAt: 'DESC', updatedAt: 'DESC' },
    });
  }

  /**
   * Records how far a reader has got through a Chapter.
   *
   * Idempotent: the same position sent twice leaves the same result, so a
   * client may debounce and retry without special handling.
   *
   * @param userId - The reader.
   * @param chapterId - The Chapter.
   * @param dto - The reported position.
   * @returns The Story's progress after the update.
   * @throws NotFoundException when the Chapter does not exist.
   */
  async updateChapterProgress(
    userId: string,
    chapterId: string,
    dto: UpdateChapterProgressDto,
  ): Promise<StoryProgressSummary> {
    const chapter = await this._chapterRepository.findOne({
      where: { id: chapterId },
    });

    if (!chapter) {
      throw new NotFoundException('Chapter not found');
    }

    const progress = await this.findOrCreateChapterProgress(
      userId,
      chapter.storyId,
      chapterId,
    );

    this.applyChapterPosition(progress, dto);

    await this._chapterProgressRepository.save(progress);

    return this.refreshStoryProgress(userId, chapter.storyId, chapterId);
  }

  /**
   * Marks a Chapter read or unread outright.
   *
   * @param userId - The reader.
   * @param chapterId - The Chapter.
   * @param isRead - Whether it should now be read.
   * @returns The Story's progress after the change.
   * @throws NotFoundException when the Chapter does not exist.
   */
  async setChapterRead(
    userId: string,
    chapterId: string,
    isRead: boolean,
  ): Promise<StoryProgressSummary> {
    const chapter = await this._chapterRepository.findOne({
      where: { id: chapterId },
    });

    if (!chapter) {
      throw new NotFoundException('Chapter not found');
    }

    const progress = await this.findOrCreateChapterProgress(
      userId,
      chapter.storyId,
      chapterId,
    );

    const now = new Date();

    if (isRead) {
      progress.status = ReaderChapterStatus.READ;
      progress.progressPercent = 100;
      progress.readAt = progress.readAt ?? now;
      progress.startedAt = progress.startedAt ?? now;
      progress.lastReadAt = now;
    } else {
      // Marking unread clears the position too: a reader saying they have not
      // read something and then being dropped halfway through it is worse
      // than starting again.
      progress.status = ReaderChapterStatus.UNREAD;
      progress.progressPercent = null;
      progress.readAt = null;
      progress.lastPositionType = null;
      progress.lastPositionValue = null;
    }

    await this._chapterProgressRepository.save(progress);

    return this.refreshStoryProgress(
      userId,
      chapter.storyId,
      isRead ? chapterId : null,
    );
  }

  /**
   * Applies a reader's deliberate choice of Story status.
   *
   * @param userId - The reader.
   * @param storyId - The Story.
   * @param dto - The chosen status.
   * @returns The Story's progress after the change.
   */
  async setStoryStatus(
    userId: string,
    storyId: string,
    dto: UpdateStoryProgressDto,
  ): Promise<StoryProgressSummary> {
    const progress = await this.findOrCreateStoryProgress(userId, storyId);

    progress.status = dto.status;

    if (dto.status === ReaderStoryStatus.COMPLETED) {
      progress.completedAt = progress.completedAt ?? new Date();
    }

    await this._storyProgressRepository.save(progress);

    return this.summarise(userId, progress);
  }

  /**
   * Marks every readable Chapter of a Story as read.
   *
   * @param userId - The reader.
   * @param storyId - The Story.
   * @returns The Story's progress after the change.
   */
  async completeStory(
    userId: string,
    storyId: string,
  ): Promise<StoryProgressSummary> {
    const chapters = await this.findReadableChapters(storyId);
    const now = new Date();

    for (const chapter of chapters) {
      const progress = await this.findOrCreateChapterProgress(
        userId,
        storyId,
        chapter.id,
      );

      progress.status = ReaderChapterStatus.READ;
      progress.progressPercent = 100;
      progress.readAt = progress.readAt ?? now;
      progress.startedAt = progress.startedAt ?? now;
      progress.lastReadAt = now;

      await this._chapterProgressRepository.save(progress);
    }

    const lastChapter =
      chapters.length > 0 ? chapters[chapters.length - 1] : null;

    return this.refreshStoryProgress(userId, storyId, lastChapter?.id ?? null);
  }

  /**
   * Discards a reader's progress through a Story.
   *
   * The rows are deleted rather than zeroed, because a reader asking to reset
   * is asking for the Story to look untouched, not for a record of having
   * abandoned it.
   *
   * @param userId - The reader.
   * @param storyId - The Story.
   * @returns The Story's progress after the reset.
   */
  async resetStory(
    userId: string,
    storyId: string,
  ): Promise<StoryProgressSummary> {
    await this._chapterProgressRepository.delete({ userId, storyId });
    await this._storyProgressRepository.delete({ userId, storyId });

    return this.getStoryProgress(userId, storyId);
  }

  /**
   * Returns readers of a Story who had finished it to "in progress".
   *
   * Called when a Chapter is published. A reader who finished a Story and then
   * gets a new instalment has something to read again, so the Story reappears
   * in their in-progress list rather than sitting in "completed" where they
   * would never look.
   *
   * The new Chapter is deliberately left unread: marking it read on their
   * behalf would be a lie.
   *
   * @param storyId - The Story that gained a Chapter.
   * @returns How many readers were moved back to in progress.
   */
  async reopenCompletedReaders(storyId: string): Promise<number> {
    const completed = await this._storyProgressRepository.find({
      where: { storyId, status: ReaderStoryStatus.COMPLETED },
    });

    if (completed.length === 0) {
      return 0;
    }

    for (const progress of completed) {
      progress.status = ReaderStoryStatus.IN_PROGRESS;
    }

    await this._storyProgressRepository.save(completed);

    this._logger.log(
      `Reopened ${completed.length} completed reader(s) of Story ${storyId} after new content`,
    );

    return completed.length;
  }

  /**
   * Applies a reported position to a Chapter's progress.
   *
   * @param progress - The Chapter progress to change.
   * @param dto - The reported position.
   */
  private applyChapterPosition(
    progress: StorytimeUserChapterProgressEntity,
    dto: UpdateChapterProgressDto,
  ): void {
    const now = new Date();
    const percent = dto.progressPercent ?? progress.progressPercent ?? 0;

    // Progress only ever moves forward on its own. A reader scrolling back up
    // to re-read a paragraph has not un-read the Chapter.
    const highestPercent = Math.max(percent, progress.progressPercent ?? 0);

    progress.progressPercent = highestPercent;
    progress.lastReadAt = now;

    if (dto.blockId !== undefined) {
      progress.lastPositionType = POSITION_TYPE_BLOCK;
      progress.lastPositionValue = dto.blockId;
    }

    if (highestPercent >= CHAPTER_COMPLETE_PERCENT) {
      progress.status = ReaderChapterStatus.READ;
      progress.readAt = progress.readAt ?? now;
      progress.startedAt = progress.startedAt ?? now;
      return;
    }

    if (highestPercent >= MEANINGFUL_PROGRESS_PERCENT) {
      progress.status = ReaderChapterStatus.IN_PROGRESS;
      progress.startedAt = progress.startedAt ?? now;
      return;
    }

    // Below the threshold the reader has opened the Chapter but not started
    // it, so nothing is recorded beyond having been there.
    progress.status = ReaderChapterStatus.UNREAD;
  }

  /**
   * Recalculates a Story's progress from its Chapters.
   *
   * @param userId - The reader.
   * @param storyId - The Story.
   * @param lastReadChapterId - The Chapter just read, if any.
   * @returns The Story's progress and derived figures.
   */
  private async refreshStoryProgress(
    userId: string,
    storyId: string,
    lastReadChapterId: string | null,
  ): Promise<StoryProgressSummary> {
    const progress = await this.findOrCreateStoryProgress(userId, storyId);
    const chapters = await this.findReadableChapters(storyId);
    const readCount = await this.countReadChapters(userId, storyId, chapters);
    const now = new Date();

    progress.completedChapterCount = readCount;
    progress.lastReadAt = now;

    if (lastReadChapterId) {
      progress.lastReadChapterId = lastReadChapterId;
    }

    if (readCount > 0) {
      progress.startedAt = progress.startedAt ?? now;
    }

    this.applyDerivedStatus(progress, readCount, chapters.length, now);

    await this._storyProgressRepository.save(progress);

    return this.summarise(userId, progress);
  }

  /**
   * Moves a Story's status to match how much of it has been read.
   *
   * A status the reader chose deliberately is left alone: reading one more
   * Chapter of a Story they put on hold does not mean they resumed it.
   *
   * @param progress - The Story progress to change.
   * @param readCount - How many readable Chapters the reader has finished.
   * @param totalChapters - How many readable Chapters there are.
   * @param now - The current time.
   */
  private applyDerivedStatus(
    progress: StorytimeUserStoryProgressEntity,
    readCount: number,
    totalChapters: number,
    now: Date,
  ): void {
    if (DELIBERATE_STATUSES.includes(progress.status)) {
      return;
    }

    if (totalChapters > 0 && readCount >= totalChapters) {
      progress.status = ReaderStoryStatus.COMPLETED;
      progress.completedAt = progress.completedAt ?? now;
      // Recorded at the moment of completion, so a Chapter published later is
      // recognisable as new.
      progress.knownPublishedChapterCount = totalChapters;
      return;
    }

    if (readCount > 0) {
      progress.status = ReaderStoryStatus.IN_PROGRESS;
      progress.completedAt = null;
      progress.knownPublishedChapterCount = totalChapters;
      return;
    }

    progress.status = ReaderStoryStatus.NOT_STARTED;
  }

  /**
   * Builds the figures a reader is shown for a Story.
   *
   * @param userId - The reader.
   * @param progress - Their Story progress.
   * @returns The summary.
   */
  private async summarise(
    userId: string,
    progress: StorytimeUserStoryProgressEntity,
  ): Promise<StoryProgressSummary> {
    const chapters = await this.findReadableChapters(progress.storyId);
    const readIds = await this.findReadChapterIds(userId, progress.storyId);
    const readChapters = chapters.filter(chapter =>
      readIds.has(chapter.id),
    ).length;

    return {
      progress,
      totalChapters: chapters.length,
      readChapters,
      percentComplete:
        chapters.length === 0
          ? 0
          : Math.round((readChapters / chapters.length) * 100),
      newChapterCount: Math.max(
        chapters.length - progress.knownPublishedChapterCount,
        0,
      ),
      continueChapterId:
        chapters.find(chapter => !readIds.has(chapter.id))?.id ?? null,
    };
  }

  /**
   * Finds the Chapters of a Story a reader may actually read, in order.
   *
   * @param storyId - The Story.
   * @returns The readable Chapters.
   */
  private findReadableChapters(
    storyId: string,
  ): Promise<StorytimeChapterEntity[]> {
    return this._chapterRepository.find({
      where: {
        storyId,
        status: ChapterStatus.PUBLISHED,
        moderationStatus: StorytimeModerationStatus.ACTIVE,
      },
      order: { orderIndex: 'ASC' },
    });
  }

  /**
   * Finds which Chapters of a Story a reader has finished.
   *
   * @param userId - The reader.
   * @param storyId - The Story.
   * @returns The finished Chapter identifiers.
   */
  private async findReadChapterIds(
    userId: string,
    storyId: string,
  ): Promise<Set<string>> {
    const rows = await this._chapterProgressRepository.find({
      where: { userId, storyId, status: ReaderChapterStatus.READ },
      select: { chapterId: true },
    });

    return new Set(rows.map(row => row.chapterId));
  }

  /**
   * Counts how many readable Chapters of a Story a reader has finished.
   *
   * Counted against the readable set rather than the progress rows alone, so
   * a Chapter the reader finished before it was unpublished or removed stops
   * counting towards completion.
   *
   * @param userId - The reader.
   * @param storyId - The Story.
   * @param chapters - The readable Chapters.
   * @returns How many have been finished.
   */
  private async countReadChapters(
    userId: string,
    storyId: string,
    chapters: StorytimeChapterEntity[],
  ): Promise<number> {
    if (chapters.length === 0) {
      return 0;
    }

    return this._chapterProgressRepository.count({
      where: {
        userId,
        storyId,
        status: ReaderChapterStatus.READ,
        chapterId: In(chapters.map(chapter => chapter.id)),
      },
    });
  }

  /**
   * Finds a reader's Story progress, creating it on first sight.
   *
   * @param userId - The reader.
   * @param storyId - The Story.
   * @returns The progress row.
   */
  private async findOrCreateStoryProgress(
    userId: string,
    storyId: string,
  ): Promise<StorytimeUserStoryProgressEntity> {
    const existing = await this._storyProgressRepository.findOne({
      where: { userId, storyId },
    });

    if (existing) {
      return existing;
    }

    return this._storyProgressRepository.create({ userId, storyId });
  }

  /**
   * Finds a reader's Chapter progress, creating it on first sight.
   *
   * @param userId - The reader.
   * @param storyId - The Story the Chapter belongs to.
   * @param chapterId - The Chapter.
   * @returns The progress row.
   */
  private async findOrCreateChapterProgress(
    userId: string,
    storyId: string,
    chapterId: string,
  ): Promise<StorytimeUserChapterProgressEntity> {
    const existing = await this._chapterProgressRepository.findOne({
      where: { userId, chapterId },
    });

    if (existing) {
      return existing;
    }

    return this._chapterProgressRepository.create({
      userId,
      storyId,
      chapterId,
    });
  }
}
