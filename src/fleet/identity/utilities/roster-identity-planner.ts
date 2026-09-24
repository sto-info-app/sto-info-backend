import { RosterIdentityCandidateKind } from '../enums/roster-identity-candidate-kind.enum';
import { RosterIdentityCandidateState } from '../enums/roster-identity-candidate-state.enum';
import { RosterIdentityCollisionReason } from '../enums/roster-identity-collision-reason.enum';
import { candidateKey, MatchedCandidate } from './roster-identity-matcher';

/** One alias pair, by alias identifier. */
export interface AliasLink {
  /** The alias that vanished. */
  readonly fromAliasId: string;
  /** The alias that appeared. */
  readonly toAliasId: string;
}

/** What the planner needs of a stored candidate. */
export interface StoredCandidate {
  readonly id: string;
  readonly kind: RosterIdentityCandidateKind;
  readonly state: RosterIdentityCandidateState;
  readonly fromAliasId: string | null;
  readonly toAliasId: string | null;
  readonly fromHandleNormalised: string | null;
  readonly toHandleNormalised: string | null;
  readonly collisionReasons: readonly RosterIdentityCollisionReason[];
  readonly stale: boolean;
  readonly revision: number;
  readonly links: readonly AliasLink[];
}

/** What a recompute has to do to a Fleet's stored candidates. */
export interface CandidatePlan {
  /** Suggested for the first time. */
  readonly inserts: readonly MatchedCandidate[];
  /** Open, and rewritten from what the evidence now says. */
  readonly refreshes: ReadonlyArray<{
    readonly id: string;
    readonly candidate: MatchedCandidate;
  }>;
  /** Kept as they are, but with the stale flag changed. */
  readonly staleness: ReadonlyArray<{
    readonly id: string;
    readonly stale: boolean;
  }>;
  /** Never decided, and no longer suggested. */
  readonly deletions: readonly string[];
}

/** What {@link assignIdentities} needs of an alias. */
export interface AssignableAlias {
  readonly id: string;
  readonly identityId: string;
  readonly originIdentityId: string;
  readonly firstObservedAt: Date | null;
  readonly createdAt: Date;
}

/**
 * Works out what a recompute has to do to a Fleet's stored candidates.
 *
 * Pure, so the rules are tested apart from the database:
 *
 * - **Newly suggested** — inserted, open.
 * - **Still suggested and open** — rewritten from the evidence, including its
 *   links and collision reasons, and not stale. An open candidate records a
 *   suggestion, and the suggestion is whatever the evidence says now.
 * - **Still suggested and decided** — left alone, as decided, and stale only
 *   if the evidence no longer says what it said: different alias pairs, or
 *   now unresolvable. Steve decided on 24 September 2026 that a decision
 *   stands when its evidence moves, and a reviewer is told to look again.
 * - **No longer suggested** — deleted if nobody ever decided it; otherwise
 *   kept, and stale, so that no decision and no undo is lost.
 *
 * @param stored - The Fleet's candidates as stored, with their links.
 * @param matched - What the evidence suggests now, by candidate key.
 * @param aliasKeyById - Every alias's key, by its identifier.
 * @param aliasIdByKey - Every alias's identifier, by its key.
 * @returns What to insert, rewrite, flag and delete.
 */
export function planCandidates(
  stored: readonly StoredCandidate[],
  matched: ReadonlyMap<string, MatchedCandidate>,
  aliasKeyById: ReadonlyMap<string, string>,
  aliasIdByKey: ReadonlyMap<string, string>,
): CandidatePlan {
  const refreshes: Array<{ id: string; candidate: MatchedCandidate }> = [];
  const staleness: Array<{ id: string; stale: boolean }> = [];
  const deletions: string[] = [];
  const seen = new Set<string>();

  for (const candidate of stored) {
    const key = storedKey(candidate, aliasKeyById);
    const now = matched.get(key);

    seen.add(key);

    if (now === undefined) {
      if (candidate.state === RosterIdentityCandidateState.OPEN) {
        if (candidate.revision === 0) {
          deletions.push(candidate.id);

          continue;
        }
      }

      if (!candidate.stale) {
        staleness.push({ id: candidate.id, stale: true });
      }

      continue;
    }

    if (candidate.state === RosterIdentityCandidateState.OPEN) {
      refreshes.push({ id: candidate.id, candidate: now });

      continue;
    }

    const stale =
      now.collisionReasons.length > 0 ||
      !sameLinks(candidate.links, now, aliasIdByKey);

    if (stale !== candidate.stale) {
      staleness.push({ id: candidate.id, stale });
    }
  }

  const inserts = [...matched.values()].filter(each => !seen.has(each.key));

  return { inserts, refreshes, staleness, deletions };
}

