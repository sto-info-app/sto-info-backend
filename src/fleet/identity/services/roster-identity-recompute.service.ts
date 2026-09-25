import { randomUUID } from 'crypto';

import { Injectable } from '@nestjs/common';

import { EntityManager, In } from 'typeorm';

import { ROSTER_IDENTITY_WRITE_BATCH } from '../constants/roster-identity.constants';
import { RosterIdentityAliasEntity } from '../entities/roster-identity-alias.entity';
import { RosterIdentityCandidateLinkEntity } from '../entities/roster-identity-candidate-link.entity';
import { RosterIdentityCandidateEntity } from '../entities/roster-identity-candidate.entity';
import { RosterIdentityEntity } from '../entities/roster-identity.entity';
import { RosterIdentityCandidateState } from '../enums/roster-identity-candidate-state.enum';
import {
  MatchedAlias,
  MatchedCandidate,
  rosterAliasKey,
  RosterIdentityMatch,
  RosterIdentityMatcher,
  RosterIdentitySnapshot,
} from '../utilities/roster-identity-matcher';
import {
  assignIdentities,
  planCandidates,
} from '../utilities/roster-identity-planner';

/** What one recompute did, in counts. Nothing a roster row said. */
export interface RosterIdentityRecomputeSummary {
  /** Aliases the Fleet now has. */
  readonly aliases: number;
  /** Candidates suggested for the first time. */
  readonly inserted: number;
  /** Open candidates rewritten from the evidence. */
  readonly refreshed: number;
  /** Candidates whose stale flag changed. */
  readonly restaled: number;
  /** Undecided candidates the evidence no longer suggests. */
  readonly deleted: number;
  /** Aliases that moved to a different identity. */
  readonly reassigned: number;
}

/** What a recompute leaves behind: the aliases, and what it did. */
export interface RosterIdentityRecomputeResult {
  /** Every alias of the Fleet, as now stored, each with its identity. */
  readonly aliases: readonly RosterIdentityAliasEntity[];
  /** What it did, in counts. */
  readonly summary: RosterIdentityRecomputeSummary;
}

/**
 * Works out a Fleet's roster identities again from its evidence and its
 * reviewers' decisions.
 *
 * Plan section 3.6 allows a full replay of a Fleet in v1 because an identity
 * decision can change conclusions drawn from any export, and Steve chose on
 * 24 September 2026 to recompute the whole Fleet each time rather than patch
 * it import by import: an older export imported late has to be able to undo
 * a suggestion it now sits in the middle of, and only a full pass sees that.
 *
 * ## Inside the replay
 *
 * Since FC-019 this is one step of a Fleet's roster replay, which takes the
 * Fleet's lock, decides which exports are effective, and hands them here
 * before building the projection from the identities this leaves. Steve
 * decided on 25 September 2026 that identities and projection are one job
 * and one revision, so that no report is ever built from identities a
 * different pass worked out. Proposals are raised by the replay after it
 * commits.
 *
 * Within the replay's transaction:
 *
 * 1. Every effective export is read in export order through
 *    {@link RosterIdentityMatcher}, which compares only complete ones.
 * 2. Aliases are upserted by their exact key, so an alias keeps its UUID and
 *    its identity across recomputes; one no effective export lists any more
 *    keeps its row with its observed dates cleared.
 * 3. Candidates are brought into line by {@link planCandidates}: a decided
 *    one is never changed, only flagged when its evidence moves.
 * 4. Identities are reassigned by {@link assignIdentities} from the links of
 *    every confirmed candidate.
 *
 * Nothing about any observation is written: the alias table is the join.
 */
