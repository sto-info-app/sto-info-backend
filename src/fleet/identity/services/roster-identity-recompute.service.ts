import { randomUUID } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';

import { FileAssetPlacementEntity } from 'src/file-assets/entities/file-asset-placement.entity';
import { FileAssetPlacementState } from 'src/file-assets/enums/file-asset-placement-state.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { normalizeHandle } from 'src/shared/utilities/handle.utility';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { RosterImportSourceEntity } from '../../imports/entities/roster-import-source.entity';
import { RosterObservationEntity } from '../../imports/entities/roster-observation.entity';
import { CharacterFleetProposalService } from '../../services/character-fleet-proposal.service';
import {
  ROSTER_IDENTITY_WRITE_BATCH,
  rosterIdentityLockKey,
} from '../constants/roster-identity.constants';
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
  /** In-force exports read. */
  readonly imports: number;
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
  /** Registered Characters with a proposal from this Fleet open. */
  readonly proposed: number;
}

/**
 * Works a Fleet's roster identities out again from its evidence and its
 * reviewers' decisions.
 *
 * Plan section 3.6 allows a full replay of a Fleet in v1 because an identity
 * decision can change conclusions drawn from any export, and Steve chose on
 * 24 September 2026 to recompute the whole Fleet each time rather than patch
 * it import by import: an older export imported late has to be able to undo
 * a suggestion it now sits in the middle of, and only a full pass sees that.
 *
 * ## One pass, under a lock
 *
 * A transaction-scoped advisory lock on the Fleet serialises recomputes, so
 * two queued for one Fleet run one after the other and the second reads what
 * the first wrote. Within it:
 *
 * 1. Every in-force import is read in export order through
 *    {@link RosterIdentityMatcher}. Held, refused and pending imports are not
 *    in force and are not read.
 * 2. Aliases are upserted by their exact key, so an alias keeps its UUID and
 *    its identity across recomputes; one no in-force export lists any more
 *    keeps its row with its observed dates cleared.
 * 3. Candidates are brought into line by {@link planCandidates}: a decided
 *    one is never changed, only flagged when its evidence moves.
 * 4. Identities are reassigned by {@link assignIdentities} from the links of
 *    every confirmed candidate.
 *
 * Nothing about any observation is written: the alias table is the join.
 *
 * ## Then proposals, outside it
 *
 * Once the identities are committed, every registered Character that the
 * latest in-force export names exactly, by Character name and account handle,
 * is handed to {@link CharacterFleetProposalService.raiseFromEvidence}, which
 * decides whether to ask. Each is its own transaction there, over the locked
 * Character, so a proposal is never held up by the Fleet's lock and a
 * Character's owner answering is never held up by a Fleet's recompute.
 *
 * Only exact names are proposed, never one reached through a rename: Steve's
 * decision of 24 September 2026, and ADR-0002's rule that nothing inferred
 * reaches a person's own history without them.
 */
@Injectable()
export class RosterIdentityRecomputeService {
  private readonly _logger = new Logger(RosterIdentityRecomputeService.name);

  /**
   * Creates an instance of RosterIdentityRecomputeService.
   *
   * @param _dataSource - The connection the recompute takes its transaction
   *   on.
   * @param _proposals - Raises a proposal where the rules allow one.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _proposals: CharacterFleetProposalService,
  ) {}

  /**
   * Recomputes one Fleet.
   *
   * @param fleetId - The Fleet.
   * @returns What it did, in counts.
   */
  async recompute(fleetId: string): Promise<RosterIdentityRecomputeSummary> {
    const worked = await this._dataSource.transaction(async manager => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        rosterIdentityLockKey(fleetId),
      ]);

      const evidence = await this.readEvidence(manager, fleetId);
      const aliases = await this.saveAliases(manager, fleetId, evidence.match);
      const candidates = await this.saveCandidates(
        manager,
        fleetId,
        evidence.match,
        aliases,
      );
      const reassigned = await this.assign(manager, fleetId, aliases);

