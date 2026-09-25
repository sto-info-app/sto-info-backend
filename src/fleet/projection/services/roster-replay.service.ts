import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager, In, IsNull, LessThan } from 'typeorm';

import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { rosterIdentityLockKey } from '../../identity/constants/roster-identity.constants';
import { RosterIdentityAliasEntity } from '../../identity/entities/roster-identity-alias.entity';
import {
  RosterIdentityRecomputeService,
  RosterIdentityRecomputeSummary,
} from '../../identity/services/roster-identity-recompute.service';
import {
  rosterAliasKey,
  RosterIdentitySnapshot,
} from '../../identity/utilities/roster-identity-matcher';
import { RosterImportSourceEntity } from '../../imports/entities/roster-import-source.entity';
import { RosterObservationEntity } from '../../imports/entities/roster-observation.entity';
import { rosterRowFullHandle } from '../../imports/utilities/roster-identity.utility';
import { CharacterFleetProposalService } from '../../services/character-fleet-proposal.service';
import { ROSTER_PROJECTION_WRITE_BATCH } from '../constants/roster-replay.constants';
import { RosterChangeEntity } from '../entities/roster-change.entity';
import { RosterEpisodeEntity } from '../entities/roster-episode.entity';
import { RosterIntervalSummaryEntity } from '../entities/roster-interval-summary.entity';
import { RosterProjectionInputEntity } from '../entities/roster-projection-input.entity';
import { RosterProjectionEntity } from '../entities/roster-projection.entity';
import {
  ProjectorSnapshot,
  RosterProjection,
  RosterProjector,
} from '../utilities/roster-projector';
import {
  RosterReplayEvidence,
  RosterReplayEvidenceService,
} from './roster-replay-evidence.service';

/** What one replay did, in counts. Nothing a roster row said. */
export interface RosterReplaySummary {
  /** Whether a revision was built, or the published one already covered it. */
  readonly built: boolean;
  /** The published revision once it finished. */
  readonly revision: number;
  /** Effective exports read, when built. */
  readonly imports: number;
  /** Episodes, changes and intervals written, when built. */
  readonly episodes: number;
  readonly changes: number;
  readonly intervals: number;
  /** What the identity recompute did, when built. */
  readonly identities: RosterIdentityRecomputeSummary | null;
  /** Registered Characters with a proposal from this Fleet open. */
  readonly proposed: number;
}

/** What the transaction hands back to the steps after it. */
interface Published {
  readonly projection: RosterProjectionEntity | null;
  readonly counts: Omit<RosterReplaySummary, 'revision' | 'proposed'>;
}

/** Counts for a replay that built nothing. */
const NOTHING_BUILT: Published['counts'] = {
  built: false,
  imports: 0,
  episodes: 0,
  changes: 0,
  intervals: 0,
  identities: null,
};

/**
 * Replays a Fleet's roster: identities, then history, as one revision
 * (FC-019).
 *
 * Plan section 3.6 point 10: an insertion, exclusion, correction or identity
 * decision takes the Fleet's lock, bumps its revision and rebuilds from the
 * whole of its effective history, and publishes one complete revision
 * atomically. Steve decided on 25 September 2026 that identities and history
 * are one job and one revision, built beside the published one and then
 * switched to.
 *
 * ## One transaction, under the Fleet's lock
 *
 * The lock is the one FC-018's reviewers take to decide a rename, so a
 * decision and a replay never interleave. Within it:
 *
 * 1. The Fleet's `requested` counter is read. If `built` has already reached
 *    it, somebody else's replay covered this request and nothing is built:
 *    that is how a duplicate or retried job costs nothing.
 * 2. {@link RosterReplayEvidenceService} decides which exports are effective
 *    and reads them.
 * 3. {@link RosterIdentityRecomputeService} brings aliases, candidates and
 *    identities into line with them.
 * 4. {@link RosterProjector} builds episodes, changes and intervals from the
 *    identities that leaves.
 * 5. The next revision's rows are written beside the published one's, and
 *    the projection row moves to it, with `built` set to the value read in
 *    step 1. The revision before it is kept for readers that pinned it; any
 *    older is deleted.
 * 6. The Fleet's last effective import follows the revision, back as well as
 *    forward: Steve's decision of 25 September 2026.
 *
 * A crash anywhere rolls all of it back, and the retried job starts again
 * from the same evidence.
 *
 * ## Then proposals, outside it
 *
 * Character Fleet proposals are raised only when the latest effective export
 * differs from the one they were last raised from, and that is recorded once
 * they have been. So a replay that changed history but not the latest export
 * asks nobody anything again, and one that crashed after publishing is
 * finished by the next replay of the Fleet, even one with nothing to build.
 * Each proposal is its own transaction over its Character, as FC-018 built
 * it, and only exact names are proposed, never one reached through a rename.
 */
