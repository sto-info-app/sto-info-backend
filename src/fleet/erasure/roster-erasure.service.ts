import { randomUUID } from 'node:crypto';

import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager, In, MoreThan, Not } from 'typeorm';

import { FileAssetPlacementEntity } from 'src/file-assets/entities/file-asset-placement.entity';
import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetPlacementState } from 'src/file-assets/enums/file-asset-placement-state.enum';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { QuarantineStorageService } from 'src/file-assets/services/quarantine-storage.service';
import {
  eachLimited,
  LEDGER_CHUNK_SIZE,
  LEDGER_CONCURRENCY,
  LedgerReconciliation,
  noTimings,
  timed,
} from 'src/shared/ledger/ledger.utility';

import { FleetCommunityEntity } from '../entities/fleet-community.entity';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { RosterIdentityAliasEntity } from '../identity/entities/roster-identity-alias.entity';
import { RosterImportSourceEntity } from '../imports/entities/roster-import-source.entity';
import { RosterObservationEntity } from '../imports/entities/roster-observation.entity';
import { RosterSourceRetentionService } from '../imports/services/roster-source-retention.service';
import { RosterTypedParserService } from '../imports/services/roster-typed-parser.service';
import {
  normaliseRosterAccountHandle,
  normaliseRosterCharacterName,
} from '../imports/utilities/roster-identity.utility';
import { RosterReplayQueueService } from '../projection/services/roster-replay-queue.service';
import { usernamesFor } from '../recruitment/utilities/recruitment-names.utility';
import { ErasureLedgerService, ErasureMarker } from './erasure-ledger.service';
import { ERASED_MEMBER_NAME, pseudonymFor } from './roster-erasure.constants';
import {
  RosterErasureDto,
  RosterErasurePreviewDto,
  RosterErasureRequestDto,
  RosterErasureResultDto,
  RosterErasureTargetDto,
} from './roster-erasure.dto';
import { RosterErasureEntity } from './roster-erasure.entity';
import { RosterSuppressionService } from './roster-suppression.service';

/** Why an erasure the database lost was made again. */
export const REPLAYED_REASON =
  'Re-applied from the erasure ledger after a database restore.';

/** A pair of a normalised Character name and @handle. */
interface NormalisedPair {
  readonly characterName: string;
  readonly accountHandle: string;
}

/** What scrubbing the stored rows came to. */
interface Scrubbed {
  readonly observations: number;
  readonly aliases: number;
  readonly fleetIds: readonly string[];
  /** The imports whose rows named them: their files go too. */
  readonly importIds: readonly string[];
}

/**
 * Verified erasure of somebody's roster data (FC-038).
 *
 * Steve's decisions of 29 September 2026:
 *
 * - **Who.** A site admin, after verifying the person off-site, erases a
 *   Character name and @handle from every Fleet's roster, with a reason.
 *   Personal unassociation — a player declining or retracting a Character's
 *   link to a Fleet — is theirs, is separate, and erases nothing.
 * - **How.** Anonymised, not deleted: the name becomes "Erased member", the
 *   handle a pseudonym of the erasure's own and the public comment goes, in
 *   every roster row and identity alias. Joins, departures and counts stay,
 *   so each Fleet's history still adds up. Every stored file naming them is
 *   deleted; a held import whose file goes is retired.
 * - **Staying erased.** The keyed hash of the pair joins the suppression
 *   list every import is scrubbed against, and each affected Fleet is
 *   replayed from the scrubbed rows.
 * - **Restores.** Each erasure's marker is written to the ledger first; at
 *   every boot, before the API serves anything, the restore check (FC-042)
 *   runs {@link reconcileLedger}, which makes again any the database lost.
 */
@Injectable()
export class RosterErasureService {
  private readonly _logger = new Logger(RosterErasureService.name);

