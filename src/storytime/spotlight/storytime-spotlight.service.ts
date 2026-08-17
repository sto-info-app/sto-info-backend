import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { NotificationSeverity } from '../../notification/enums/notification-severity.enum';
import { NotificationTarget } from '../../notification/enums/notification-target.enum';
import { NotificationService } from '../../notification/notification.service';
import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeArcService } from '../arcs/storytime-arc.service';
import { SpotlightEntityType } from '../enums/spotlight-entity-type.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeVisibility } from '../enums/storytime-visibility.enum';
import { StorytimeSlugService } from '../shared/storytime-slug.service';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import {
  CreateSpotlightDto,
  UpdateSpotlightDto,
} from './dto/create-spotlight.dto';
import { StorytimeSpotlightEntity } from './entities/storytime-spotlight.entity';

/**
 * A Spotlight entry together with the work it features.
 *
 * The work is resolved at read time and may be absent, which is the whole
 * point: an entry whose Story has since been removed carries a null rather
 * than a stale copy of what the Story used to be.
 */
export interface SpotlightWithTarget {
  /** The Spotlight entry. */
  entry: StorytimeSpotlightEntity;
  /** The featured Story, when a readable Story is featured. */
  story: StorytimeStoryEntity | null;
  /** The featured Arc, when a readable Arc is featured. */
  arc: StorytimeArcEntity | null;
}

/**
 * The little a Spotlight needs to know about the work it features.
 *
 * A Story and an Arc have nothing else in common from here, and naming just
 * these two fields keeps the Spotlight from quietly depending on the rest of
 * either.
 */
interface FeaturedWork {
  /** Who wrote or curated it. */
  ownerUserId: string;
  /** What it is called. */
  title: string;
}

/**
 * The Storytime Spotlight: editorial selections of Stories and Arcs.
 *
 * Two rules run through everything here. An entry never duplicates the work it
 * features, so what a reader sees is whatever the work is now. And an entry
 * only ever surfaces work that is publicly listed right now — a Story that has
 * been unpublished, made private, unlisted or removed disappears from the
 * Spotlight by itself, with nobody having to remember to withdraw it.
 */
@Injectable()
export class StorytimeSpotlightService {
  private readonly _logger = new Logger(StorytimeSpotlightService.name);

  /**
   * Creates an instance of StorytimeSpotlightService.
   *
   * @param _spotlightRepository - Repository of Spotlight entries.
   * @param _storyService - Resolves and checks featured Stories.
   * @param _arcService - Resolves and checks featured Arcs.
   * @param _slugService - Produces and retires slugs.
   * @param _notificationService - Tells somebody their work has been chosen.
   */
  constructor(
    @InjectRepository(StorytimeSpotlightEntity)
    private readonly _spotlightRepository: Repository<StorytimeSpotlightEntity>,
    private readonly _storyService: StorytimeStoryService,
    private readonly _arcService: StorytimeArcService,
    private readonly _slugService: StorytimeSlugService,
    private readonly _notificationService: NotificationService,
  ) {}

  /**
   * Lists what the Spotlight is showing right now.
   *
   * @param now - The moment to judge the schedule against.
   * @returns The showing entries with their works, best first.
   */
  async findShowing(now: Date = new Date()): Promise<SpotlightWithTarget[]> {
    const entries = await this._spotlightRepository.find({
      where: [
        {
          isPublished: true,
          startsAt: LessThanOrEqual(now),
          endsAt: MoreThan(now),
        },
        {
          isPublished: true,
          startsAt: LessThanOrEqual(now),
          endsAt: IsNull(),
        },
      ],
      order: { displayPriority: 'DESC', startsAt: 'DESC' },
    });

    return this.withTargets(entries);
  }

  /**
   * Lists the entries that have finished showing.
   *
   * Kept readable because a Spotlight is a small piece of the site's history:
   * being chosen is worth something to the person chosen, and a selection that
   * evaporates the moment it ends would take that with it.
   *
   * @param now - The moment to judge the schedule against.
   * @returns The past entries with their works, most recent first.
   */
  async findArchive(now: Date = new Date()): Promise<SpotlightWithTarget[]> {
    const entries = await this._spotlightRepository.find({
      where: { isPublished: true, endsAt: LessThanOrEqual(now) },
      order: { endsAt: 'DESC' },
    });

    return this.withTargets(entries);
  }