@Injectable()
export class RosterReplayService {
  private readonly _logger = new Logger(RosterReplayService.name);

  private readonly _projector = new RosterProjector();

  /**
   * Creates an instance of RosterReplayService.
   *
   * @param _dataSource - The connection the replay takes its transaction on.
   * @param _evidence - Decides and reads what the replay is built from.
   * @param _identities - Works the Fleet's identities out again.
   * @param _proposals - Raises a proposal where the rules allow one.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _evidence: RosterReplayEvidenceService,
    private readonly _identities: RosterIdentityRecomputeService,
    private readonly _proposals: CharacterFleetProposalService,
  ) {}

  /**
   * Replays one Fleet, if anything has asked for it since the last replay.
   *
   * @param fleetId - The Fleet.
   * @returns What it did, in counts.
   */
  async replay(fleetId: string): Promise<RosterReplaySummary> {
    const published = await this._dataSource.transaction(manager =>
      this.build(manager, fleetId),
    );

    const proposed =
      published.projection === null
        ? 0
        : await this.propose(published.projection);

    const summary: RosterReplaySummary = {
      ...published.counts,
      revision: published.projection?.revision ?? 0,
      proposed,
    };

    this._logger.log(
      `[replay] Roster replayed - FleetId: ${fleetId}, ` +
        `Built: ${summary.built}, Revision: ${summary.revision}, ` +
        `Imports: ${summary.imports}, Episodes: ${summary.episodes}, ` +
        `Changes: ${summary.changes}, Intervals: ${summary.intervals}, ` +
        `Proposed: ${summary.proposed}`,
    );

    return summary;
  }