  /**
   * Creates an instance of RosterErasureService.
   *
   * @param _dataSource - The database.
   * @param _suppression - Hashes pairs, keyed.
   * @param _ledger - Keeps each marker outside the database.
   * @param _sources - Deletes the files that name them.
   * @param _replays - Replays each Fleet affected.
   * @param _storage - Reads held and pending files.
   * @param _parser - Reads a sanitised file's rows.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _suppression: RosterSuppressionService,
    private readonly _ledger: ErasureLedgerService,
    private readonly _sources: RosterSourceRetentionService,
    private readonly _replays: RosterReplayQueueService,
    private readonly _storage: QuarantineStorageService,
    private readonly _parser: RosterTypedParserService,
  ) {}

  /**
   * What an erasure would touch.
   *
   * @param target - Whose.
   * @returns Whether they are already erased, and the Fleets naming them.
   */
  async preview(
    target: RosterErasureTargetDto,
  ): Promise<RosterErasurePreviewDto> {
    const manager = this._dataSource.manager;
    const pair = pairOf(target);
    const alreadyErased = await manager.exists(RosterErasureEntity, {
      where: {
        pairHash: this._suppression.hashOfNormalised(
          pair.characterName,
          pair.accountHandle,
        ),
      },
    });
    const rows = await manager.find(RosterObservationEntity, {
      where: {
        characterNameNormalised: pair.characterName,
        accountHandleNormalised: pair.accountHandle,
      },
      select: { id: true, fleetId: true },
    });
    const perFleet = new Map<string, number>();

    for (const row of rows) {
      perFleet.set(row.fleetId, (perFleet.get(row.fleetId) ?? 0) + 1);
    }

    return {
      alreadyErased,
      rows: rows.length,
      fleets: await this.fleetsOf(manager, perFleet),
    };
  }

  /**
   * Erases somebody's roster data.
   *
   * @param adminId - The site admin.
   * @param request - Whose, and why.
   * @returns The erasure, with what became of the files.
   * @throws ConflictException when they are already erased.
   */
  async erase(
    adminId: string,
    request: RosterErasureRequestDto,
  ): Promise<RosterErasureResultDto> {
    const pair = pairOf(request);
    const pairHash = this._suppression.hashOfNormalised(
      pair.characterName,
      pair.accountHandle,
    );

    if (
      await this._dataSource.manager.exists(RosterErasureEntity, {
        where: { pairHash },
      })
    ) {
      throw new ConflictException('They are already erased.');
    }

    const id = randomUUID();
    const marker: ErasureMarker = {
      id,
      pairHash,
      pseudonym: pseudonymFor(id),
      createdAt: new Date().toISOString(),
    };

    // The ledger first: an erasure the database has is one a restore can
    // lose, and the ledger is what brings it back.
    await this._ledger.write(marker);

    const { erasure, scrubbed } = await this.record(marker, [pair], {
      reason: request.reason,
      adminUserId: adminId,
      replayed: false,
    });
    const files = await this.eraseFiles(scrubbed.importIds, [pair]);

    this._logger.log(
      `[erase] Roster data erased - ErasureId: ${id}, ` +
        `Observations: ${scrubbed.observations}, Files: ${files.deleted}`,
    );

    return {
      ...(await this.toDtos([erasure]))[0],
      filesDeleted: files.deleted,
      filesPending: files.notDeleted,
    };
  }

  /**
   * Every erasure, newest first.
   *
   * @returns Each.
   */
  async list(): Promise<RosterErasureDto[]> {
    return this.toDtos(
      await this._dataSource.manager.find(RosterErasureEntity, {
        order: { createdAt: 'DESC', id: 'DESC' },
      }),
    );
  }

