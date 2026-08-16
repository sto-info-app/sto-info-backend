import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { LimitService } from '../../access-control/limit.service';
import { STORYTIME_LANGUAGE_CODES } from '../constants/storytime-language.constants';
import { STORYTIME_LIMITS } from '../constants/storytime-limits.constants';
import { StorytimeMarkdownService } from '../content/storytime-markdown.service';
import { ChapterStatus } from '../enums/chapter-status.enum';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeProgressService } from '../progress/storytime-progress.service';
import { StorytimeOrderingService } from '../shared/storytime-ordering.service';
import { StorytimeSlugService } from '../shared/storytime-slug.service';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { CreateChapterDto } from './dto/create-chapter.dto';
import { UpdateChapterDto } from './dto/update-chapter.dto';
import { StorytimeChapterEntity } from './entities/storytime-chapter.entity';

/**
 * The statuses a Chapter must hold to be readable by the public, assuming its
 * Story is readable too.
 */
const PUBLICLY_READABLE_STATUSES = [ChapterStatus.PUBLISHED];

/**
 * Neighbouring Chapters, for previous/next navigation.
 */
export interface ChapterNeighbours {
  previous: StorytimeChapterEntity | null;
  next: StorytimeChapterEntity | null;
}

/**
 * Creating, editing, ordering and publishing Chapters.
 *
 * Access is decided by the Story: a caller may act on a Chapter exactly when
 * they may act on the Story that owns it. That check is delegated rather than
 * duplicated, so the two can never disagree about who owns what.
 */
@Injectable()
export class StorytimeChapterService {
  private readonly _logger = new Logger(StorytimeChapterService.name);

  /**
   * Creates an instance of StorytimeChapterService.
   *
   * @param _chapterRepository - Repository of Chapters.
   * @param _storyRepository - Repository of Stories, for the published count.
   * @param _storyService - Decides who may act on the owning Story.
   * @param _slugService - Produces slugs and remembers retired ones.
   * @param _orderingService - Calculates positions within the Story.
   * @param _markdownService - Renders Chapter content.
   * @param _limitService - Resolves how many Chapters a Story may hold.
   * @param _progressService - Reopens readers who had finished the Story.
   * @param _dataSource - Runs publication changes in a transaction.
   */
  constructor(
    @InjectRepository(StorytimeChapterEntity)
    private readonly _chapterRepository: Repository<StorytimeChapterEntity>,
    @InjectRepository(StorytimeStoryEntity)
    private readonly _storyRepository: Repository<StorytimeStoryEntity>,
    private readonly _storyService: StorytimeStoryService,
    private readonly _slugService: StorytimeSlugService,
    private readonly _orderingService: StorytimeOrderingService,
    private readonly _markdownService: StorytimeMarkdownService,
    private readonly _limitService: LimitService,
    private readonly _progressService: StorytimeProgressService,
    private readonly _dataSource: DataSource,
  ) {}

  /**
   * Creates a Chapter in a Story the caller owns.
   *
   * @param storyId - The Story to add to.
   * @param dto - The Chapter to create.
   * @param actingUserId - The caller.
   * @returns The created Chapter.
   */
  async create(
    storyId: string,
    dto: CreateChapterDto,
    actingUserId: string,
  ): Promise<StorytimeChapterEntity> {
    await this._storyService.findOwnedOrFail(storyId, actingUserId);
    await this.assertWithinChapterLimit(storyId, actingUserId);
    this.assertLanguageOffered(dto.languageCode);

    const slug = await this._slugService.generateUniqueSlug({
      desiredSlug: dto.slug,
      title: dto.title,
      targetType: StorytimeTargetType.CHAPTER,
      storyId,
      isTakenByLiveEntity: candidate => this.isSlugTaken(storyId, candidate),
    });

    const rendered = this._markdownService.render(dto.contentSource ?? '');

    const chapter = this._chapterRepository.create({
      ...dto,
      storyId,
      slug,
      contentSource: dto.contentSource ?? '',
      contentHtml: rendered.html,
      contentSchemaVersion: rendered.schemaVersion,
      wordCount: rendered.wordCount,
      estimatedReadingMinutes: rendered.estimatedReadingMinutes,
      orderIndex: await this.nextOrderIndex(storyId),
      createdByUserId: actingUserId,
      updatedByUserId: actingUserId,
    });

    const saved = await this._chapterRepository.save(chapter);

    this._logger.log(
      `Chapter '${saved.slug}' created in Story ${storyId} by ${actingUserId}`,
    );

    return saved;
  }