/**
 * Works out which identity each alias belongs to.
 *
 * Aliases joined by a confirmed candidate's links are one identity, and so is
 * anything joined to them in turn. The identity a group takes is the origin
 * identity of its earliest-observed alias, so that the UUID a reader has been
 * shown for a Character keeps meaning that Character after a rename is
 * confirmed; an alias no in-force export lists sorts last, and ties go to the
 * alias recorded first. An alias in no group returns to its origin identity,
 * which is what makes undoing a confirmation separate what it joined.
 *
 * @param aliases - Every alias of the Fleet.
 * @param confirmed - The links of every confirmed candidate.
 * @returns The identity each alias should now have, for those that change.
 */
export function assignIdentities(
  aliases: readonly AssignableAlias[],
  confirmed: readonly AliasLink[],
): Map<string, string> {
  const parent = new Map(aliases.map(alias => [alias.id, alias.id]));

  const root = (id: string): string => {
    let current = id;

    while (parent.get(current) !== current) {
      current = parent.get(current)!;
    }

    parent.set(id, current);

    return current;
  };

  for (const { fromAliasId, toAliasId } of confirmed) {
    if (parent.has(fromAliasId) && parent.has(toAliasId)) {
      parent.set(root(fromAliasId), root(toAliasId));
    }
  }

  const leader = new Map<string, AssignableAlias>();

  for (const alias of aliases) {
    const group = root(alias.id);
    const current = leader.get(group);

    if (current === undefined || observedEarlier(alias, current)) {
      leader.set(group, alias);
    }
  }

  const changes = new Map<string, string>();

  for (const alias of aliases) {
    const identityId = leader.get(root(alias.id))!.originIdentityId;

    if (identityId !== alias.identityId) {
      changes.set(alias.id, identityId);
    }
  }

  return changes;
}

/**
 * The key a stored candidate is known by, as {@link candidateKey} gives it.
 *
 * @param candidate - The stored candidate.
 * @param aliasKeyById - Every alias's key, by its identifier.
 * @returns Its key.
 */
function storedKey(
  candidate: StoredCandidate,
  aliasKeyById: ReadonlyMap<string, string>,
): string {
  return candidate.kind === RosterIdentityCandidateKind.CHARACTER_RENAME
    ? candidateKey(
        candidate.kind,
        aliasKeyById.get(candidate.fromAliasId!)!,
        aliasKeyById.get(candidate.toAliasId!)!,
      )
    : candidateKey(
        candidate.kind,
        candidate.fromHandleNormalised!,
        candidate.toHandleNormalised!,
      );
}

/**
 * Whether a stored candidate's links are the pairs the evidence now gives.
 *
 * @param links - The stored links.
 * @param candidate - What the evidence suggests now.
 * @param aliasIdByKey - Every alias's identifier, by its key.
 * @returns True if they are the same pairs.
 */
function sameLinks(
  links: readonly AliasLink[],
  candidate: MatchedCandidate,
  aliasIdByKey: ReadonlyMap<string, string>,
): boolean {
  const pair = (from: string, to: string): string => JSON.stringify([from, to]);
  const was = new Set(
    links.map(link => pair(link.fromAliasId, link.toAliasId)),
  );
  const now = new Set(
    candidate.links.map(link =>
      pair(aliasIdByKey.get(link.fromKey)!, aliasIdByKey.get(link.toKey)!),
    ),
  );

  return was.size === now.size && [...was].every(each => now.has(each));
}

/**
 * Whether one alias leads a group ahead of another.
 *
 * @param alias - The challenger.
 * @param current - The alias leading now.
 * @returns True if the challenger was observed earlier, or recorded earlier
 *   on a tie.
 */
function observedEarlier(
  alias: AssignableAlias,
  current: AssignableAlias,
): boolean {
  const first = alias.firstObservedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const leading =
    current.firstObservedAt?.getTime() ?? Number.POSITIVE_INFINITY;

  if (first !== leading) {
    return first < leading;
  }

  if (alias.createdAt.getTime() !== current.createdAt.getTime()) {
    return alias.createdAt.getTime() < current.createdAt.getTime();
  }

  return alias.id < current.id;
}