  /**
   * Checks the erasure ledger against the database, at boot (FC-042): makes
   * again, oldest first, every erasure in the ledger that the database has
   * lost, as after a restore from a backup older than it, and writes a
   * marker for every erasure the ledger lacks, as for one made before the
   * ledger was complete. Only the markers the database lacks are read.
   *
   * A marker whose pair the database already holds under another erasure is
   * left: the pair is erased, and a second erasure of it cannot be written.
   *
   * @returns What the check came to.
   */
  async reconcileLedger(): Promise<LedgerReconciliation> {
    const timings = noTimings();
    const keys = await timed(timings, 'list', () => this._ledger.listKeys());
    const { lost, unmarked, hashes } = await timed(
      timings,
      'compare',
      async () => {
        const known = await this.allErasures();
        const marked = new Set(keys.map(key => key.id));
        const ids = new Set(known.map(erasure => erasure.id));

        return {
          lost: keys.filter(key => !ids.has(key.id)),
          unmarked: known.filter(erasure => !marked.has(erasure.id)),
          hashes: new Set(known.map(erasure => erasure.pairHash)),
        };
      },
    );
    let alreadyErased = 0;
    const replayed = await timed(timings, 'replay', async () => {
      if (lost.length === 0) {
        return 0;
      }

      const pairsOf = await this.pairsByHash();
      let made = 0;

      for (const key of lost) {
        const marker = await this._ledger.read(key.key);

        if (hashes.has(marker.pairHash)) {
          alreadyErased++;
          continue;
        }

        const pairs = pairsOf.get(marker.pairHash) ?? [];
        const { scrubbed } = await this.record(marker, pairs, {
          reason: REPLAYED_REASON,
          adminUserId: null,
          replayed: true,
        });

        await this.eraseFiles(scrubbed.importIds, pairs);
        hashes.add(marker.pairHash);
        made++;
      }

      return made;
    });
    const backfilled = await timed(timings, 'backfill', async () => {
      await eachLimited(unmarked, LEDGER_CONCURRENCY, erasure =>
        this._ledger.write({
          id: erasure.id,
          pairHash: erasure.pairHash,
          pseudonym: erasure.pseudonym,
          createdAt: erasure.createdAt.toISOString(),
        }),
      );

      return unmarked.length;
    });

    this._logger.log(
      `[reconcileLedger] Erasure ledger checked - Markers: ${keys.length}, ` +
        `Replayed: ${replayed}, AlreadyErased: ${alreadyErased}, ` +
        `Backfilled: ${backfilled}`,
    );

    return {
      markers: keys.length,
      replayed,
      backfilled,
      detail: { alreadyErased },
      timings,
    };
  }

  /**
   * Every erasure's ID, hash, pseudonym and time, read a chunk at a time.
   *
   * @returns Each.
   */
  private async allErasures(): Promise<RosterErasureEntity[]> {
    const all: RosterErasureEntity[] = [];
    let page: RosterErasureEntity[];

    do {
      const after = all.length === 0 ? null : all[all.length - 1].id;

      page = await this._dataSource.manager.find(RosterErasureEntity, {
        where: after === null ? {} : { id: MoreThan(after) },
        select: { id: true, pairHash: true, pseudonym: true, createdAt: true },
        order: { id: 'ASC' },
        take: LEDGER_CHUNK_SIZE,
      });
      all.push(...page);
    } while (page.length === LEDGER_CHUNK_SIZE);

    return all;
  }

  /**
   * Records an erasure and scrubs the rows it names, in one transaction, and
   * asks for each affected Fleet to be replayed.
   *
   * @param marker - The erasure.
   * @param pairs - The pairs it names: one, or none left to find.
   * @param entry - Why, who, and whether it is a replay.
   * @param entry.reason - Why.
   * @param entry.adminUserId - The site admin, or null.
   * @param entry.replayed - Whether it came from the ledger.
   * @returns The erasure and what was scrubbed.
   */
  private async record(
    marker: ErasureMarker,
    pairs: readonly NormalisedPair[],
    entry: {
      readonly reason: string;
      readonly adminUserId: string | null;
      readonly replayed: boolean;
    },
  ): Promise<{ erasure: RosterErasureEntity; scrubbed: Scrubbed }> {
    const done = await this._dataSource.transaction(async manager => {
      const scrubbed = await this.scrub(manager, pairs, marker.pseudonym);
      const erasure = await manager.save(RosterErasureEntity, {
        id: marker.id,
        pairHash: marker.pairHash,
        pseudonym: marker.pseudonym,
        reason: entry.reason,
        adminUserId: entry.adminUserId,
        replayed: entry.replayed,
        counts: {
          observations: scrubbed.observations,
          aliases: scrubbed.aliases,
          fleets: scrubbed.fleetIds.length,
        },
        createdAt: new Date(marker.createdAt),
      });

      for (const fleetId of scrubbed.fleetIds) {
        await this._replays.request(manager, fleetId);
      }

      return { erasure, scrubbed };
    });

    for (const fleetId of done.scrubbed.fleetIds) {
      await this._replays.enqueue(fleetId);
    }

    return done;
  }