  /**
   * Updates a Chapter in a Story the caller owns.
   *
   * @param chapterId - The Chapter to update.
   * @param dto - The changes to apply.
   * @param actingUserId - The caller.
   * @returns The updated Chapter.
   * @throws ConflictException when the supplied version is stale.
   */
  async update(
    chapterId: string,
    dto: UpdateChapterDto,
    actingUserId: string,
  ): Promise<StorytimeChapterEntity> {
    const chapter = await this.findEditableOrFail(chapterId, actingUserId);
    this.assertVersionMatches(chapter, dto.version);

    if (dto.languageCode !== undefined) {
      this.assertLanguageOffered(dto.languageCode);
    }

    const previousSlug = chapter.slug;

    if (dto.title !== undefined || dto.slug !== undefined) {
      chapter.slug = await this._slugService.generateUniqueSlug({
        desiredSlug: dto.slug,
        title: dto.title ?? chapter.title,
        targetType: StorytimeTargetType.CHAPTER,
        storyId: chapter.storyId,
        isTakenByLiveEntity: candidate =>
          this.isSlugTaken(chapter.storyId, candidate, chapterId),
      });
    }

    this.applyChanges(chapter, dto);

    if (dto.contentSource !== undefined) {
      // Regenerated on every content change, so the cached HTML and the word
      // count can never describe an older version of the source.
      const rendered = this._markdownService.render(dto.contentSource);
      chapter.contentHtml = rendered.html;
      chapter.contentSchemaVersion = rendered.schemaVersion;
      chapter.wordCount = rendered.wordCount;
      chapter.estimatedReadingMinutes = rendered.estimatedReadingMinutes;
    }

    chapter.updatedByUserId = actingUserId;
    chapter.version += 1;

    const saved = await this._chapterRepository.save(chapter);

    await this._slugService.recordRetiredSlug(
      StorytimeTargetType.CHAPTER,
      saved.id,
      previousSlug,
      saved.slug,
      saved.storyId,
    );

    await this.touchStoryContentDate(saved.storyId);

    return saved;
  }

  /**
   * Lists the Chapters of a Story the caller owns, in reading order.
   *
   * @param storyId - The Story.
   * @param actingUserId - The caller.
   * @returns Every Chapter, whatever its state.
   */
  async findForOwner(
    storyId: string,
    actingUserId: string,
  ): Promise<StorytimeChapterEntity[]> {
    await this._storyService.findOwnedOrFail(storyId, actingUserId);

    return this._chapterRepository.find({
      where: { storyId },
      order: { orderIndex: 'ASC' },
    });
  }

  /**
   * Finds a Chapter the caller may edit.
   *
   * @param chapterId - The Chapter to find.
   * @param actingUserId - The caller.
   * @returns The Chapter.
   * @throws NotFoundException when it does not exist.
   */
  async findEditableOrFail(
    chapterId: string,
    actingUserId: string,
  ): Promise<StorytimeChapterEntity> {
    const chapter = await this._chapterRepository.findOne({
      where: { id: chapterId },
    });

    if (!chapter) {
      throw new NotFoundException('Chapter not found');
    }

    // Ownership is a property of the Story, so it is asked of the Story rather
    // than re-derived here.
    await this._storyService.findOwnedOrFail(chapter.storyId, actingUserId);

    return chapter;
  }

