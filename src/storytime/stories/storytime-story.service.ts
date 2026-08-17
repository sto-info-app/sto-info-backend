import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { LimitService } from '../../access-control/limit.service';
import { StorytimeCollaboratorAccessService } from '../collaboration/storytime-collaborator-access.service';
import { StoryCapability } from '../collaboration/storytime-story-capability.enum';
import { STORYTIME_LANGUAGE_CODES } from '../constants/storytime-language.constants';
import { STORYTIME_LIMITS } from '../constants/storytime-limits.constants';
import { StorytimeMarkdownService } from '../content/storytime-markdown.service';
import { StoryStatus } from '../enums/story-status.enum';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeVisibility } from '../enums/storytime-visibility.enum';
import { StorytimeOrderingService } from '../shared/storytime-ordering.service';
import { StorytimeSlugService } from '../shared/storytime-slug.service';
import { CreateStoryDto } from './dto/create-story.dto';
import { StoryQueryDto, StorySort } from './dto/story-query.dto';
import { UpdateStoryDto } from './dto/update-story.dto';
import { StorytimeStoryEntity } from './entities/storytime-story.entity';

/** Stories per page when a caller does not ask for a specific size. */
const DEFAULT_PAGE_SIZE = 12;

/**
 * Statuses a Story can hold and still be reachable by the public.
 */
const PUBLICLY_READABLE_STATUSES = [StoryStatus.PUBLISHED];

/**
 * Visibilities that allow a published Story to be opened by anyone holding a
 * link. `PRIVATE` is excluded: it is readable only by the owner.
 */
const PUBLICLY_READABLE_VISIBILITIES = [
  StorytimeVisibility.PUBLIC,
  StorytimeVisibility.UNLISTED,
];

/**
 * Creating, editing and publishing Stories.
 *
 * Every mutation re-reads the Story from the database and checks ownership
 * against it. Identifiers supplied by a client are never trusted to imply
 * access, because a request can name any Story it likes.
 */
@Injectable()
export class StorytimeStoryService {
  private readonly _logger = new Logger(StorytimeStoryService.name);

  /**
   * Creates an instance of StorytimeStoryService.
   *
   * @param _storyRepository - Repository of Stories.
   * @param _slugService - Produces slugs and remembers retired ones.
   * @param _orderingService - Calculates positions within the owner's collection.
   * @param _markdownService - Renders the Story description.
   * @param _limitService - Resolves how many Stories this user may own.
   * @param _collaboratorAccessService - Decides what a collaborator may do.
   */
  constructor(
    @InjectRepository(StorytimeStoryEntity)
    private readonly _storyRepository: Repository<StorytimeStoryEntity>,
    private readonly _slugService: StorytimeSlugService,
    private readonly _orderingService: StorytimeOrderingService,
    private readonly _markdownService: StorytimeMarkdownService,
    private readonly _limitService: LimitService,
    private readonly _collaboratorAccessService: StorytimeCollaboratorAccessService,
  ) {}

  /**
   * Creates a Story owned by the calling user.
   *
   * @param dto - The Story to create.
   * @param ownerUserId - The creator.
   * @returns The created Story.
   * @throws ForbiddenException when the user is at their Story limit.
   * @throws BadRequestException when the language is not offered.
   */
  async create(
    dto: CreateStoryDto,
    ownerUserId: string,
  ): Promise<StorytimeStoryEntity> {
    await this.assertWithinStoryLimit(ownerUserId);
    this.assertLanguageOffered(dto.languageCode);

    const slug = await this._slugService.generateUniqueSlug({
      desiredSlug: dto.slug,
      title: dto.title,
      targetType: StorytimeTargetType.STORY,
      isTakenByLiveEntity: candidate => this.isSlugTaken(candidate),
    });

    const rendered = this._markdownService.render(dto.description);

    const story = this._storyRepository.create({
      ...dto,
      slug,
      ownerUserId,
      descriptionHtml: dto.description ? rendered.html : null,
      ownerOrderIndex: await this.nextOrderIndex(ownerUserId),
      createdByUserId: ownerUserId,
      updatedByUserId: ownerUserId,
    });

    const saved = await this._storyRepository.save(story);

    this._logger.log(`Story '${saved.slug}' created by ${ownerUserId}`);

    return saved;
  }