      return { ...evidence, aliases, candidates, reassigned };
    });

    const proposed =
      worked.latest === null ? 0 : await this.propose(fleetId, worked.latest);

    const summary: RosterIdentityRecomputeSummary = {
      imports: worked.imports,
      aliases: worked.aliases.length,
      inserted: worked.candidates.inserted,
      refreshed: worked.candidates.refreshed,
      restaled: worked.candidates.restaled,
      deleted: worked.candidates.deleted,
      reassigned: worked.reassigned,
      proposed,
    };

    this._logger.log(
      `[recompute] Roster identities recomputed - FleetId: ${fleetId}, ` +
        `Imports: ${summary.imports}, Aliases: ${summary.aliases}, ` +
        `Inserted: ${summary.inserted}, Refreshed: ${summary.refreshed}, ` +
        `Restaled: ${summary.restaled}, Deleted: ${summary.deleted}, ` +
        `Reassigned: ${summary.reassigned}, Proposed: ${summary.proposed}`,
    );

    return summary;
  }

  /**
   * Reads every in-force export of a Fleet through the matcher.
   *
   * Two in-force imports claiming one instant have the same sanitised
   * contents, because any that differ are held in a conflict group rather
   * than put in force, so the second says nothing the first did not and is
   * passed over.
   *
   * @param manager - The transaction to read through.
   * @param fleetId - The Fleet.
   * @returns What the exports amount to, how many were read and the latest.
   */
  private async readEvidence(
    manager: EntityManager,
    fleetId: string,
  ): Promise<{
    match: RosterIdentityMatch;
    imports: number;
    latest: RosterIdentitySnapshot | null;
  }> {
    const matcher = new RosterIdentityMatcher();
    const records = await manager.find(RosterImportSourceEntity, {
      where: { fleetId, exportedAt: Not(IsNull()) },
      select: { id: true, exportedAt: true },
      order: { exportedAt: 'ASC', id: 'ASC' },
    });

    if (records.length === 0) {
      return { match: matcher.result(), imports: 0, latest: null };
    }

    const placements = await manager.find(FileAssetPlacementEntity, {
      where: {
        subject: FileAssetSubject.ROSTER_IMPORT,
        state: FileAssetPlacementState.ACTIVE,
        subjectId: In(records.map(record => record.id)),
      },
      select: { subjectId: true },
    });
    const inForce = new Set(placements.map(placement => placement.subjectId));

    let latest: RosterIdentitySnapshot | null = null;
    let imports = 0;

    for (const record of records) {
      const exportedAt = record.exportedAt!;

      if (
        !inForce.has(record.id) ||
        latest?.exportedAt.getTime() === exportedAt.getTime()
      ) {
        continue;
      }

      const observations = await manager.find(RosterObservationEntity, {
        where: { importSourceId: record.id },
        select: {
          characterName: true,
          characterNameNormalised: true,
          accountHandle: true,
          accountHandleNormalised: true,
          level: true,
          className: true,
          contributionTotal: true,
          joinedAt: true,
          joinedAtAmbiguous: true,
          rankChangedAt: true,
          rankChangedAtAmbiguous: true,
        },
        order: { line: 'ASC' },
      });

      latest = {
        importId: record.id,
        exportedAt,
        rows: observations,
        complete: true,
      };
      matcher.add(latest);
      imports += 1;
    }

    return { match: matcher.result(), imports, latest };
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
   * Offers each registered Character the latest export names a proposal.
   *
   * A roster handle carries the game's leading `@` and an STO Info account
   * handle cannot begin with one, so it is dropped before the two are
   * compared the way a Character's own full handle is normalised.
   *
   * @param fleetId - The Fleet.
   * @param latest - Its latest in-force export.
   * @returns How many registered Characters have a proposal open from it.
   */
  private async propose(
    fleetId: string,
    latest: RosterIdentitySnapshot,
  ): Promise<number> {
    const handles = [
      ...new Set(
        latest.rows.map(row =>
          normalizeHandle(
            `${row.characterName}@${row.accountHandle.replace(/^@/, '')}`,
          ),
        ),
      ),
    ];

    if (handles.length === 0) {
      return 0;
    }

    const characters = await this._dataSource.manager.find(CharacterEntity, {
      where: { fullHandleNormalized: In(handles) },
      select: { id: true },
    });

    let proposed = 0;

    for (const character of characters) {
      const proposal = await this._proposals.raiseFromEvidence(character.id, {
        fleetId,
        evidenceImportId: latest.importId,
        observedAt: latest.exportedAt,
      });

      if (proposal !== null) {
        proposed += 1;
      }
    }

    return proposed;
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