  /**
   * Rewrites every roster row and alias naming a pair.
   *
   * @param manager - The transaction.
   * @param pairs - The pairs.
   * @param pseudonym - The handle that replaces theirs.
   * @returns What was scrubbed.
   */
  private async scrub(
    manager: EntityManager,
    pairs: readonly NormalisedPair[],
    pseudonym: string,
  ): Promise<Scrubbed> {
    const erased = {
      characterName: ERASED_MEMBER_NAME,
      characterNameNormalised: normaliseRosterCharacterName(ERASED_MEMBER_NAME),
      accountHandle: pseudonym,
      accountHandleNormalised: normaliseRosterAccountHandle(pseudonym),
    };
    const fleetIds = new Set<string>();
    const importIds = new Set<string>();
    let observations = 0;
    let aliases = 0;

    for (const pair of pairs) {
      const where = {
        characterNameNormalised: pair.characterName,
        accountHandleNormalised: pair.accountHandle,
      };
      const rows = await manager.find(RosterObservationEntity, {
        where,
        select: { id: true, fleetId: true, importSourceId: true },
      });
      const named = await manager.find(RosterIdentityAliasEntity, {
        where,
        select: { id: true, fleetId: true },
      });

      for (const row of rows) {
        fleetIds.add(row.fleetId);
        importIds.add(row.importSourceId);
      }

      for (const alias of named) {
        fleetIds.add(alias.fleetId);
      }

      if (rows.length > 0) {
        await manager.update(
          RosterObservationEntity,
          { id: In(rows.map(row => row.id)) },
          { ...erased, publicComment: '' },
        );
      }

      if (named.length > 0) {
        await manager.update(
          RosterIdentityAliasEntity,
          { id: In(named.map(alias => alias.id)) },
          erased,
        );
      }

      observations += rows.length;
      aliases += named.length;
    }

    return {
      observations,
      aliases,
      fleetIds: [...fleetIds],
      importIds: [...importIds],
    };
  }

  /**
   * Deletes every stored file naming a pair: those of imports read into
   * rows, and any held or still pending that list them.
   *
   * @param importIds - The imports whose rows named them.
   * @param pairs - The pairs.
   * @returns What deleting them came to.
   */
  private async eraseFiles(
    importIds: readonly string[],
    pairs: readonly NormalisedPair[],
  ): Promise<{ deleted: number; notDeleted: number }> {
    const unread = await this.unreadNaming(pairs);
    const done = await this._sources.erase([
      ...new Set([...importIds, ...unread]),
    ]);

    return { deleted: done.deleted, notDeleted: done.notDeleted };
  }

  /**
   * The held and pending imports whose files list a pair. They have no rows
   * yet, so each file is read.
   *
   * @param pairs - The pairs.
   * @returns Their IDs.
   */
  private async unreadNaming(
    pairs: readonly NormalisedPair[],
  ): Promise<string[]> {
    if (pairs.length === 0) {
      return [];
    }

    const manager = this._dataSource.manager;
    const placements = await manager.find(FileAssetPlacementEntity, {
      where: {
        subject: FileAssetSubject.ROSTER_IMPORT,
        state: In([
          FileAssetPlacementState.HELD,
          FileAssetPlacementState.PENDING,
        ]),
      },
      select: { id: true, subjectId: true, assetId: true },
    });
    const assets = new Map(
      (placements.length === 0
        ? []
        : await manager.find(FileAssetEntity, {
            where: {
              id: In(placements.map(placement => placement.assetId)),
              state: Not(FileAssetState.DELETED),
            },
          })
      ).map(asset => [asset.id, asset]),
    );
    const keys = new Set(
      pairs.map(pair => `${pair.characterName}\n${pair.accountHandle}`),
    );
    const naming: string[] = [];

    for (const placement of placements) {
      const asset = assets.get(placement.assetId);

      if (asset?.objectKey == null) {
        continue;
      }

      const record = await manager.findOne(RosterImportSourceEntity, {
        where: { id: placement.subjectId },
        select: { id: true, exportTimezone: true },
      });
      const { rows } = this._parser.read(
        await this._storage.read(asset.objectKey, asset.objectVersion),
        record?.exportTimezone ?? 'UTC',
      );

      if (
        rows.some(row =>
          keys.has(
            `${normaliseRosterCharacterName(row.characterName)}\n` +
              normaliseRosterAccountHandle(row.accountHandle),
          ),
        )
      ) {
        naming.push(placement.subjectId);
      }
    }

    return naming;
  }