@Injectable()
export class RosterIdentityRecomputeService {
  /**
   * Recomputes one Fleet's identities from its effective exports.
   *
   * @param manager - The replay's transaction, holding the Fleet's lock.
   * @param fleetId - The Fleet.
   * @param snapshots - Its effective exports, in export order.
   * @returns Every alias as now stored, and what was done, in counts.
   */
  async recomputeWithin(
    manager: EntityManager,
    fleetId: string,
    snapshots: readonly RosterIdentitySnapshot[],
  ): Promise<RosterIdentityRecomputeResult> {
    const matcher = new RosterIdentityMatcher();

    for (const snapshot of snapshots) {
      matcher.add(snapshot);
    }

    const match = matcher.result();
    const saved = await this.saveAliases(manager, fleetId, match);
    const candidates = await this.saveCandidates(
      manager,
      fleetId,
      match,
      saved,
    );
    const reassigned = await this.assign(manager, fleetId, saved);

    return {
      aliases: await manager.find(RosterIdentityAliasEntity, {
        where: { fleetId },
      }),
      summary: { aliases: saved.length, ...candidates, reassigned },
    };
  }

  /**
   * Brings the Fleet's aliases into line with the evidence.
   *
   * A new alias is born with an identity of its own. One already stored is
   * upserted with the identities it has, so only its spelling and observed
   * dates can change here; which identity it belongs to is
   * {@link assign}'s. One the evidence no longer lists keeps its row, since
   * decisions may cite it, with its observed dates cleared.
   *
   * @param manager - The transaction to write through.
   * @param fleetId - The Fleet.
   * @param match - What the evidence says.
   * @returns Every alias of the Fleet, as now stored.
   */
  private async saveAliases(
    manager: EntityManager,
    fleetId: string,
    match: RosterIdentityMatch,
  ): Promise<RosterIdentityAliasEntity[]> {
    const stored = await manager.find(RosterIdentityAliasEntity, {
      where: { fleetId },
    });
    const byKey = new Map(stored.map(alias => [this.keyOf(alias), alias]));
    const identities: Array<Partial<RosterIdentityEntity>> = [];
    const rows: Array<Partial<RosterIdentityAliasEntity>> = [];

    for (const matched of match.aliases.values()) {
      const existing = byKey.get(matched.key);

      if (existing === undefined) {
        const identityId = randomUUID();

        identities.push({ id: identityId, fleetId });
        rows.push(
          this.aliasRow(fleetId, matched, {
            id: randomUUID(),
            identityId,
            originIdentityId: identityId,
          }),
        );
      } else if (this.aliasChanged(existing, matched)) {
        rows.push(this.aliasRow(fleetId, matched, existing));
      }
    }

    for (const batch of this.batches(identities)) {
      await manager.insert(RosterIdentityEntity, batch);
    }

    for (const batch of this.batches(rows)) {
      await manager.upsert(RosterIdentityAliasEntity, batch, {
        conflictPaths: [
          'fleetId',
          'characterNameNormalised',
          'accountHandleNormalised',
        ],
      });
    }

    const unlisted = stored
      .filter(
        alias =>
          !match.aliases.has(this.keyOf(alias)) &&
          alias.firstObservedAt !== null,
      )
      .map(alias => alias.id);

    if (unlisted.length > 0) {
      await manager.update(
        RosterIdentityAliasEntity,
        { id: In(unlisted) },
        { firstObservedAt: null, lastObservedAt: null },
      );
    }

    return manager.find(RosterIdentityAliasEntity, { where: { fleetId } });
  }