  /**
   * Updates a Story the caller owns.
   *
   * @param storyId - The Story to update.
   * @param dto - The changes to apply.
   * @param actingUserId - The caller.
   * @returns The updated Story.
   * @throws NotFoundException when the Story does not exist.
   * @throws ForbiddenException when the caller does not own it.
   * @throws ConflictException when the supplied version is stale.
   */
  async update(
    storyId: string,
    dto: UpdateStoryDto,
    actingUserId: string,
  ): Promise<StorytimeStoryEntity> {
    const story = await this.findEditableOrFail(
      storyId,
      actingUserId,
      StoryCapability.EDIT_STORY,
    );
    this.assertVersionMatches(story, dto.version);

    if (dto.languageCode !== undefined) {
      this.assertLanguageOffered(dto.languageCode);
    }

    const previousSlug = story.slug;

    if (dto.title !== undefined || dto.slug !== undefined) {
      story.slug = await this._slugService.generateUniqueSlug({
        desiredSlug: dto.slug,
        title: dto.title ?? story.title,
        targetType: StorytimeTargetType.STORY,
        isTakenByLiveEntity: candidate => this.isSlugTaken(candidate, storyId),
      });
    }

    this.applyChanges(story, dto);

    if (dto.description !== undefined) {
      // Regenerated on every content change, so the cached HTML can never
      // describe an older version of the source.
      story.descriptionHtml = dto.description
        ? this._markdownService.render(dto.description).html
        : null;
    }

    story.updatedByUserId = actingUserId;
    story.version += 1;

    const saved = await this._storyRepository.save(story);

    await this._slugService.recordRetiredSlug(
      StorytimeTargetType.STORY,
      saved.id,
      previousSlug,
      saved.slug,
    );

    return saved;
  }

  /**
   * Finds a Story the caller owns, for editing.
   *
   * @param storyId - The Story to find.
   * @param actingUserId - The caller.
   * @returns The Story.
   * @throws NotFoundException when it does not exist.
   * @throws ForbiddenException when the caller does not own it.
   */
  async findOwnedOrFail(
    storyId: string,
    actingUserId: string,
  ): Promise<StorytimeStoryEntity> {
    const story = await this.findOrFail(storyId);

    if (story.ownerUserId !== actingUserId) {
      // Deliberately a 403 rather than a 404. The Story's existence is not a
      // secret — its slug may be public — so pretending otherwise would only
      // confuse a creator who mistyped an identifier.
      throw new ForbiddenException('You do not own this Story');
    }

    return story;
  }

  /**
   * Retrieves a Story the caller may act on in a particular way.
   *
   * The owner may do anything. Anybody else needs an accepted collaboration
   * granting that specific capability — an invitation nobody has answered, one
   * that was declined, or one since revoked all count for nothing.
   *
   * Publishing has no capability and so cannot be reached through here: only
   * the owner may publish, which is what {@link findOwnedOrFail} is for.
   *
   * @param storyId - The Story.
   * @param actingUserId - The caller.
   * @param capability - What they are trying to do.
   * @returns The Story.
   * @throws NotFoundException when the Story does not exist.
   * @throws ForbiddenException when they may not do this to it.
   */
  async findEditableOrFail(
    storyId: string,
    actingUserId: string,
    capability: StoryCapability,
  ): Promise<StorytimeStoryEntity> {
    const story = await this.findOrFail(storyId);

    if (story.ownerUserId === actingUserId) {
      return story;
    }

    const permitted = await this._collaboratorAccessService.hasCapability(
      storyId,
      actingUserId,
      capability,
    );

    if (!permitted) {
      throw new ForbiddenException(
        'You do not have permission to do that to this Story',
      );
    }

    return story;
  }

