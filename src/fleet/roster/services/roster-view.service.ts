import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository, SelectQueryBuilder } from 'typeorm';

import { escapeSqlLikeTerm } from 'src/shared/utilities/sql-like.utility';

import { RosterIdentityAliasEntity } from '../../identity/entities/roster-identity-alias.entity';
import { RosterObservationEntity } from '../../imports/entities/roster-observation.entity';
import {
  normaliseRosterCharacterName,
  rosterRowFullHandle,
} from '../../imports/utilities/roster-identity.utility';
import { compareText } from '../../projection/utilities/compare-text.utility';
import {
  RosterExportDto,
  RosterExportRefDto,
  RosterPageDto,
  RosterRankCountDto,
  RosterRowDto,
} from '../dto/roster-page.dto';
import { RosterQueryDto } from '../dto/roster-query.dto';
import { RosterRankOrderEntity } from '../entities/roster-rank-order.entity';
import { RosterSort, RosterSortDirection } from '../enums/roster-sort.enum';
import {
  EffectiveRosterExport,
  PublishedRosterRevisionService,
} from './published-roster-revision.service';
import { RosterProfileLinkService } from './roster-profile-link.service';

/** How many rows a roster page carries unless asked for fewer. */
export const ROSTER_PAGE_SIZE = 50;

/** Who is reading a roster, as far as it changes what they see. */
export interface RosterViewer {
  /** The reader. */
  readonly userId: string;
  /**
   * Whether they investigate the Fleet's rosters, and so are shown the rows
   * an investigator excluded.
   */
  readonly investigator: boolean;
}

/** The column each ordering sorts by first. */
const SORT_COLUMNS: Readonly<Record<RosterSort, string>> = {
  [RosterSort.NAME]: 'o.characterNameNormalised',
  [RosterSort.HANDLE]: 'o.accountHandleNormalised',
  [RosterSort.RANK]: 'r.tier',
  [RosterSort.LEVEL]: 'o.level',
  [RosterSort.JOINED]: 'o.joinedAt',
  [RosterSort.CONTRIBUTION]: 'o.contributionTotal',
  [RosterSort.LAST_ACTIVE]: 'o.lastActiveAt',
};

/**
 * Reads a Fleet's roster as one effective export listed it (FC-020).
 *
 * Open to `roster.view` holders — a Fleet's approved members and up — who
 * are shown handles, Public Comments and Last Active (plan R10). Officer
 * fields never reach it: the parser discarded them before anything was
 * stored.
 *
 * The export is chosen from the published revision's effective exports, the
 * last at or before `asOf` (Steve's decision of 25 September 2026), so a
 * roster never shows an export the history does not stand on: an excluded
 * one, or one not selected for its moment. A row an investigator excluded is
 * shown to investigators alone, marked.
 */
@Injectable()
export class RosterViewService {
  /**
   * Creates an instance of RosterViewService.
   *
   * @param _revisions - Pins the reader to the published revision.
   * @param _observations - Every row of every export.
   * @param _aliases - Which member each name and handle belongs to.
   * @param _rankOrder - Where each rank label sits in the Fleet's order.
   * @param _profileLinks - Decides which rows may link to a registry page.
   */
  constructor(
    private readonly _revisions: PublishedRosterRevisionService,
    @InjectRepository(RosterObservationEntity)
    private readonly _observations: Repository<RosterObservationEntity>,
    @InjectRepository(RosterIdentityAliasEntity)
    private readonly _aliases: Repository<RosterIdentityAliasEntity>,
    @InjectRepository(RosterRankOrderEntity)
    private readonly _rankOrder: Repository<RosterRankOrderEntity>,
    private readonly _profileLinks: RosterProfileLinkService,
  ) {}

  /**
   * Reads one page of a Fleet's roster.
   *
   * @param fleetId - The Fleet.
   * @param query - The export, page, ordering and filters asked for.
   * @param viewer - Who is reading.
   * @returns The page, with the revision and export it was read from.
   */
  async page(
    fleetId: string,
    query: RosterQueryDto,
    viewer: RosterViewer,
  ): Promise<RosterPageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? ROSTER_PAGE_SIZE;
    const pinned = await this._revisions.pin(fleetId);
    const effective = await this._revisions.effectiveExports(
      fleetId,
      pinned.revision,
    );
    const empty: RosterPageDto = {
      ...pinned,
      coverage: {
        exports: effective.length,
        first: effective.length > 0 ? toRef(effective[0]) : null,
        latest:
          effective.length > 0 ? toRef(effective[effective.length - 1]) : null,
      },
      export: null,
      ranks: [],
      items: [],
      total: 0,
      page,
      pageSize,
    };

    const index = chooseExport(effective, query.asOf);

    if (index === -1) {
      return empty;
    }