  /**
   * Brings the Fleet's candidates into line with the evidence.
   *
   * @param manager - The transaction to write through.
   * @param fleetId - The Fleet.
   * @param match - What the evidence says.
   * @param aliases - Every alias of the Fleet, as now stored.
   * @returns How many candidates each kind of change touched.
   */
  private async saveCandidates(
    manager: EntityManager,
    fleetId: string,
    match: RosterIdentityMatch,
    aliases: readonly RosterIdentityAliasEntity[],
  ): Promise<{
    inserted: number;
    refreshed: number;
    restaled: number;
    deleted: number;
  }> {
    const aliasKeyById = new Map(
      aliases.map(alias => [alias.id, this.keyOf(alias)]),
    );
    const aliasIdByKey = new Map(
      aliases.map(alias => [this.keyOf(alias), alias.id]),
    );
    const stored = await manager.find(RosterIdentityCandidateEntity, {
      where: { fleetId },
      relations: { links: true },
    });
    const plan = planCandidates(
      stored,
      match.candidates,
      aliasKeyById,
      aliasIdByKey,
    );

    const inserted = plan.inserts.map(candidate => ({
      id: randomUUID(),
      candidate,
    }));

    for (const batch of this.batches(inserted)) {
      await manager.insert(
        RosterIdentityCandidateEntity,
        batch.map(({ id, candidate }) => ({
          id,
          fleetId,
          ...this.candidateColumns(candidate, aliasIdByKey),
        })),
      );
    }

    await this.insertLinks(manager, fleetId, inserted, aliasIdByKey);

    for (const { id, candidate } of plan.refreshes) {
      await manager.update(
        RosterIdentityCandidateEntity,
        { id },
        { ...this.candidateColumns(candidate, aliasIdByKey), stale: false },
      );
      await manager.delete(RosterIdentityCandidateLinkEntity, {
        candidateId: id,
      });
    }

    await this.insertLinks(manager, fleetId, plan.refreshes, aliasIdByKey);

    for (const stale of [true, false]) {
      const ids = plan.staleness
        .filter(each => each.stale === stale)
        .map(each => each.id);

      if (ids.length > 0) {
        await manager.update(
          RosterIdentityCandidateEntity,
          { id: In(ids) },
          { stale },
        );
      }
    }

    if (plan.deletions.length > 0) {
      await manager.delete(RosterIdentityCandidateEntity, {
        id: In([...plan.deletions]),
      });
    }

    return {
      inserted: plan.inserts.length,
      refreshed: plan.refreshes.length,
      restaled: plan.staleness.length,
      deleted: plan.deletions.length,
    };
  }

  /**
   * Moves each alias to the identity its confirmed renames say it has.
   *
   * @param manager - The transaction to write through.
   * @param fleetId - The Fleet.
   * @param aliases - Every alias of the Fleet, as now stored.
   * @returns How many aliases moved.
   */
  private async assign(
    manager: EntityManager,
    fleetId: string,
    aliases: readonly RosterIdentityAliasEntity[],
  ): Promise<number> {
    const confirmed = await manager.find(RosterIdentityCandidateEntity, {
      where: { fleetId, state: RosterIdentityCandidateState.CONFIRMED },
      relations: { links: true },
    });
    const changes = assignIdentities(
      aliases,
      confirmed.flatMap(candidate => candidate.links),
    );
    const byIdentity = new Map<string, string[]>();

    for (const [aliasId, identityId] of changes) {
      byIdentity.set(identityId, [
        ...(byIdentity.get(identityId) ?? []),
        aliasId,
      ]);
    }

    for (const [identityId, aliasIds] of byIdentity) {
      await manager.update(
        RosterIdentityAliasEntity,
        { id: In(aliasIds) },
        { identityId },
      );
    }

    return changes.size;
  }

  /**
   * Inserts the links of some candidates.
   *
   * @param manager - The transaction to write through.
   * @param fleetId - The Fleet.
   * @param candidates - The candidates, with their identifiers.
   * @param aliasIdByKey - Every alias's identifier, by its key.
   */
  private async insertLinks(
    manager: EntityManager,
    fleetId: string,
    candidates: ReadonlyArray<{
      readonly id: string;
      readonly candidate: MatchedCandidate;
    }>,
    aliasIdByKey: ReadonlyMap<string, string>,
  ): Promise<void> {
    const links = candidates.flatMap(({ id, candidate }) =>
      candidate.links.map(link => ({
        candidateId: id,
        fleetId,
        fromAliasId: aliasIdByKey.get(link.fromKey)!,
        toAliasId: aliasIdByKey.get(link.toKey)!,
      })),
    );

    for (const batch of this.batches(links)) {
      await manager.insert(RosterIdentityCandidateLinkEntity, batch);
    }
  }