  /**
   * Reads one Spotlight entry by its address.
   *
   * A scheduled entry that has not started is treated as absent rather than
   * refused, because saying "not yet" would announce editorial decisions
   * before they are made public.
   *
   * @param slug - The entry slug.
   * @param now - The moment to judge the schedule against.
   * @returns The entry with its work, or null when nothing is showing there.
   */
  async findBySlug(
    slug: string,
    now: Date = new Date(),
  ): Promise<SpotlightWithTarget | null> {
    const entry = await this._spotlightRepository.findOne({ where: { slug } });

    if (!entry?.isPublished || entry.startsAt > now) {
      return null;
    }

    const [resolved] = await this.withTargets([entry]);

    return resolved ?? null;
  }

  /**
   * Lists every entry an editor manages, showing or not.
   *
   * @returns The entries, most recently scheduled first.
   */
  findAll(): Promise<StorytimeSpotlightEntity[]> {
    return this._spotlightRepository.find({ order: { startsAt: 'DESC' } });
  }

  /**
   * Retrieves one entry for editing.
   *
   * @param spotlightId - The entry.
   * @returns The entry.
   * @throws NotFoundException when no live entry has that identifier.
   */
  async findOneOrFail(spotlightId: string): Promise<StorytimeSpotlightEntity> {
    const entry = await this._spotlightRepository.findOne({
      where: { id: spotlightId },
    });

    if (!entry) {
      throw new NotFoundException('That Spotlight entry could not be found.');
    }

    return entry;
  }

  /**
   * Creates a Spotlight entry.
   *
   * The entry starts unpublished whatever else it says, so an editor can draft
   * the copy and schedule it without it appearing the moment it is saved.
   *
   * @param dto - The entry to create.
   * @param actingUserId - The editor.
   * @returns The created entry.
   */
  async create(
    dto: CreateSpotlightDto,
    actingUserId: string,
  ): Promise<StorytimeSpotlightEntity> {
    const startsAt = new Date(dto.startsAt);
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;

    this.assertPeriod(startsAt, endsAt);
    await this.resolveFeaturable(dto.entityType, dto.storyId, dto.arcId);

    const slug = await this._slugService.generateUniqueSlug({
      desiredSlug: dto.slug,
      title: dto.headline,
      targetType: StorytimeTargetType.SPOTLIGHT,
      isTakenByLiveEntity: candidate => this.isSlugTaken(candidate),
    });

    const entry = this._spotlightRepository.create({
      slug,
      entityType: dto.entityType,
      storyId:
        dto.entityType === SpotlightEntityType.STORY ? dto.storyId : null,
      arcId: dto.entityType === SpotlightEntityType.ARC ? dto.arcId : null,
      headline: dto.headline,
      summary: dto.summary,
      selectionReason: dto.selectionReason ?? null,
      overrideImageId: dto.overrideImageId ?? null,
      overrideImageAlt: dto.overrideImageAlt ?? null,
      displayPriority: dto.displayPriority ?? 0,
      startsAt,
      endsAt,
      isPublished: false,
      createdByUserId: actingUserId,
      updatedByUserId: actingUserId,
    });

    const saved = await this._spotlightRepository.save(entry);

    this._logger.log(`Spotlight ${saved.id} drafted by ${actingUserId}`);

    return saved;
  }

  /**
   * Changes a Spotlight entry.
   *
   * @param spotlightId - The entry.
   * @param dto - The changes.
   * @param actingUserId - The editor.
   * @returns The entry after the change.
   */
  async update(
    spotlightId: string,
    dto: UpdateSpotlightDto,
    actingUserId: string,
  ): Promise<StorytimeSpotlightEntity> {
    const entry = await this.findOneOrFail(spotlightId);
    const previousSlug = entry.slug;

    const startsAt = dto.startsAt ? new Date(dto.startsAt) : entry.startsAt;
    const endsAt =
      dto.endsAt === undefined
        ? entry.endsAt
        : dto.endsAt === null
          ? null
          : new Date(dto.endsAt);

    this.assertPeriod(startsAt, endsAt);

    const storyId =
      entry.entityType === SpotlightEntityType.STORY
        ? (dto.storyId ?? entry.storyId)
        : null;
    const arcId =
      entry.entityType === SpotlightEntityType.ARC
        ? (dto.arcId ?? entry.arcId)
        : null;

    await this.resolveFeaturable(
      entry.entityType,
      storyId ?? undefined,
      arcId ?? undefined,
    );

    if (dto.slug && dto.slug !== entry.slug) {
      entry.slug = await this._slugService.generateUniqueSlug({
        desiredSlug: dto.slug,
        title: dto.headline ?? entry.headline,
        targetType: StorytimeTargetType.SPOTLIGHT,
        isTakenByLiveEntity: candidate =>
          this.isSlugTaken(candidate, spotlightId),
      });
    }

    entry.storyId = storyId;
    entry.arcId = arcId;
    entry.headline = dto.headline ?? entry.headline;
    entry.summary = dto.summary ?? entry.summary;
    entry.selectionReason =
      dto.selectionReason === undefined
        ? entry.selectionReason
        : (dto.selectionReason ?? null);
    entry.overrideImageId =
      dto.overrideImageId === undefined
        ? entry.overrideImageId
        : (dto.overrideImageId ?? null);
    entry.overrideImageAlt =
      dto.overrideImageAlt === undefined
        ? entry.overrideImageAlt
        : (dto.overrideImageAlt ?? null);
    entry.displayPriority = dto.displayPriority ?? entry.displayPriority;
    entry.startsAt = startsAt;
    entry.endsAt = endsAt;
    entry.isPublished = dto.isPublished ?? entry.isPublished;
    entry.updatedByUserId = actingUserId;

    const saved = await this._spotlightRepository.save(entry);

    await this._slugService.recordRetiredSlug(
      StorytimeTargetType.SPOTLIGHT,
      saved.id,
      previousSlug,
      saved.slug,
    );

    return saved;
  }