  /**
   * Lists the publicly readable Chapters of a Story, in reading order.
   *
   * @param storyId - The Story.
   * @returns The readable Chapters.
   */
  findPublicByStory(storyId: string): Promise<StorytimeChapterEntity[]> {
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
   * Finds a publicly readable Chapter by its slug within a Story.
   *
   * @param storyId - The Story.
   * @param slug - The Chapter slug.
   * @returns The Chapter, or null when nothing readable matches.
   */
  async findPublicBySlug(
    storyId: string,
    slug: string,
  ): Promise<StorytimeChapterEntity | null> {
    const chapter = await this._chapterRepository.findOne({
      where: { storyId, slug },
    });

    if (!chapter || !this.isPubliclyReadable(chapter)) {
      return null;
    }

    return chapter;
  }

  /**
   * Finds the Chapters either side of one, for previous/next navigation.
   *
   * Only publicly readable Chapters are considered, so navigation steps over a
   * draft, a scheduled instalment or one an administrator has removed rather
   * than leading a reader to a dead end.
   *
   * @param chapter - The Chapter being read.
   * @returns The previous and next readable Chapters.
   */
  async findNeighbours(
    chapter: StorytimeChapterEntity,
  ): Promise<ChapterNeighbours> {
    const readable = await this.findPublicByStory(chapter.storyId);
    const position = readable.findIndex(entry => entry.id === chapter.id);

    if (position === -1) {
      return { previous: null, next: null };
    }

    return {
      previous: readable[position - 1] ?? null,
      next: readable[position + 1] ?? null,
    };
  }

  /**
   * Publishes a Chapter.
   *
   * The Story's published Chapter count is maintained in the same transaction,
   * because it is what decides whether the Story itself may be published. A
   * count that drifted from reality would either block a legitimate publish or
   * allow an empty Story to go out.
   *
   * @param chapterId - The Chapter to publish.
   * @param actingUserId - The caller.
   * @returns The published Chapter.
   */
  async publish(
    chapterId: string,
    actingUserId: string,
  ): Promise<StorytimeChapterEntity> {
    const chapter = await this.findEditableOrFail(chapterId, actingUserId);

    this.assertPublishable(chapter);

    if (chapter.status === ChapterStatus.PUBLISHED) {
      return chapter;
    }

    chapter.status = ChapterStatus.PUBLISHED;
    chapter.publishedAt = chapter.publishedAt ?? new Date();
    chapter.scheduledPublishAt = null;
    chapter.updatedByUserId = actingUserId;
    chapter.version += 1;

    const saved = await this.saveWithStoryCount(chapter);

    // Reader bookkeeping must never fail a creator's publish. The Chapter is
    // already saved and visible; if this does not run, the only cost is that
    // readers who had finished the Story keep their completed status, and a
    // retry would find the Chapter published and skip this altogether.
    try {
      await this._progressService.reopenCompletedReaders(saved.storyId);
    } catch (error) {
      this._logger.error(
        `Failed to reopen completed readers of Story ${saved.storyId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    this._logger.log(`Chapter '${saved.slug}' published by ${actingUserId}`);

    return saved;
  }

  /**
   * Withdraws a Chapter from publication.
   *
   * @param chapterId - The Chapter to unpublish.
   * @param actingUserId - The caller.
   * @returns The unpublished Chapter.
   */
  async unpublish(
    chapterId: string,
    actingUserId: string,
  ): Promise<StorytimeChapterEntity> {
    const chapter = await this.findEditableOrFail(chapterId, actingUserId);

    if (chapter.status !== ChapterStatus.PUBLISHED) {
      return chapter;
    }

    chapter.status = ChapterStatus.UNPUBLISHED;
    chapter.updatedByUserId = actingUserId;
    chapter.version += 1;

    return this.saveWithStoryCount(chapter);
  }

  /**
   * Schedules a Chapter to publish automatically.
   *
   * @param chapterId - The Chapter to schedule.
   * @param publishAt - When it should publish. Stored in UTC.
   * @param actingUserId - The caller.
   * @returns The scheduled Chapter.
   * @throws BadRequestException when the time is in the past.
   */
  async schedule(
    chapterId: string,
    publishAt: Date,
    actingUserId: string,
  ): Promise<StorytimeChapterEntity> {
    const chapter = await this.findEditableOrFail(chapterId, actingUserId);

    this.assertPublishable(chapter);

    if (publishAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'A scheduled publication time must be in the future',
      );
    }

    chapter.status = ChapterStatus.SCHEDULED;
    chapter.scheduledPublishAt = publishAt;
    chapter.updatedByUserId = actingUserId;
    chapter.version += 1;

    return this._chapterRepository.save(chapter);
  }

  /**
   * Publishes every Chapter whose scheduled time has arrived.
   *
   * Run by the scheduler. Each Chapter is published on its own so one failure
   * cannot stop the rest of the queue going out.
   *
   * @param now - The moment to publish up to.
   * @returns How many Chapters were published.
   */
  async publishDueChapters(now: Date = new Date()): Promise<number> {
    const due = await this._chapterRepository
      .createQueryBuilder('chapter')
      .where('chapter.status = :status', { status: ChapterStatus.SCHEDULED })
      .andWhere('chapter."scheduledPublishAt" <= :now', { now })
      .andWhere('chapter."deletedAt" IS NULL')
      .getMany();

    let published = 0;

    for (const chapter of due) {
      try {
        chapter.status = ChapterStatus.PUBLISHED;
        chapter.publishedAt = chapter.publishedAt ?? now;
        chapter.scheduledPublishAt = null;
        chapter.version += 1;

        await this.saveWithStoryCount(chapter);
        await this._progressService.reopenCompletedReaders(chapter.storyId);
        published += 1;
      } catch (error) {
        // One Chapter failing must not strand the rest of the queue, so the
        // failure is recorded and the run continues.
        this._logger.error(
          `Scheduled publication failed for Chapter ${chapter.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    if (published > 0) {
      this._logger.log(`Published ${published} scheduled Chapter(s)`);
    }

    return published;
  }

  /**
   * Reorders the Chapters of a Story into the sequence given.
   *
   * @param storyId - The Story.
   * @param orderedChapterIds - Every Chapter, in the order they should appear.
   * @param actingUserId - The caller.
   * @returns The reordered Chapters.
   * @throws BadRequestException when the list does not match the Story's Chapters.
   */
  async reorder(
    storyId: string,
    orderedChapterIds: string[],
    actingUserId: string,
  ): Promise<StorytimeChapterEntity[]> {
    const chapters = await this.findForOwner(storyId, actingUserId);
    const knownIds = new Set(chapters.map(chapter => chapter.id));

    if (
      orderedChapterIds.length !== chapters.length ||
      !orderedChapterIds.every(id => knownIds.has(id))
    ) {
      throw new BadRequestException(
        'The supplied order must list every Chapter in this Story exactly once',
      );
    }

    if (new Set(orderedChapterIds).size !== orderedChapterIds.length) {
      throw new BadRequestException('The supplied order contains duplicates');
    }

    const placements = this._orderingService.renumber(orderedChapterIds);
    const byId = new Map(chapters.map(chapter => [chapter.id, chapter]));

    for (const placement of placements) {
      const chapter = byId.get(placement.id) as StorytimeChapterEntity;
      chapter.orderIndex = placement.orderIndex;
      chapter.updatedByUserId = actingUserId;
    }

    return this._chapterRepository.save([...byId.values()]);
  }

  /**
   * Soft-deletes a Chapter.
   *
   * @param chapterId - The Chapter to delete.
   * @param actingUserId - The caller.
   */
  async remove(chapterId: string, actingUserId: string): Promise<void> {
    const chapter = await this.findEditableOrFail(chapterId, actingUserId);
    const { storyId } = chapter;

    chapter.deletedByUserId = actingUserId;
    await this._chapterRepository.save(chapter);
    await this._chapterRepository.softDelete(chapterId);

    // Deleting a published Chapter changes what the Story contains, so the
    // count has to follow it down.
    await this.recalculateStoryChapterCount(storyId);

    this._logger.log(`Chapter '${chapter.slug}' deleted by ${actingUserId}`);
  }

  /**
   * Recounts a Story's published Chapters from the Chapters themselves.
   *
   * The count is a cache, and this is its reconciliation: anything that adds,
   * removes or hides a Chapter calls it rather than adjusting the number by
   * hand, so the cache can only ever be as wrong as the query that rebuilds it.
   *
   * @param storyId - The Story to recount.
   * @returns The recalculated count.
   */
  async recalculateStoryChapterCount(storyId: string): Promise<number> {
    const count = await this._chapterRepository.count({
      where: {
        storyId,
        status: ChapterStatus.PUBLISHED,
        moderationStatus: StorytimeModerationStatus.ACTIVE,
      },
    });

    await this._storyRepository.update(storyId, {
      publishedChapterCount: count,
      lastContentUpdateAt: new Date(),
    });

    return count;
  }

  /**
   * Saves a Chapter and refreshes its Story's published count together.
   *
   * @param chapter - The Chapter to save.
   * @returns The saved Chapter.
   */
  private async saveWithStoryCount(
    chapter: StorytimeChapterEntity,
  ): Promise<StorytimeChapterEntity> {
    return this._dataSource.transaction(async manager => {
      const saved = await manager.save(chapter);

      const count = await manager.count(StorytimeChapterEntity, {
        where: {
          storyId: chapter.storyId,
          status: ChapterStatus.PUBLISHED,
          moderationStatus: StorytimeModerationStatus.ACTIVE,
        },
      });

      await manager.update(StorytimeStoryEntity, chapter.storyId, {
        publishedChapterCount: count,
        lastContentUpdateAt: new Date(),
      });

      return saved;
    });
  }

  /**
   * Records that a Story's content changed, for "recently updated" discovery.
   *
   * @param storyId - The Story that changed.
   */
  private async touchStoryContentDate(storyId: string): Promise<void> {
    await this._storyRepository.update(storyId, {
      lastContentUpdateAt: new Date(),
    });
  }

  /**
   * Determines whether a Chapter may be read by the public.
   *
   * Says nothing about the Story: a readable Chapter in an unpublished Story
   * is still unreachable, and the caller checks that separately.
   *
   * @param chapter - The Chapter to test.
   * @returns True when the Chapter itself is readable.
   */
  private isPubliclyReadable(chapter: StorytimeChapterEntity): boolean {
    return (
      PUBLICLY_READABLE_STATUSES.includes(chapter.status) &&
      chapter.moderationStatus === StorytimeModerationStatus.ACTIVE
    );
  }

  /**
   * Requires that a Chapter is fit to publish.
   *
   * @param chapter - The Chapter to check.
   * @throws BadRequestException naming what is missing.
   */
  private assertPublishable(chapter: StorytimeChapterEntity): void {
    if (chapter.moderationStatus !== StorytimeModerationStatus.ACTIVE) {
      throw new BadRequestException(
        'This Chapter has been removed by an administrator and cannot be published',
      );
    }

    if (!chapter.contentSource.trim()) {
      throw new BadRequestException(
        'This Chapter is not ready to publish: it has no content',
      );
    }
  }

  /**
   * Requires that the Story is not already at its Chapter limit.
   *
   * @param storyId - The Story.
   * @param actingUserId - The owner, whose exemptions apply.
   */
  private async assertWithinChapterLimit(
    storyId: string,
    actingUserId: string,
  ): Promise<void> {
    const currentCount = await this._chapterRepository.count({
      where: { storyId },
    });

    await this._limitService.assertWithinLimit(
      actingUserId,
      STORYTIME_LIMITS.MAX_CHAPTERS_PER_STORY.key,
      STORYTIME_LIMITS.MAX_CHAPTERS_PER_STORY.defaultValue,
      currentCount,
    );
  }

  /**
   * Requires that a language is one Storytime offers.
   *
   * @param languageCode - The language to check, or null to inherit the Story.
   * @throws BadRequestException when the language is not offered.
   */
  private assertLanguageOffered(languageCode: string | null | undefined): void {
    if (languageCode === undefined || languageCode === null) {
      return;
    }

    if (!STORYTIME_LANGUAGE_CODES.includes(languageCode)) {
      throw new BadRequestException(`Unsupported language '${languageCode}'`);
    }
  }

  /**
   * Requires that the caller's view of the Chapter is current.
   *
   * @param chapter - The stored Chapter.
   * @param version - The version the caller last saw.
   * @throws ConflictException when the caller is working from a stale copy.
   */
  private assertVersionMatches(
    chapter: StorytimeChapterEntity,
    version: number | undefined,
  ): void {
    if (version === undefined || version === chapter.version) {
      return;
    }

    throw new ConflictException(
      'This Chapter has changed since you loaded it. Reload and try again.',
    );
  }

  /**
   * Copies the supplied changes onto a Chapter.
   *
   * Slug and content are handled by the caller, which has to render and record
   * slug history alongside them.
   *
   * @param chapter - The Chapter to change.
   * @param dto - The changes.
   */
  private applyChanges(
    chapter: StorytimeChapterEntity,
    dto: UpdateChapterDto,
  ): void {
    const { slug, version, contentSource, ...changes } = dto;
    void slug;
    void version;
    void contentSource;

    Object.assign(chapter, changes);

    if (dto.contentSource !== undefined) {
      chapter.contentSource = dto.contentSource;
    }
  }

  /**
   * Calculates the position for a new Chapter at the end of a Story.
   *
   * @param storyId - The Story.
   * @returns The order index to use.
   */
  private async nextOrderIndex(storyId: string): Promise<number> {
    const last = await this._chapterRepository.findOne({
      where: { storyId },
      order: { orderIndex: 'DESC' },
    });

    return this._orderingService.nextIndex(last?.orderIndex ?? null);
  }

  /**
   * Determines whether a slug is already used within the Story.
   *
   * @param storyId - The Story the slug is scoped to.
   * @param slug - The candidate slug.
   * @param excludeChapterId - A Chapter allowed to keep its own slug.
   * @returns True when another Chapter in the Story holds the slug.
   */
  private async isSlugTaken(
    storyId: string,
    slug: string,
    excludeChapterId?: string,
  ): Promise<boolean> {
    const existing = await this._chapterRepository.findOne({
      where: excludeChapterId
        ? { storyId, slug, id: Not(excludeChapterId), deletedAt: IsNull() }
        : { storyId, slug, deletedAt: IsNull() },
    });

    return existing !== null;
  }
}