  /**
   * Builds and publishes the next revision, when one is asked for.
   *
   * @param manager - The transaction.
   * @param fleetId - The Fleet.
   * @returns The projection row as it now stands, and what was built.
   */
  private async build(
    manager: EntityManager,
    fleetId: string,
  ): Promise<Published> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      rosterIdentityLockKey(fleetId),
    ]);

    const projection = await manager.findOne(RosterProjectionEntity, {
      where: { fleetId },
    });

    if (projection === null || projection.built >= projection.requested) {
      return { projection, counts: NOTHING_BUILT };
    }

    const target = projection.requested;
    const evidence = await this._evidence.read(manager, fleetId);
    const { aliases, summary: identities } =
      await this._identities.recomputeWithin(
        manager,
        fleetId,
        this.matcherSnapshots(evidence),
      );
    const projected = this._projector.project(
      this.projectorSnapshots(evidence, aliases),
    );
    const revision = projection.revision + 1;
    const latest = evidence.snapshots[evidence.snapshots.length - 1] ?? null;

    await this.write(manager, fleetId, revision, evidence, projected);

    const published = {
      revision,
      built: target,
      publishedAt: new Date(),
      latestImportId: latest?.importId ?? null,
    };

    await manager.update(RosterProjectionEntity, { fleetId }, published);

    // The revision before this one stays for any reader that read its number
    // just before the switch; anything older has no reader left.
    for (const entity of [
      RosterChangeEntity,
      RosterEpisodeEntity,
      RosterIntervalSummaryEntity,
      RosterProjectionInputEntity,
    ]) {
      await manager.delete(entity, {
        fleetId,
        revision: LessThan(revision - 1),
      });
    }

    await manager.update(
      StoFleetEntity,
      { id: fleetId },
      { lastEffectiveImportAt: latest?.exportedAt ?? null },
    );

    return {
      projection: { ...projection, ...published },
      counts: {
        built: true,
        imports: evidence.snapshots.length,
        episodes: projected.episodes.length,
        changes: projected.changes.length,
        intervals: projected.intervals.length,
        identities,
      },
    };
  }

  /**
   * The effective exports as the identity matcher reads them.
   *
   * An excluded row is no evidence of anybody, and an export with one, or
   * marked partial, cannot show that a name is gone.
   *
   * @param evidence - The replay's evidence.
   * @returns One snapshot per effective export.
   */
  private matcherSnapshots(
    evidence: RosterReplayEvidence,
  ): RosterIdentitySnapshot[] {
    return evidence.snapshots.map(snapshot => ({
      importId: snapshot.importId,
      exportedAt: snapshot.exportedAt,
      rows: snapshot.rows.filter(row => !row.excluded),
      complete: !snapshot.partial && snapshot.rows.every(row => !row.excluded),
    }));
  }

  /**
   * The effective exports as the projector reads them, each row given the
   * identity its exact name and handle now belong to.
   *
   * Every counted row has an alias, because the matcher has just recorded
   * one for it. An excluded row names an identity only when its name and
   * handle were counted somewhere else.
   *
   * @param evidence - The replay's evidence.
   * @param aliases - Every alias of the Fleet, as the recompute left them.
   * @returns One snapshot per effective export.
   */
  private projectorSnapshots(
    evidence: RosterReplayEvidence,
    aliases: readonly RosterIdentityAliasEntity[],
  ): ProjectorSnapshot[] {
    const byKey = new Map(
      aliases.map(alias => [
        rosterAliasKey(
          alias.characterNameNormalised,
          alias.accountHandleNormalised,
        ),
        alias,
      ]),
    );
    const aliasOf = (row: {
      characterNameNormalised: string;
      accountHandleNormalised: string;
    }): RosterIdentityAliasEntity | undefined =>
      byKey.get(
        rosterAliasKey(
          row.characterNameNormalised,
          row.accountHandleNormalised,
        ),
      );

    return evidence.snapshots.map(snapshot => ({
      importId: snapshot.importId,
      exportedAt: snapshot.exportedAt,
      partial: snapshot.partial,
      rows: snapshot.rows
        .filter(row => !row.excluded)
        .map(row => {
          const alias = aliasOf(row)!;

          return {
            identityId: alias.identityId,
            aliasId: alias.id,
            characterName: row.characterName,
            accountHandle: row.accountHandle,
            guildRank: row.guildRank,
            contributionTotal: row.contributionTotal,
            joinedAt: row.joinedAt,
            joinedAtAmbiguous: row.joinedAtAmbiguous,
          };
        }),
      unknownIdentityIds: snapshot.rows
        .filter(row => row.excluded)
        .map(row => aliasOf(row)?.identityId)
        .filter((id): id is string => id !== undefined),
    }));
  }

  /**
   * Writes one revision's rows.
   *
   * Episodes before changes, which refer to them by key.
   *
   * @param manager - The transaction.
   * @param fleetId - The Fleet.
   * @param revision - The revision being built.
   * @param evidence - What it was built from.
   * @param projected - What it amounts to.
   */
  private async write(
    manager: EntityManager,
    fleetId: string,
    revision: number,
    evidence: RosterReplayEvidence,
    projected: RosterProjection,
  ): Promise<void> {
    await this.insert(
      manager,
      RosterProjectionInputEntity,
      evidence.inputs.map(input => ({
        fleetId,
        revision,
        importSourceId: input.id,
        exportedAt: input.exportedAt,
        outcome: input.outcome,
        partial: input.partial,
        excludedRows: input.excludedRows,
      })),
    );

    await this.insert(
      manager,
      RosterEpisodeEntity,
      projected.episodes.map(episode => ({
        fleetId,
        revision,
        identityId: episode.identityId,
        ordinal: episode.ordinal,
        startKind: episode.startKind,
        startedAfterImportId: episode.startedAfter?.importId ?? null,
        startedAfterAt: episode.startedAfter?.at ?? null,
        firstImportId: episode.first.importId,
        firstObservedAt: episode.first.at,
        reportedJoinedAt: episode.reportedJoinedAt,
        reportedJoinedAtAmbiguous: episode.reportedJoinedAtAmbiguous,
        lastImportId: episode.last.importId,
        lastObservedAt: episode.last.at,
        endKind: episode.endKind,
        endedBefore: episode.endedBefore,
        endedBeforeImportId: episode.endedBeforeImportId,
        baselineContribution: episode.baselineContribution,
        lastObservedContribution: episode.lastObservedContribution,
      })),
    );

    await this.insert(
      manager,
      RosterChangeEntity,
      projected.changes.map(change => ({
        fleetId,
        revision,
        identityId: change.identityId,
        episodeOrdinal: change.episodeOrdinal,
        kind: change.kind,
        fromImportId: change.from.importId,
        fromAt: change.from.at,
        toImportId: change.to.importId,
        toAt: change.to.at,
        acrossGap: change.acrossGap,
        contributionDelta: change.contributionDelta,
        detail: { ...change.detail },
      })),
    );

    await this.insert(
      manager,
      RosterIntervalSummaryEntity,
      projected.intervals.map(({ from, to, ...counts }) => ({
        fleetId,
        revision,
        fromImportId: from.importId,
        fromAt: from.at,
        toImportId: to.importId,
        toAt: to.at,
        ...counts,
      })),
    );
  }

  /**
   * Inserts rows in batches small enough for one statement.
   *
   * @param manager - The transaction.
   * @param entity - The table.
   * @param rows - The rows.
   */
  private async insert<T extends object>(
    manager: EntityManager,
    entity: new () => T,
    rows: ReadonlyArray<Partial<T>>,
  ): Promise<void> {
    for (
      let start = 0;
      start < rows.length;
      start += ROSTER_PROJECTION_WRITE_BATCH
    ) {
      await manager.insert(
        entity,
        rows.slice(start, start + ROSTER_PROJECTION_WRITE_BATCH) as never,
      );
    }
  }

  /**
   * Offers each registered Character the latest effective export names a
   * proposal, unless proposals were already raised from that export.
   *
   * A roster handle carries the game's leading `@` and an STO Info account
   * handle cannot begin with one, so it is dropped before the two are
   * compared the way a Character's own full handle is normalised. An
   * excluded row asks nobody anything.
   *
   * Recorded as raised only against the export it was raised from, so a
   * newer revision published meanwhile is left for its own replay.
   *
   * @param projection - The Fleet's projection row, as published.
   * @returns How many registered Characters have a proposal open from it.
   */
  private async propose(projection: RosterProjectionEntity): Promise<number> {
    const { fleetId, latestImportId } = projection;

    if (latestImportId === projection.proposedImportId) {
      return 0;
    }

    let proposed = 0;

    if (latestImportId !== null) {
      proposed = await this.raise(fleetId, latestImportId);
    }

    await this._dataSource.manager.update(
      RosterProjectionEntity,
      {
        fleetId,
        latestImportId: latestImportId === null ? IsNull() : latestImportId,
      },
      { proposedImportId: latestImportId },
    );

    return proposed;
  }

  /**
   * Raises the proposals one export's rows call for.
   *
   * @param fleetId - The Fleet.
   * @param importId - The export.
   * @returns How many registered Characters have a proposal open from it.
   */
  private async raise(fleetId: string, importId: string): Promise<number> {
    const manager = this._dataSource.manager;
    const record = await manager.findOneOrFail(RosterImportSourceEntity, {
      where: { id: importId },
      select: { id: true, exportedAt: true },
    });
    const rows = await manager.find(RosterObservationEntity, {
      where: { importSourceId: importId, excluded: false },
      select: { characterName: true, accountHandle: true },
    });
    const handles = [
      ...new Set(
        rows.map(row =>
          rosterRowFullHandle(row.characterName, row.accountHandle),
        ),
      ),
    ];

    if (handles.length === 0) {
      return 0;
    }

    const characters = await manager.find(CharacterEntity, {
      where: { fullHandleNormalized: In(handles) },
      select: { id: true },
    });

    let proposed = 0;

    for (const character of characters) {
      const proposal = await this._proposals.raiseFromEvidence(character.id, {
        fleetId,
        evidenceImportId: importId,
        observedAt: record.exportedAt!,
      });

      if (proposal !== null) {
        proposed += 1;
      }
    }

    return proposed;
  }
}
