import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, Repository } from 'typeorm';

import { normaliseToSlug } from 'src/shared/utilities/slug.utility';

import { FleetSlugHistoryEntity } from '../entities/fleet-slug-history.entity';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';

/** Longest slug stored, matching the column width on all three tables. */
export const FLEET_SLUG_MAX_LENGTH = 80;

/**
 * How many suffixed candidates to try before giving up.
 *
 * Reaching this would mean two hundred scopes in one Community on one
 * platform share a name, which is a script rather than a Community. Failing
 * loudly beats looping forever.
 */
export const MAX_FLEET_SLUG_ATTEMPTS = 200;

/**
 * Where a slug has to be unique, which differs by kind — ADR-0022.
 *
 * A Community's slug is unique across the site, so it carries no parent. A
 * Fleet's or an Armada's is unique within one Community on one platform, and
 * carries both. The migration's check constraint refuses any other
 * combination, so this interface describes what the database will accept
 * rather than merely what the service prefers.
 */
export interface FleetSlugScope {
  /** Which kind of scope the slug belongs to. */
  targetType: FleetScopeKind;
  /** The owning Community, or null for a Community's own slug. */
  communityId: string | null;
  /** The platform, or null for a Community's own slug. */
  platformId: string | null;
}

/** What a caller must supply to be given a slug. */
export interface FleetSlugRequest extends FleetSlugScope {
  /** A slug the registrant typed, which wins over the name when usable. */
  desiredSlug?: string | null;
  /** The name to fall back on. */
  name: string;
  /**
   * The scope being renamed, when there is one.
   *
   * Absent while registering, because nothing exists to own a slug yet. Given
   * on a rename, so a scope can reclaim a slug it used to have: reverting a
   * rename is an ordinary thing to want, and an old link would resolve to the
   * scope it always pointed at.
   */
  targetId?: string | null;
  /**
   * Whether a candidate is already used by a live scope of this kind.
   *
   * Supplied by the caller because only it knows which of the three tables to
   * look in, and the unique indexes differ between them.
   */
  isTakenByLiveScope: (slug: string) => Promise<boolean>;
}

/**
 * Produces slugs for the three Fleet scopes, and remembers the ones they used
 * to have.
 *
 * Deliberately the same shape as `StorytimeSlugService`, which solves this
 * problem for Stories, because the two answer the same question and a second
 * spelling of one policy is a second thing to get wrong.
 *
 * Retired slugs matter because a Fleet gets linked from Discord and from
 * forum posts, and those links outlive any rename. Two rules follow. An old
 * address still resolves, redirecting to the current one. And no other scope
 * may take a retired slug, because an old link quietly resolving to somebody
 * else's Fleet is worse than the dead link the history exists to prevent.
 *
 * A scope may reclaim its own former slug. Reverting a rename is an ordinary
 * thing to want, and nothing is at risk when the link would resolve to the
 * scope it always pointed at.
 */
@Injectable()
export class FleetSlugService {
  /**
   * Creates an instance of FleetSlugService.
   *
   * @param _slugHistoryRepository - Repository of retired slugs.
   */
  constructor(
    @InjectRepository(FleetSlugHistoryEntity)
    private readonly _slugHistoryRepository: Repository<FleetSlugHistoryEntity>,
  ) {}

  /**
   * Produces a slug that is free both now and historically.
   *
   * @param request - The name or desired slug, the scope, and how to test
   *   availability.
   * @returns A slug nothing else in that scope is using.
   * @throws Error when no free candidate is found within the attempt limit.
   */
  async generateUniqueSlug(request: FleetSlugRequest): Promise<string> {
    const stem = this.buildStem(request);

    for (let attempt = 0; attempt < MAX_FLEET_SLUG_ATTEMPTS; attempt++) {
      const candidate = this.buildCandidate(stem, attempt);

      if (!(await this.isTaken(candidate, request))) {
        return candidate;
      }
    }

    throw new Error(
      `Unable to find a free slug for '${stem}' after ${MAX_FLEET_SLUG_ATTEMPTS} attempts`,
    );
  }

  /**
   * Records the slug a scope has just stopped using.
   *
   * Does nothing when the slug has not changed, so a caller can invoke it
   * unconditionally on update without comparing first.
   *
   * @param scope - Where the slug was unique.
   * @param targetId - The scope that was renamed.
   * @param previousSlug - The slug it no longer uses.
   * @param currentSlug - The slug it now uses.
   */
  async recordRetiredSlug(
    scope: FleetSlugScope,
    targetId: string,
    previousSlug: string,
    currentSlug: string,
  ): Promise<void> {
    if (previousSlug === currentSlug) {
      return;
    }

    const existing = await this.findHistory(scope, previousSlug);

    // A scope can retire a slug, reclaim it, and retire it again. The history
    // only needs to know the name was once in use, not how often, and the
    // unique index would refuse the second row anyway.
    if (existing) {
      return;
    }

    await this._slugHistoryRepository.save(
      this._slugHistoryRepository.create({
        targetType: scope.targetType,
        targetId,
        communityId: scope.communityId,
        platformId: scope.platformId,
        slug: previousSlug,
        replacedAt: new Date(),
      }),
    );
  }

  /**
   * Finds the scope that used to answer to a slug.
   *
   * @param scope - Where the slug was unique.
   * @param slug - The retired slug from the incoming URL.
   * @returns The scope's identifier, or null when the slug was never used.
   */
  async findByRetiredSlug(
    scope: FleetSlugScope,
    slug: string,
  ): Promise<string | null> {
    const history = await this.findHistory(scope, slug);

    return history?.targetId ?? null;
  }

  /**
   * Reads the history row for a slug in one scope.
   *
   * @param scope - Where the slug was unique.
   * @param slug - The slug to look for.
   * @returns The row, or null.
   */
  private async findHistory(
    scope: FleetSlugScope,
    slug: string,
  ): Promise<FleetSlugHistoryEntity | null> {
    return this._slugHistoryRepository.findOne({
      where: {
        targetType: scope.targetType,
        communityId: scope.communityId ?? IsNull(),
        platformId: scope.platformId ?? IsNull(),
        slug,
      },
      order: { replacedAt: 'DESC' },
    });
  }

  /**
   * Reduces a desired slug or a name to the stem candidates are built from.
   *
   * @param request - The request being served.
   * @returns The normalised stem, never empty.
   */
  private buildStem(request: FleetSlugRequest): string {
    const fromDesired = request.desiredSlug
      ? normaliseToSlug(request.desiredSlug, FLEET_SLUG_MAX_LENGTH)
      : '';

    if (fromDesired) {
      return fromDesired;
    }

    const fromName = normaliseToSlug(request.name, FLEET_SLUG_MAX_LENGTH);

    // ADR-0003 accepts any script, so a name can reduce to nothing a URL can
    // carry: `艦隊オメガ` transliterates to an empty string, and so does a
    // name made entirely of punctuation. The kind is the most useful thing
    // left to say, and the suffix makes it addressable.
    return fromName || request.targetType.toLowerCase();
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
    const room = FLEET_SLUG_MAX_LENGTH - suffix.length;

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
    request: FleetSlugRequest,
  ): Promise<boolean> {
    if (await request.isTakenByLiveScope(candidate)) {
      return true;
    }

    const retiredOwner = await this.findByRetiredSlug(request, candidate);

    return retiredOwner !== null && retiredOwner !== request.targetId;
  }
}