  /**
   * The columns a candidate is stored with, from what the evidence says.
   *
   * @param candidate - The candidate.
   * @param aliasIdByKey - Every alias's identifier, by its key.
   * @returns Its columns, other than its identifier and Fleet.
   */
  private candidateColumns(
    candidate: MatchedCandidate,
    aliasIdByKey: ReadonlyMap<string, string>,
  ): Partial<RosterIdentityCandidateEntity> {
    return {
      kind: candidate.kind,
      fromAliasId:
        candidate.fromAliasKey === null
          ? null
          : aliasIdByKey.get(candidate.fromAliasKey)!,
      toAliasId:
        candidate.toAliasKey === null
          ? null
          : aliasIdByKey.get(candidate.toAliasKey)!,
      fromHandleNormalised: candidate.fromHandleNormalised,
      toHandleNormalised: candidate.toHandleNormalised,
      earlierImportId: candidate.earlierImportId,
      laterImportId: candidate.laterImportId,
      confidence: candidate.confidence,
      signals: candidate.signals.map(each => ({ ...each })),
      collisionReasons: [...candidate.collisionReasons],
    };
  }

  /**
   * The row an alias is upserted with.
   *
   * @param fleetId - The Fleet.
   * @param matched - What the evidence says of it.
   * @param identity - Its identifier and identities, kept or new.
   * @returns The row.
   */
  private aliasRow(
    fleetId: string,
    matched: MatchedAlias,
    identity: Pick<
      RosterIdentityAliasEntity,
      'id' | 'identityId' | 'originIdentityId'
    >,
  ): Partial<RosterIdentityAliasEntity> {
    return {
      id: identity.id,
      fleetId,
      identityId: identity.identityId,
      originIdentityId: identity.originIdentityId,
      characterName: matched.characterName,
      characterNameNormalised: matched.characterNameNormalised,
      accountHandle: matched.accountHandle,
      accountHandleNormalised: matched.accountHandleNormalised,
      firstObservedAt: matched.firstObservedAt,
      lastObservedAt: matched.lastObservedAt,
    };
  }

  /**
   * Whether a stored alias differs from what the evidence now says of it.
   *
   * @param stored - The stored alias.
   * @param matched - What the evidence says.
   * @returns True if its spelling or observed dates changed.
   */
  private aliasChanged(
    stored: RosterIdentityAliasEntity,
    matched: MatchedAlias,
  ): boolean {
    return (
      stored.characterName !== matched.characterName ||
      stored.accountHandle !== matched.accountHandle ||
      stored.firstObservedAt?.getTime() !== matched.firstObservedAt.getTime() ||
      stored.lastObservedAt?.getTime() !== matched.lastObservedAt.getTime()
    );
  }

  /**
   * The key an alias is known by.
   *
   * @param alias - The alias.
   * @returns Its key.
   */
  private keyOf(
    alias: Pick<
      RosterIdentityAliasEntity,
      'characterNameNormalised' | 'accountHandleNormalised'
    >,
  ): string {
    return rosterAliasKey(
      alias.characterNameNormalised,
      alias.accountHandleNormalised,
    );
  }

  /**
   * Splits rows into batches small enough for one statement.
   *
   * @param rows - The rows.
   * @returns The batches, none of them empty.
   */
  private batches<T>(rows: readonly T[]): T[][] {
    const batches: T[][] = [];

    for (
      let start = 0;
      start < rows.length;
      start += ROSTER_IDENTITY_WRITE_BATCH
    ) {
      batches.push(rows.slice(start, start + ROSTER_IDENTITY_WRITE_BATCH));
    }

    return batches;
  }
}
