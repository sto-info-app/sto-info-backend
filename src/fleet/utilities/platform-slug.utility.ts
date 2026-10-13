import { FindOptionsWhere, IsNull, Not, Repository } from 'typeorm';

import type {
  FleetSlugRequest,
  FleetSlugScope,
} from '../services/fleet-slug.service';

/** What a Fleet or an Armada asks for when it needs a slug. */
export interface PlatformSlugWish {
  /** A slug the registrant typed, which wins over the name when usable. */
  desiredSlug?: string;
  /** The name to fall back on. */
  name: string;
  /** The record being renamed, which may keep its own slug. */
  targetId?: string;
}

/** The columns a live-slug lookup reads, on a Fleet or an Armada. */
interface PlatformSlugHolder {
  id: string;
  communityId: string | null;
  platformId: string;
  slug: string;
  deletedAt: Date | null;
}

/**
 * Builds the request for a slug free within one Community on one platform.
 *
 * A Fleet and an Armada are addressed the same way — ADR-0022 — and differ
 * only in which table holds them, so each passes its own repository and this
 * supplies the rest, including the look-up of live records already holding a
 * candidate.
 *
 * @param scope - Where the slug has to be unique.
 * @param wish - The desired slug, the name to fall back on, and the record
 *   being renamed when there is one.
 * @param repository - The table the scope's records live in.
 * @returns The request for {@link FleetSlugService.generateUniqueSlug}.
 */
export function platformSlugRequest<T extends PlatformSlugHolder>(
  scope: FleetSlugScope,
  wish: PlatformSlugWish,
  repository: Repository<T>,
): FleetSlugRequest {
  return {
    ...scope,
    desiredSlug: wish.desiredSlug,
    name: wish.name,
    targetId: wish.targetId,
    isTakenByLiveScope: async candidate => {
      const held = await repository.count({
        where: {
          communityId: scope.communityId,
          platformId: scope.platformId,
          slug: candidate,
          deletedAt: IsNull(),
          ...(wish.targetId ? { id: Not(wish.targetId) } : {}),
        } as FindOptionsWhere<T>,
      });

      return held > 0;
    },
  };
}
