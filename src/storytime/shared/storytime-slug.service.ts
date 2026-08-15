import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { normaliseToSlug } from '../../shared/utilities/slug.utility';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeSlugHistoryEntity } from '../stories/entities/storytime-slug-history.entity';

/** Longest slug stored, matching the column width. */
export const SLUG_MAX_LENGTH = 220;

/**
 * Used when a title reduces to nothing a URL can carry — a title made entirely
 * of punctuation or of characters that do not transliterate.
 */
export const SLUG_FALLBACK_STEM = 'untitled';

/**
 * How many suffixed candidates to try before giving up.
 *
 * Reaching this would mean hundreds of Stories share a title, which is far more
 * likely to be a bug or an abusive script than a real collection. Failing
 * loudly beats looping forever.
 */
export const MAX_SLUG_ATTEMPTS = 200;

/** What a caller must tell the service to produce a slug. */
export interface SlugRequest {
  /** A slug the creator typed, which wins over the title when usable. */
  desiredSlug?: string | null;
  /** The title to fall back on. */
  title: string;
  /** The kind of entity being named. */
  targetType: StorytimeTargetType;
  /** The Story a Chapter or Character slug is scoped to. */
  storyId?: string | null;
  /**
   * Whether a candidate is already used by a live entity of this kind.
   *
   * Supplied by the caller because only it knows which table to look in.
   */
  isTakenByLiveEntity: (slug: string) => Promise<boolean>;
}

/**
 * Produces slugs and remembers the ones entities used to have.
 *
 * Slugs are generated from the title but a creator may type their own, so this
 * service owns the policy — normalisation, collision suffixes, and the rule
 * that a retired slug is never reissued — while callers own the question of
 * what is currently taken in their own table.
 *
 * Retired slugs matter because fan fiction gets linked from forums and Discord,
 * and those links outlive any rename. Two rules follow. An old address still
 * resolves, redirecting to the current one. And no new entity may take a
 * retired slug, because an old link quietly resolving to somebody else's Story
 * is worse than the dead link the history exists to prevent.
 */
@Injectable()
export class StorytimeSlugService {
  /**
   * Creates an instance of StorytimeSlugService.
   *
   * @param _slugHistoryRepository - Repository of retired slugs.
   */
  constructor(
    @InjectRepository(StorytimeSlugHistoryEntity)
    private readonly _slugHistoryRepository: Repository<StorytimeSlugHistoryEntity>,
  ) {}

  /**
   * Produces a slug that is free both now and historically.
   *
   * @param request - The title or desired slug, and how to test availability.
   * @returns A slug nothing else is using.
   * @throws Error when no free candidate is found within the attempt limit.
   */
  async generateUniqueSlug(request: SlugRequest): Promise<string> {
    const stem = this.buildStem(request.desiredSlug, request.title);

    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      const candidate = this.buildCandidate(stem, attempt);

      if (!(await this.isTaken(candidate, request))) {
        return candidate;
      }
    }

    throw new Error(
      `Unable to find a free slug for '${stem}' after ${MAX_SLUG_ATTEMPTS} attempts`,
    );
  }

  /**
   * Records the slug an entity has just stopped using.
   *
   * Does nothing when the slug has not actually changed, so callers can invoke
   * it unconditionally on update without checking first.
   *
   * @param targetType - The kind of entity.
   * @param targetId - The entity that was renamed.
   * @param previousSlug - The slug it no longer uses.
   * @param currentSlug - The slug it now uses.
   * @param storyId - The Story the slug is scoped to, for Chapters and Characters.
   */
  async recordRetiredSlug(
    targetType: StorytimeTargetType,
    targetId: string,
    previousSlug: string,
    currentSlug: string,
    storyId: string | null = null,
  ): Promise<void> {
    if (previousSlug === currentSlug) {
      return;
    }

    const alreadyRecorded = await this._slugHistoryRepository.findOne({
      where: {
        targetType,
        slug: previousSlug,
        storyId: storyId ?? IsNull(),
      },
    });

    // A slug can be retired, reclaimed by the same entity, and retired again.
    // The history only needs to know it was once in use, not how often.
    if (alreadyRecorded) {
      return;
    }

    await this._slugHistoryRepository.save(
      this._slugHistoryRepository.create({
        targetType,
        targetId,
        storyId: storyId ?? null,
        slug: previousSlug,
        replacedAt: new Date(),
      }),
    );
  }

  /**
   * Finds the entity that used to answer to a slug.
   *
   * @param targetType - The kind of entity.
   * @param slug - The retired slug from the incoming URL.
   * @param storyId - The Story the slug is scoped to, for Chapters and Characters.
   * @returns The entity's identifier, or null when the slug was never used.
   */
  async findByRetiredSlug(
    targetType: StorytimeTargetType,
    slug: string,
    storyId: string | null = null,
  ): Promise<string | null> {
    const history = await this._slugHistoryRepository.findOne({
      where: { targetType, slug, storyId: storyId ?? IsNull() },
      order: { replacedAt: 'DESC' },
    });

    return history?.targetId ?? null;
  }

  /**
   * Reduces a desired slug or title to the stem candidates are built from.
   *
   * @param desiredSlug - A slug the creator typed, if any.
   * @param title - The title to fall back on.
   * @returns The normalised stem, never empty.
   */
  private buildStem(
    desiredSlug: string | null | undefined,
    title: string,
  ): string {
    const fromDesired = desiredSlug
      ? normaliseToSlug(desiredSlug, SLUG_MAX_LENGTH)
      : '';

    if (fromDesired) {
      return fromDesired;
    }

    const fromTitle = normaliseToSlug(title, SLUG_MAX_LENGTH);

    // A title of nothing but punctuation, or in a script that does not
    // transliterate, still has to produce an addressable Story.
    return fromTitle || SLUG_FALLBACK_STEM;
  }

  /**
   * Builds the candidate for a given attempt.
   *
   * @param stem - The normalised stem.
   * @param attempt - The zero-based attempt number.
   * @returns The candidate slug, truncated to fit the column.
   */
  private buildCandidate(stem: string, attempt: number): string {
    if (attempt === 0) {
      return stem;
    }

    const suffix = `-${attempt + 1}`;
    const room = SLUG_MAX_LENGTH - suffix.length;

    return `${stem.slice(0, room)}${suffix}`;
  }

  /**
   * Determines whether a candidate is unavailable.
   *
   * @param candidate - The slug to test.
   * @param request - The original request, carrying the availability test.
   * @returns True when the candidate is in use now or was in the past.
   */
  private async isTaken(
    candidate: string,
    request: SlugRequest,
  ): Promise<boolean> {
    if (await request.isTakenByLiveEntity(candidate)) {
      return true;
    }

    const retiredOwner = await this.findByRetiredSlug(
      request.targetType,
      candidate,
      request.storyId ?? null,
    );

    return retiredOwner !== null;
  }
}