  /**
   * Publishes a Spotlight entry.
   *
   * Publishing does not mean showing: the schedule still decides that. What it
   * means is that the editorial decision is made, and the entry may show when
   * its time comes.
   *
   * @param spotlightId - The entry.
   * @param actingUserId - The editor.
   * @returns The published entry.
   */
  async publish(
    spotlightId: string,
    actingUserId: string,
  ): Promise<StorytimeSpotlightEntity> {
    const entry = await this.findOneOrFail(spotlightId);
    const alreadyPublished = entry.isPublished;

    const work = await this.resolveFeaturable(
      entry.entityType,
      entry.storyId ?? undefined,
      entry.arcId ?? undefined,
    );

    entry.isPublished = true;
    entry.updatedByUserId = actingUserId;

    const saved = await this._spotlightRepository.save(entry);

    // Only on the transition, so a correction to a published entry does not
    // tell somebody a second time that they have been chosen.
    if (!alreadyPublished) {
      await this.notifySelected(work);
    }

    this._logger.log(`Spotlight ${saved.id} published by ${actingUserId}`);

    return saved;
  }

  /**
   * Withdraws a Spotlight entry from showing.
   *
   * @param spotlightId - The entry.
   * @param actingUserId - The editor.
   * @returns The withdrawn entry.
   */
  async unpublish(
    spotlightId: string,
    actingUserId: string,
  ): Promise<StorytimeSpotlightEntity> {
    const entry = await this.findOneOrFail(spotlightId);

    entry.isPublished = false;
    entry.updatedByUserId = actingUserId;

    const saved = await this._spotlightRepository.save(entry);

    this._logger.log(`Spotlight ${saved.id} withdrawn by ${actingUserId}`);

    return saved;
  }

  /**
   * Deletes a Spotlight entry.
   *
   * @param spotlightId - The entry.
   * @param actingUserId - The editor.
   */
  async remove(spotlightId: string, actingUserId: string): Promise<void> {
    const entry = await this.findOneOrFail(spotlightId);

    await this._spotlightRepository.softDelete(entry.id);

    this._logger.log(`Spotlight ${entry.id} deleted by ${actingUserId}`);
  }

  /**
   * Attaches the featured work to each entry, dropping any that has none.
   *
   * An entry whose work is no longer publicly listed is left out rather than
   * shown empty. That covers a Story that has been removed by an
   * administrator, unpublished by its owner, or made private or unlisted since
   * it was chosen.
   *
   * @param entries - The entries to resolve.
   * @returns The entries that still have something to show.
   */
  private async withTargets(
    entries: StorytimeSpotlightEntity[],
  ): Promise<SpotlightWithTarget[]> {
    if (entries.length === 0) {
      return [];
    }

    const stories = await this._storyService.findPublicByIds(
      this.identifiersOf(entries, SpotlightEntityType.STORY),
    );
    const arcs = await this._arcService.findPublicByIds(
      this.identifiersOf(entries, SpotlightEntityType.ARC),
    );

    const storiesById = this.listedById(stories);
    const arcsById = this.listedById(arcs);

    return entries
      .map(entry => ({
        entry,
        story: entry.storyId ? (storiesById.get(entry.storyId) ?? null) : null,
        arc: entry.arcId ? (arcsById.get(entry.arcId) ?? null) : null,
      }))
      .filter(resolved => resolved.story !== null || resolved.arc !== null);
  }