  /**
   * Retrieves a Story the caller has any working access to.
   *
   * Deliberately broader than a single capability. A collaborator invited only
   * to write Chapters still has to open the Story to reach them, so refusing
   * them the Story itself would leave them holding a key to a door they cannot
   * walk to.
   *
   * @param storyId - The Story.
   * @param actingUserId - The caller.
   * @returns The Story.
   * @throws NotFoundException when the Story does not exist.
   * @throws ForbiddenException when they have no access to it at all.
   */
  async findAccessibleOrFail(
    storyId: string,
    actingUserId: string,
  ): Promise<StorytimeStoryEntity> {
    const story = await this.findOrFail(storyId);

    if (story.ownerUserId === actingUserId) {
      return story;
    }

    const collaboration = await this._collaboratorAccessService.findAccepted(
      storyId,
      actingUserId,
    );

    if (!collaboration) {
      throw new ForbiddenException('You do not have access to this Story');
    }

    return story;
  }

  /**
   * Loads a Story, or fails.
   *
   * @param storyId - The Story.
   * @returns The Story.
   * @throws NotFoundException when it does not exist.
   */
  private async findOrFail(storyId: string): Promise<StorytimeStoryEntity> {
    const story = await this._storyRepository.findOne({
      where: { id: storyId },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    return story;
  }

  /**
   * Lists the Stories a user owns, in their chosen order.
   *
   * @param ownerUserId - The owner.
   * @returns The owner's Stories.
   */
  findOwnedByUser(ownerUserId: string): Promise<StorytimeStoryEntity[]> {
    return this._storyRepository.find({
      where: { ownerUserId },
      order: { ownerOrderIndex: 'ASC' },
    });
  }

  /**
   * Finds a Story by slug for public reading.
   *
   * Removed and unpublished Stories are not returned, so a direct URL cannot
   * be used to reach content that is not meant to be public.
   *
   * @param slug - The Story slug.
   * @returns The Story, or null when nothing public matches.
   */
  async findPublicBySlug(slug: string): Promise<StorytimeStoryEntity | null> {
    const story = await this._storyRepository.findOne({ where: { slug } });

    this.assertNotRemoved(story);

    if (!story || !this.isPubliclyReadable(story)) {
      return null;
    }

    return story;
  }

  /**
   * Announces a removal at a URL that would otherwise have worked.
   *
   * A reader who followed a link deserves to know the Story was taken down
   * rather than being told it never existed, so this answers 410 rather than
   * 404 — and a link shared before the removal keeps meaning something.
   *
   * Only for Stories that were public to begin with. Saying "removed" about a
   * draft or a private Story would let somebody probing slugs learn it exists,
   * which is the one thing "not found" is protecting.
   *
   * @param story - The Story found at that address, if any.
   * @throws GoneException when a published, public Story has been removed.
   */
  private assertNotRemoved(story: StorytimeStoryEntity | null): void {
    const wasPublic =
      story &&
      PUBLICLY_READABLE_STATUSES.includes(story.status) &&
      PUBLICLY_READABLE_VISIBILITIES.includes(story.visibility);

    if (
      wasPublic &&
      story.moderationStatus === StorytimeModerationStatus.REMOVED
    ) {
      throw new GoneException(
        'This Story has been removed by an administrator.',
      );
    }
  }

  /**
   * Finds several Stories by identifier for public reading.
   *
   * Unlisted Stories are included, unlike the browsable listing: a reader who
   * has one in their library reached it by link already, and hiding it from
   * their own history would lose it for them.
   *
   * @param storyIds - The Stories to find.
   * @returns The readable Stories among them.
   */
  async findPublicByIds(storyIds: string[]): Promise<StorytimeStoryEntity[]> {
    if (storyIds.length === 0) {
      return [];
    }

    const stories = await this._storyRepository.find({
      where: { id: In(storyIds) },
    });

    return stories.filter(story => this.isPubliclyReadable(story));
  }

  /**
   * Lists publicly readable Stories, newest first.
   *
   * `UNLISTED` Stories are excluded here even though they are readable by
   * anyone holding the link. That is the entire difference between unlisted and
   * public: it must not be possible to discover one by browsing.
   *
   * @param query - Paging and filtering options.
   * @returns The page of Stories and the total available.
   */
  async findPublicPaginated(query: StoryQueryDto): Promise<{
    items: StorytimeStoryEntity[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const builder = this._storyRepository
      .createQueryBuilder('story')
      .where('story.status = :status', { status: StoryStatus.PUBLISHED })
      .andWhere('story.visibility = :visibility', {
        visibility: StorytimeVisibility.PUBLIC,
      })
      .andWhere('story.moderationStatus = :moderationStatus', {
        moderationStatus: StorytimeModerationStatus.ACTIVE,
      });

    if (query.contentRating) {
      builder.andWhere('story.contentRating = :contentRating', {
        contentRating: query.contentRating,
      });
    }

    if (query.languageCode) {
      builder.andWhere('story.languageCode = :languageCode', {
        languageCode: query.languageCode,
      });
    }

    if (query.completionState) {
      builder.andWhere('story.completionState = :completionState', {
        completionState: query.completionState,
      });
    }

    if (query.ownerUserId) {
      builder.andWhere('story.ownerUserId = :ownerUserId', {
        ownerUserId: query.ownerUserId,
      });
    }

    const [items, total] = await builder
      .orderBy(
        query.sort === StorySort.RECENTLY_UPDATED
          ? 'story.updatedAt'
          : 'story.publishedAt',
        'DESC',
      )
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return { items, total, page, pageSize };
  }

  /**
   * Finds the Story a retired slug used to belong to.
   *
   * @param slug - The slug from the incoming URL.
   * @returns The Story, or null when the slug was never used or the Story is
   *   no longer public.
   */
  async findPublicByRetiredSlug(
    slug: string,
  ): Promise<StorytimeStoryEntity | null> {
    const storyId = await this._slugService.findByRetiredSlug(
      StorytimeTargetType.STORY,
      slug,
    );

    if (!storyId) {
      return null;
    }

    const story = await this._storyRepository.findOne({
      where: { id: storyId },
    });

    if (!story || !this.isPubliclyReadable(story)) {
      return null;
    }

    return story;
  }

  /**
   * Publishes a Story the caller owns.
   *
   * @param storyId - The Story to publish.
   * @param actingUserId - The caller.
   * @returns The published Story.
   * @throws BadRequestException when the Story is not ready to publish.
   */
  /**
   * Records that the owner has accepted the content policy for a Story.
   *
   * Kept as its own act rather than a flag on publishing, because agreeing
   * that a Story meets the policy is a statement the creator makes about their
   * own work — the date it was made is worth having, and burying it in a
   * publish request would lose it.
   *
   * Accepting again does not move the date. What matters is when they first
   * agreed, and a creator who clicks twice has not agreed twice.
   *
   * @param storyId - The Story.
   * @param actingUserId - The owner.
   * @returns The Story, with its acceptance recorded.
   */
  async acceptContentPolicy(
    storyId: string,
    actingUserId: string,
  ): Promise<StorytimeStoryEntity> {
    const story = await this.findOwnedOrFail(storyId, actingUserId);

    if (story.contentPolicyAcceptedAt) {
      return story;
    }

    story.contentPolicyAcceptedAt = new Date();
    story.updatedByUserId = actingUserId;

    this._logger.log(
      `Content policy accepted for Story '${story.slug}' by ${actingUserId}`,
    );

    return this._storyRepository.save(story);
  }

  async publish(
    storyId: string,
    actingUserId: string,
  ): Promise<StorytimeStoryEntity> {
    const story = await this.findOwnedOrFail(storyId, actingUserId);

    this.assertPublishable(story);

    story.status = StoryStatus.PUBLISHED;
    story.publishedAt = story.publishedAt ?? new Date();
    story.updatedByUserId = actingUserId;
    story.version += 1;

    this._logger.log(`Story '${story.slug}' published by ${actingUserId}`);

    return this._storyRepository.save(story);
  }

  /**
   * Withdraws a Story from publication.
   *
   * `publishedAt` is left alone so the original publication date survives a
   * temporary withdrawal.
   *
   * @param storyId - The Story to unpublish.
   * @param actingUserId - The caller.
   * @returns The unpublished Story.
   */
  async unpublish(
    storyId: string,
    actingUserId: string,
  ): Promise<StorytimeStoryEntity> {
    const story = await this.findOwnedOrFail(storyId, actingUserId);

    story.status = StoryStatus.UNPUBLISHED;
    story.updatedByUserId = actingUserId;
    story.version += 1;

    return this._storyRepository.save(story);
  }

  /**
   * Archives a Story, retiring it without deleting it.
   *
   * @param storyId - The Story to archive.
   * @param actingUserId - The caller.
   * @returns The archived Story.
   */
  async archive(
    storyId: string,
    actingUserId: string,
  ): Promise<StorytimeStoryEntity> {
    const story = await this.findOwnedOrFail(storyId, actingUserId);

    story.status = StoryStatus.ARCHIVED;
    story.updatedByUserId = actingUserId;
    story.version += 1;

    return this._storyRepository.save(story);
  }

  /**
   * Soft-deletes a Story.
   *
   * The row is retained so its slug stays reserved and any moderation history
   * remains reviewable.
   *
   * @param storyId - The Story to delete.
   * @param actingUserId - The caller.
   */
  async remove(storyId: string, actingUserId: string): Promise<void> {
    const story = await this.findOwnedOrFail(storyId, actingUserId);

    story.deletedByUserId = actingUserId;
    await this._storyRepository.save(story);
    await this._storyRepository.softDelete(storyId);

    this._logger.log(`Story '${story.slug}' deleted by ${actingUserId}`);
  }

  /**
   * Reorders the caller's Stories into the sequence given.
   *
   * The whole collection is renumbered rather than individual positions
   * adjusted, because the client sends the order it wants and renumbering is
   * the only way to guarantee the result matches it exactly.
   *
   * @param orderedStoryIds - The Story identifiers in their intended order.
   * @param actingUserId - The caller.
   * @returns The reordered Stories.
   * @throws BadRequestException when the list does not match the user's Stories.
   */
  async reorder(
    orderedStoryIds: string[],
    actingUserId: string,
  ): Promise<StorytimeStoryEntity[]> {
    const stories = await this.findOwnedByUser(actingUserId);
    const ownedIds = new Set(stories.map(story => story.id));

    if (
      orderedStoryIds.length !== stories.length ||
      !orderedStoryIds.every(id => ownedIds.has(id))
    ) {
      throw new BadRequestException(
        'The supplied order must list every Story you own exactly once',
      );
    }

    if (new Set(orderedStoryIds).size !== orderedStoryIds.length) {
      throw new BadRequestException('The supplied order contains duplicates');
    }

    const placements = this._orderingService.renumber(orderedStoryIds);
    const byId = new Map(stories.map(story => [story.id, story]));

    for (const placement of placements) {
      const story = byId.get(placement.id) as StorytimeStoryEntity;
      story.ownerOrderIndex = placement.orderIndex;
      story.updatedByUserId = actingUserId;
    }

    return this._storyRepository.save([...byId.values()]);
  }

  /**
   * Determines whether a Story may be reached by the public.
   *
   * @param story - The Story to test.
   * @returns True when anyone holding the URL may read it.
   */
  private isPubliclyReadable(story: StorytimeStoryEntity): boolean {
    return (
      PUBLICLY_READABLE_STATUSES.includes(story.status) &&
      PUBLICLY_READABLE_VISIBILITIES.includes(story.visibility) &&
      story.moderationStatus === StorytimeModerationStatus.ACTIVE
    );
  }

  /**
   * Requires that a Story satisfies the publication checklist.
   *
   * @param story - The Story to check.
   * @throws BadRequestException naming what is missing.
   */
  private assertPublishable(story: StorytimeStoryEntity): void {
    // A removed Story must not be publishable, or a creator could republish
    // their way out of a moderation decision.
    if (story.moderationStatus !== StorytimeModerationStatus.ACTIVE) {
      throw new ForbiddenException(
        'This Story has been removed by an administrator and cannot be published',
      );
    }

    const problems: string[] = [];

    if (!story.shortDescription) {
      problems.push('a short description is required');
    }

    if (story.publishedChapterCount < 1) {
      problems.push('at least one published Chapter is required');
    }

    if (!story.contentPolicyAcceptedAt) {
      problems.push('the content policy must be accepted');
    }

    if (problems.length > 0) {
      throw new BadRequestException(
        `This Story is not ready to publish: ${problems.join('; ')}`,
      );
    }
  }

  /**
   * Requires that the caller is not already at their Story limit.
   *
   * @param ownerUserId - The creator.
   * @throws ForbiddenException when the limit is reached.
   */
  private async assertWithinStoryLimit(ownerUserId: string): Promise<void> {
    const currentCount = await this._storyRepository.count({
      where: { ownerUserId },
    });

    await this._limitService.assertWithinLimit(
      ownerUserId,
      STORYTIME_LIMITS.MAX_STORIES_PER_USER.key,
      STORYTIME_LIMITS.MAX_STORIES_PER_USER.defaultValue,
      currentCount,
    );
  }

  /**
   * Requires that a language is one Storytime offers.
   *
   * Checked here as well as in the DTO because the curated list is the same
   * one the client is served, and a mismatch would otherwise produce a Story
   * whose language nothing can filter by.
   *
   * @param languageCode - The language to check.
   * @throws BadRequestException when the language is not offered.
   */
  private assertLanguageOffered(languageCode: string | undefined): void {
    if (languageCode === undefined) {
      return;
    }

    if (!STORYTIME_LANGUAGE_CODES.includes(languageCode)) {
      throw new BadRequestException(`Unsupported language '${languageCode}'`);
    }
  }

  /**
   * Requires that the caller's view of the Story is current.
   *
   * @param story - The stored Story.
   * @param version - The version the caller last saw.
   * @throws ConflictException when the caller is working from a stale copy.
   */
  private assertVersionMatches(
    story: StorytimeStoryEntity,
    version: number | undefined,
  ): void {
    if (version === undefined || version === story.version) {
      return;
    }

    throw new ConflictException(
      'This Story has changed since you loaded it. Reload and try again.',
    );
  }

  /**
   * Copies the supplied changes onto a Story.
   *
   * Slug and description are handled by the caller, which has to render and
   * record history alongside them.
   *
   * @param story - The Story to change.
   * @param dto - The changes.
   */
  private applyChanges(story: StorytimeStoryEntity, dto: UpdateStoryDto): void {
    const { slug, version, ...changes } = dto;
    void slug;
    void version;

    Object.assign(story, changes);
  }

  /**
   * Calculates the position for a new Story in an owner's collection.
   *
   * @param ownerUserId - The owner.
   * @returns The order index to use.
   */
  private async nextOrderIndex(ownerUserId: string): Promise<number> {
    const last = await this._storyRepository.findOne({
      where: { ownerUserId },
      order: { ownerOrderIndex: 'DESC' },
    });

    return this._orderingService.nextIndex(last?.ownerOrderIndex ?? null);
  }

  /**
   * Determines whether a slug is already used by a live Story.
   *
   * @param slug - The candidate slug.
   * @param excludeStoryId - A Story allowed to keep its own slug.
   * @returns True when another Story holds the slug.
   */
  private async isSlugTaken(
    slug: string,
    excludeStoryId?: string,
  ): Promise<boolean> {
    const existing = await this._storyRepository.findOne({
      where: excludeStoryId
        ? { slug, id: Not(excludeStoryId), deletedAt: IsNull() }
        : { slug, deletedAt: IsNull() },
    });

    return existing !== null;
  }
}