  /**
   * The stored pairs by their keyed hash: how a marker, which holds no name,
   * finds what it erased. Read once for every marker a check replays.
   *
   * @returns The pairs hashing to each hash: one, as a rule.
   */
  private async pairsByHash(): Promise<Map<string, NormalisedPair[]>> {
    const manager = this._dataSource.manager;
    const seen = new Map<string, NormalisedPair>();

    for (const entity of [RosterObservationEntity, RosterIdentityAliasEntity]) {
      const rows: Array<{
        characterNameNormalised: string;
        accountHandleNormalised: string;
      }> = await manager
        .createQueryBuilder(entity, 'row')
        .select('row.characterNameNormalised', 'characterNameNormalised')
        .addSelect('row.accountHandleNormalised', 'accountHandleNormalised')
        .distinct(true)
        .getRawMany();

      for (const row of rows) {
        seen.set(
          `${row.characterNameNormalised}\n${row.accountHandleNormalised}`,
          {
            characterName: row.characterNameNormalised,
            accountHandle: row.accountHandleNormalised,
          },
        );
      }
    }

    const byHash = new Map<string, NormalisedPair[]>();

    for (const pair of seen.values()) {
      const hash = this._suppression.hashOfNormalised(
        pair.characterName,
        pair.accountHandle,
      );

      byHash.set(hash, [...(byHash.get(hash) ?? []), pair]);
    }

    return byHash;
  }

  /**
   * Names the Fleets in a count.
   *
   * @param manager - The manager.
   * @param perFleet - Rows per Fleet.
   * @returns Each Fleet, named, most rows first.
   */
  private async fleetsOf(
    manager: EntityManager,
    perFleet: ReadonlyMap<string, number>,
  ): Promise<RosterErasurePreviewDto['fleets']> {
    if (perFleet.size === 0) {
      return [];
    }

    const fleets = await manager.find(StoFleetEntity, {
      where: { id: In([...perFleet.keys()]) },
      select: { id: true, exactGameName: true, communityId: true },
    });
    const communityIds = fleets
      .map(fleet => fleet.communityId)
      .filter((id): id is string => id !== null);
    const communities = new Map(
      (communityIds.length === 0
        ? []
        : await manager.find(FleetCommunityEntity, {
            where: { id: In(communityIds) },
            select: { id: true, name: true },
          })
      ).map(community => [community.id, community.name]),
    );

    return fleets
      .map(fleet => ({
        fleetId: fleet.id,
        fleetName: fleet.exactGameName,
        communityName:
          fleet.communityId === null
            ? null
            : (communities.get(fleet.communityId) ?? null),
        rows: perFleet.get(fleet.id)!,
      }))
      .sort(
        (a, b) => b.rows - a.rows || a.fleetName.localeCompare(b.fleetName),
      );
  }

  /**
   * Shows erasures, with who made them.
   *
   * @param erasures - The erasures.
   * @returns Each.
   */
  private async toDtos(
    erasures: readonly RosterErasureEntity[],
  ): Promise<RosterErasureDto[]> {
    const names = await usernamesFor(
      this._dataSource.manager,
      erasures.map(erasure => erasure.adminUserId),
    );

    return erasures.map(erasure => ({
      id: erasure.id,
      pseudonym: erasure.pseudonym,
      reason: erasure.reason,
      admin:
        erasure.adminUserId === null
          ? null
          : {
              userId: erasure.adminUserId,
              username: names.get(erasure.adminUserId) ?? null,
            },
      replayed: erasure.replayed,
      observations: erasure.counts.observations ?? 0,
      aliases: erasure.counts.aliases ?? 0,
      fleets: erasure.counts.fleets ?? 0,
      createdAt: erasure.createdAt,
    }));
  }
}

/**
 * A target's name and handle, normalised as stored rows hold them.
 *
 * @param target - Whose.
 * @returns The pair.
 */
function pairOf(target: RosterErasureTargetDto): NormalisedPair {
  return {
    characterName: normaliseRosterCharacterName(target.characterName),
    accountHandle: normaliseRosterAccountHandle(target.accountHandle),
  };
}