  /**
   * Collects the target identifiers of one kind.
   *
   * @param entries - The entries to read.
   * @param entityType - The kind of target wanted.
   * @returns The identifiers.
   */
  private identifiersOf(
    entries: StorytimeSpotlightEntity[],
    entityType: SpotlightEntityType,
  ): string[] {
    return entries
      .filter(entry => entry.entityType === entityType)
      .map(entry =>
        entityType === SpotlightEntityType.STORY ? entry.storyId : entry.arcId,
      )
      .filter((id): id is string => id !== null);
  }

  /**
   * Indexes works by identifier, keeping only the publicly listed ones.
   *
   * Unlisted work is excluded deliberately. Unlisted means readable by anybody
   * holding the link but never surfaced by browsing, and the Spotlight is the
   * most prominent browsing surface the site has.
   *
   * @param targets - The works to index.
   * @returns The listed works by identifier.
   */
  private listedById<T extends { id: string; visibility: StorytimeVisibility }>(
    targets: T[],
  ): Map<string, T> {
    return new Map(
      targets
        .filter(target => target.visibility === StorytimeVisibility.PUBLIC)
        .map(target => [target.id, target]),
    );
  }

  /**
   * Refuses a period that ends before it begins.
   *
   * @param startsAt - When the entry starts showing.
   * @param endsAt - When it stops, if it does.
   * @throws BadRequestException when the period is impossible.
   */
  private assertPeriod(startsAt: Date, endsAt: Date | null): void {
    if (endsAt && endsAt <= startsAt) {
      throw new BadRequestException(
        'A Spotlight entry must end after it starts.',
      );
    }
  }

  /**
   * Resolves the work an entry features, refusing anything unfeaturable.
   *
   * Checked when the entry is written as well as when it is read: a mistyped
   * identifier should be a sentence at the point of editing, not an entry that
   * silently never appears.
   *
   * @param entityType - What kind of work is featured.
   * @param storyId - The featured Story, when a Story is featured.
   * @param arcId - The featured Arc, when an Arc is featured.
   * @returns Who wrote the work and what it is called.
   * @throws BadRequestException when the work cannot be featured.
   */
  private async resolveFeaturable(
    entityType: SpotlightEntityType,
    storyId?: string,
    arcId?: string,
  ): Promise<FeaturedWork> {
    if (entityType === SpotlightEntityType.STORY) {
      const stories = await this._storyService.findPublicByIds(
        storyId ? [storyId] : [],
      );

      return this.firstListed(stories, 'Story');
    }

    const arcs = await this._arcService.findPublicByIds(arcId ? [arcId] : []);

    return this.firstListed(arcs, 'Arc');
  }

  /**
   * Picks the listed work from a lookup, refusing when there is none.
   *
   * @param targets - What the lookup found.
   * @param label - How to name the kind of work in the message.
   * @returns The work.
   * @throws BadRequestException when there is nothing listed to feature.
   */
  private firstListed(
    targets: (FeaturedWork & { visibility: StorytimeVisibility })[],
    label: string,
  ): FeaturedWork {
    const listed = targets.find(
      target => target.visibility === StorytimeVisibility.PUBLIC,
    );

    if (!listed) {
      throw new BadRequestException(
        `That ${label} cannot be featured: it must be published and public.`,
      );
    }

    return listed;
  }

  /**
   * Tells somebody their work has been chosen.
   *
   * Best effort, like every other Storytime notification: the selection is
   * already saved, and losing it because the notification failed would be a
   * poor trade for the editor and for the person being told.
   *
   * @param work - The work that was chosen.
   */
  private async notifySelected(work: FeaturedWork): Promise<void> {
    try {
      await this._notificationService.createNotification({
        target: NotificationTarget.USER,
        userId: work.ownerUserId,
        severity: NotificationSeverity.INFO,
        title: 'Your work is in the Storytime Spotlight',
        body: `"${work.title}" has been chosen for the Storytime Spotlight.`,
      });
    } catch (error) {
      this._logger.error(
        `Failed to notify ${work.ownerUserId} of their Spotlight selection`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Whether a slug is already used by another live entry.
   *
   * @param slug - The candidate slug.
   * @param exceptId - An entry allowed to keep its own slug.
   * @returns True when something else holds it.
   */
  private async isSlugTaken(slug: string, exceptId?: string): Promise<boolean> {
    const existing = await this._spotlightRepository.findOne({
      where: { slug },
    });

    return existing !== null && existing.id !== exceptId;
  }
}