    const shown = effective[index];
    const tiers = await this.tiers(fleetId);
    const [rows, total] = await this.rows(shown.importId, query, viewer)
      .offset((page - 1) * pageSize)
      .limit(pageSize)
      .getManyAndCount();

    return {
      ...empty,
      export: {
        ...toRef(shown),
        partial: shown.partial,
        previous: index > 0 ? toRef(effective[index - 1]) : null,
        next: index < effective.length - 1 ? toRef(effective[index + 1]) : null,
      } satisfies RosterExportDto,
      ranks: await this.ranks(shown.importId, tiers, viewer),
      items: await this.items(fleetId, shown, rows, tiers, viewer),
      total,
    };
  }

  /**
   * Builds the query for an export's rows, filtered and ordered.
   *
   * The rank order is joined for sorting only; a label has at most one row
   * in it, so the join never repeats an observation.
   *
   * @param importId - The export.
   * @param query - The filters and ordering asked for.
   * @param viewer - Who is reading.
   * @returns The query, unpaged.
   */
  private rows(
    importId: string,
    query: RosterQueryDto,
    viewer: RosterViewer,
  ): SelectQueryBuilder<RosterObservationEntity> {
    const sort = query.sort ?? RosterSort.NAME;
    const direction = query.direction ?? RosterSortDirection.ASC;
    const builder = this.exportRows(importId, viewer).leftJoin(
      RosterRankOrderEntity,
      'r',
      'r.fleetId = o.fleetId AND r.label = o.guildRank',
    );

    if (query.search) {
      // Both folds lower-case, and a handle's also trims, which the DTO has
      // already done to the term.
      const term = escapeSqlLikeTerm(
        normaliseRosterCharacterName(query.search),
      );

      builder.andWhere(
        '(o.characterNameNormalised LIKE :search OR o.accountHandleNormalised LIKE :search)',
        { search: `%${term}%` },
      );
    }

    if (query.rank !== undefined) {
      builder.andWhere('o.guildRank = :rank', { rank: query.rank });
    }

    builder.orderBy(SORT_COLUMNS[sort], direction, 'NULLS LAST');

    if (sort === RosterSort.RANK) {
      builder.addOrderBy('o.guildRank', direction);
    }

    return builder
      .addOrderBy('o.characterNameNormalised', 'ASC')
      .addOrderBy('o.accountHandleNormalised', 'ASC')
      .addOrderBy('o.line', 'ASC');
  }

  /**
   * Starts a query over the rows of one export the viewer may see.
   *
   * @param importId - The export.
   * @param viewer - Who is reading.
   * @returns The query.
   */
  private exportRows(
    importId: string,
    viewer: RosterViewer,
  ): SelectQueryBuilder<RosterObservationEntity> {
    const builder = this._observations
      .createQueryBuilder('o')
      .where('o.importSourceId = :importId', { importId });

    if (!viewer.investigator) {
      builder.andWhere('o.excluded = false');
    }

    return builder;
  }

  /**
   * Reads the Fleet's rank order.
   *
   * @param fleetId - The Fleet.
   * @returns Each placed label's tier.
   */
  private async tiers(fleetId: string): Promise<Map<string, number>> {
    const placed = await this._rankOrder.find({
      where: { fleetId },
      select: { fleetId: true, label: true, tier: true },
    });

    return new Map(placed.map(entry => [entry.label, entry.tier]));
  }

  /**
   * Counts the rows holding each rank label on the export, for filtering.
   *
   * @param importId - The export.
   * @param tiers - The Fleet's rank order.
   * @param viewer - Who is reading.
   * @returns Each label, highest tier first and unplaced labels last.
   */
  private async ranks(
    importId: string,
    tiers: ReadonlyMap<string, number>,
    viewer: RosterViewer,
  ): Promise<RosterRankCountDto[]> {
    const counts = await this.exportRows(importId, viewer)
      .select('o.guildRank', 'label')
      .addSelect('COUNT(*)', 'members')
      .groupBy('o.guildRank')
      .getRawMany<{ label: string; members: string }>();

    return counts
      .map(count => ({
        label: count.label,
        tier: tiers.get(count.label) ?? null,
        members: Number(count.members),
      }))
      .sort(
        (a, b) =>
          (a.tier ?? Number.MAX_SAFE_INTEGER) -
            (b.tier ?? Number.MAX_SAFE_INTEGER) ||
          compareText(a.label, b.label),
      );
  }

  /**
   * Maps a page of rows for the response, with who each belongs to and
   * where each may link.
   *
   * @param fleetId - The Fleet.
   * @param shown - The export the rows are from.
   * @param rows - The page's rows.
   * @param tiers - The Fleet's rank order.
   * @param viewer - Who is reading.
   * @returns The rows, in the order given.
   */
  private async items(
    fleetId: string,
    shown: EffectiveRosterExport,
    rows: readonly RosterObservationEntity[],
    tiers: ReadonlyMap<string, number>,
    viewer: RosterViewer,
  ): Promise<RosterRowDto[]> {
    if (rows.length === 0) {
      return [];
    }

    const identities = await this.identities(fleetId, rows);
    const shared = await this.identityRows(
      shown.importId,
      [...new Set(identities.values())],
      viewer,
    );
    const links = await this._profileLinks.find(
      fleetId,
      shown.exportedAt,
      rows,
      viewer.userId,
    );

    return rows.map(row => {
      const identityId = identities.get(aliasKey(row)) ?? null;

      return {
        line: row.line,
        identityId,
        identityRows: identityId === null ? 1 : (shared.get(identityId) ?? 1),
        characterName: row.characterName,
        accountHandle: row.accountHandle,
        level: row.level,
        className: row.className,
        profession: row.profession,
        guildRank: row.guildRank,
        rankTier: tiers.get(row.guildRank) ?? null,
        contributionTotal: row.contributionTotal,
        joinedAt: row.joinedAt,
        joinedAtAmbiguous: row.joinedAtAmbiguous,
        rankChangedAt: row.rankChangedAt,
        rankChangedAtAmbiguous: row.rankChangedAtAmbiguous,
        lastActiveAt: row.lastActiveAt,
        lastActiveAtAmbiguous: row.lastActiveAtAmbiguous,
        status: row.status,
        publicComment: row.publicComment,
        publicCommentEditedAt: row.publicCommentEditedAt,
        excluded: row.excluded,
        profile:
          links.get(
            rosterRowFullHandle(row.characterName, row.accountHandle),
          ) ?? null,
      };
    });
  }

  /**
   * Finds the member each row belongs to.
   *
   * @param fleetId - The Fleet.
   * @param rows - The rows.
   * @returns Each row's identity, by its folded name and handle.
   */
  private async identities(
    fleetId: string,
    rows: readonly RosterObservationEntity[],
  ): Promise<Map<string, string>> {
    const aliases = await this._aliases.find({
      where: rows.map(row => ({
        fleetId,
        characterNameNormalised: row.characterNameNormalised,
        accountHandleNormalised: row.accountHandleNormalised,
      })),
      select: {
        id: true,
        identityId: true,
        characterNameNormalised: true,
        accountHandleNormalised: true,
      },
    });

    return new Map(aliases.map(alias => [aliasKey(alias), alias.identityId]));
  }

  /**
   * Counts how many rows of the export each of some members has.
   *
   * More than one is a confirmed rename whose two names the export still
   * lists: one member, shown as two rows that stay told apart.
   *
   * @param importId - The export.
   * @param identityIds - The members.
   * @param viewer - Who is reading.
   * @returns Each member's row count.
   */
  private async identityRows(
    importId: string,
    identityIds: readonly string[],
    viewer: RosterViewer,
  ): Promise<Map<string, number>> {
    if (identityIds.length === 0) {
      return new Map();
    }

    const counts = await this.exportRows(importId, viewer)
      .innerJoin(
        RosterIdentityAliasEntity,
        'a',
        'a.fleetId = o.fleetId AND a.characterNameNormalised = o.characterNameNormalised AND a.accountHandleNormalised = o.accountHandleNormalised',
      )
      .andWhere('a.identityId IN (:...identityIds)', {
        identityIds: [...identityIds],
      })
      .select('a.identityId', 'identityId')
      .addSelect('COUNT(*)', 'rows')
      .groupBy('a.identityId')
      .getRawMany<{ identityId: string; rows: string }>();

    return new Map(counts.map(count => [count.identityId, Number(count.rows)]));
  }
}

/**
 * Chooses which export to show.
 *
 * @param effective - The revision's effective exports, oldest first.
 * @param asOf - The instant asked for, or undefined for the latest.
 * @returns The index of the last export at or before it, or -1 for none.
 */
function chooseExport(
  effective: readonly EffectiveRosterExport[],
  asOf: string | undefined,
): number {
  if (asOf === undefined) {
    return effective.length - 1;
  }

  const limit = new Date(asOf).getTime();
  let chosen = -1;

  for (const [index, candidate] of effective.entries()) {
    if (candidate.exportedAt.getTime() <= limit) {
      chosen = index;
    }
  }

  return chosen;
}

/**
 * Reduces an export to the reference a reader steps with.
 *
 * @param source - The export.
 * @returns Its import and instant.
 */
function toRef(source: EffectiveRosterExport): RosterExportRefDto {
  return { importId: source.importId, exportedAt: source.exportedAt };
}

/**
 * Keys a row or alias by its folded name and handle.
 *
 * @param source - The row or alias.
 * @returns The key.
 */
function aliasKey(source: {
  characterNameNormalised: string;
  accountHandleNormalised: string;
}): string {
  return `${source.characterNameNormalised}\u0000${source.accountHandleNormalised}`;
}
