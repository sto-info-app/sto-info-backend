import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, SelectQueryBuilder } from 'typeorm';

import { RosterIdentityAliasEntity } from '../../identity/entities/roster-identity-alias.entity';
import { RosterObservationEntity } from '../../imports/entities/roster-observation.entity';
import { RosterEpisodeEntity } from '../../projection/entities/roster-episode.entity';
import { RosterProjectionInputEntity } from '../../projection/entities/roster-projection-input.entity';
import { RosterEpisodeStart } from '../../projection/enums/roster-episode-start.enum';
import { RosterActivityBand } from '../enums/roster-activity-band.enum';
import { RosterTenureBand } from '../enums/roster-tenure-band.enum';

/** A count at one export. */
export interface ExportCount {
  /** The export. */
  readonly importId: string;
  /** What was counted. */
  readonly count: number;
}

/** A band's member count at one export. */
export interface ExportBandCount<T extends string> extends ExportCount {
  /** The band. */
  readonly band: T;
}

/** A tenure band's member count at one export. */
export interface ExportTenureCount extends ExportBandCount<RosterTenureBand> {
  /**
   * Whether these members were first seen on the Fleet's first effective
   * export, and so had been listed at least this long.
   */
  readonly openStart: boolean;
}

/** One member at one export, and how long they had been listed. */
export interface MemberTenure {
  /** The member. */
  readonly identityId: string;
  /** Their name, as the export listed it: the row nearest the top. */
  readonly characterName: string;
  /** Their handle, likewise. */
  readonly accountHandle: string;
  /** The first export of their current episode. */
  readonly firstObservedAt: Date;
  /** Whether that was the Fleet's first effective export. */
  readonly openStart: boolean;
}

/** A rank label's member count at one export. */
export interface ExportRankCount extends ExportCount {
  /** The label, exactly as the export listed it. */
  readonly label: string;
}

/** Joins an export's rows to the members they belong to. */
const ALIAS_JOIN =
  'a.fleetId = o.fleetId AND a.characterNameNormalised = o.characterNameNormalised AND a.accountHandleNormalised = o.accountHandleNormalised';

/** Joins a member at an export to the episode that export falls in. */
const EPISODE_JOIN =
  'e.fleetId = i.fleetId AND e.revision = i.revision AND e.identityId = a.identityId AND e.firstObservedAt <= i.exportedAt AND e.lastObservedAt >= i.exportedAt';

/** Works out a member's tenure band from `m`. */
const TENURE_BAND = `CASE
      WHEN m."exportedAt" - m."firstObservedAt" < INTERVAL '30 days' THEN '${RosterTenureBand.UNDER_30_DAYS}'
      WHEN m."exportedAt" - m."firstObservedAt" < INTERVAL '90 days' THEN '${RosterTenureBand.DAYS_30_TO_90}'
      WHEN m."exportedAt" - m."firstObservedAt" < INTERVAL '365 days' THEN '${RosterTenureBand.MONTHS_3_TO_12}'
      WHEN m."exportedAt" - m."firstObservedAt" < INTERVAL '730 days' THEN '${RosterTenureBand.YEARS_1_TO_2}'
      ELSE '${RosterTenureBand.OVER_2_YEARS}'
    END`;

/**
 * The counting queries the reports are built from (FC-020).
 *
 * Each counts in the database, grouped by export, so a report over a Fleet
 * with hundreds of exports reads a row per export and band rather than a
 * row per member. Every one reads only the rows the published revision
 * stands on — the exports given, which the caller took from it — and never
 * a row an investigator excluded, since an excluded row is not evidence
 * that anybody was there.
 *
 * A member is a roster identity: one listed twice on an export, as both
 * names of a confirmed rename can be, counts once.
 */
@Injectable()
export class FleetReportQueryService {
  /**
   * Creates an instance of FleetReportQueryService.
   *
   * @param _dataSource - Runs the queries.
   */
  constructor(@InjectDataSource() private readonly _dataSource: DataSource) {}

  /**
   * Counts the account handles each export listed.
   *
   * Observed accounts, not people: plan section 7.
   *
   * @param importIds - The exports.
   * @returns Each export's count; one listing nobody is absent.
   */
  async accounts(importIds: readonly string[]): Promise<ExportCount[]> {
    if (importIds.length === 0) {
      return [];
    }

    const rows = await this._dataSource
      .createQueryBuilder()
      .select('o.importSourceId', 'importId')
      .addSelect('COUNT(DISTINCT o.accountHandleNormalised)', 'count')
      .from(RosterObservationEntity, 'o')
      .where('o.importSourceId IN (:...importIds)', {
        importIds: [...importIds],
      })
      .andWhere('o.excluded = false')
      .groupBy('o.importSourceId')
      .getRawMany<{ importId: string; count: string }>();

    return rows.map(row => ({
      importId: row.importId,
      count: Number(row.count),
    }));
  }

  /**
   * Counts each export's members by how recently they were active.
   *
   * @param fleetId - The Fleet.
   * @param revision - The revision pinned.
   * @param importIds - The exports.
   * @returns Each export's count in each band it has anybody in.
   */
  async activity(
    fleetId: string,
    revision: number,
    importIds: readonly string[],
  ): Promise<Array<ExportBandCount<RosterActivityBand>>> {
    if (importIds.length === 0) {
      return [];
    }

    const members = this.members(fleetId, revision, importIds).addSelect(
      'MAX(o.lastActiveAt)',
      'lastActiveAt',
    );
    const band = `CASE
      WHEN m."lastActiveAt" IS NULL THEN '${RosterActivityBand.UNKNOWN}'
      WHEN m."exportedAt" - m."lastActiveAt" <= INTERVAL '7 days' THEN '${RosterActivityBand.WITHIN_7_DAYS}'
      WHEN m."exportedAt" - m."lastActiveAt" <= INTERVAL '30 days' THEN '${RosterActivityBand.WITHIN_30_DAYS}'
      WHEN m."exportedAt" - m."lastActiveAt" <= INTERVAL '90 days' THEN '${RosterActivityBand.WITHIN_90_DAYS}'
      ELSE '${RosterActivityBand.OVER_90_DAYS}'
    END`;

    return this.countBands<RosterActivityBand>(members, band);
  }

  /**
   * Counts each export's members by how long they had been listed.
   *
   * From the first export of the episode each export falls in: observed,
   * never the game's Join Date.
   *
   * @param fleetId - The Fleet.
   * @param revision - The revision pinned.
   * @param importIds - The exports.
   * @returns Each export's count in each band, split by whether the members
   *   had been listed since before the Fleet's first export.
   */
  async tenure(
    fleetId: string,
    revision: number,
    importIds: readonly string[],
  ): Promise<ExportTenureCount[]> {
    if (importIds.length === 0) {
      return [];
    }

    const members = this.withEpisodes(
      this.members(fleetId, revision, importIds),
    );
    const rows = await this._dataSource
      .createQueryBuilder()
      .select('m."importId"', 'importId')
      .addSelect(TENURE_BAND, 'band')
      .addSelect('m."openStart"', 'openStart')
      .addSelect('COUNT(*)', 'count')
      .from(`(${members.getQuery()})`, 'm')
      .setParameters(members.getParameters())
      .groupBy('m."importId"')
      .addGroupBy('2')
      .addGroupBy('m."openStart"')
      .getRawMany<{
        importId: string;
        band: RosterTenureBand;
        openStart: boolean;
        count: string;
      }>();

    return rows.map(row => ({
      importId: row.importId,
      band: row.band,
      openStart: row.openStart,
      count: Number(row.count),
    }));
  }

  /**
   * Lists the members of one export with how long each had been listed.
   *
   * For a full view's detail, never an aggregate one.
   *
   * @param fleetId - The Fleet.
   * @param revision - The revision pinned.
   * @param importId - The export.
   * @returns Its members, longest listed first.
   */
  async tenureMembers(
    fleetId: string,
    revision: number,
    importId: string,
  ): Promise<MemberTenure[]> {
    const rows = await this.withEpisodes(
      this.members(fleetId, revision, [importId]),
    )
      .addSelect(
        '(ARRAY_AGG(o.characterName ORDER BY o.line))[1]',
        'characterName',
      )
      .addSelect(
        '(ARRAY_AGG(o.accountHandle ORDER BY o.line))[1]',
        'accountHandle',
      )
      .orderBy('"firstObservedAt"', 'ASC')
      .addOrderBy('"characterName"', 'ASC')
      .getRawMany<MemberTenure>();

    return rows.map(row => ({
      identityId: row.identityId,
      characterName: row.characterName,
      accountHandle: row.accountHandle,
      firstObservedAt: row.firstObservedAt,
      openStart: row.openStart,
    }));
  }

  /**
   * Counts each export's members by rank label.
   *
   * A member listed twice under two labels — both names of a confirmed
   * rename, holding different ranks — is counted under each.
   *
   * @param fleetId - The Fleet.
   * @param revision - The revision pinned.
   * @param importIds - The exports.
   * @returns Each export's count under each label it lists.
   */
  async ranks(
    fleetId: string,
    revision: number,
    importIds: readonly string[],
  ): Promise<ExportRankCount[]> {
    if (importIds.length === 0) {
      return [];
    }

    const rows = await this._dataSource
      .createQueryBuilder(RosterProjectionInputEntity, 'i')
      .select('i.importSourceId', 'importId')
      .addSelect('o.guildRank', 'label')
      .addSelect('COUNT(DISTINCT a.identityId)', 'count')
      .innerJoin(
        RosterObservationEntity,
        'o',
        'o.importSourceId = i.importSourceId AND o.excluded = false',
      )
      .innerJoin(RosterIdentityAliasEntity, 'a', ALIAS_JOIN)
      .where('i.fleetId = :fleetId', { fleetId })
      .andWhere('i.revision = :revision', { revision })
      .andWhere('i.importSourceId IN (:...importIds)', {
        importIds: [...importIds],
      })
      .groupBy('i.importSourceId')
      .addGroupBy('o.guildRank')
      .getRawMany<{ importId: string; label: string; count: string }>();

    return rows.map(row => ({
      importId: row.importId,
      label: row.label,
      count: Number(row.count),
    }));
  }

  /**
   * Adds to a per-member query the episode each export falls in.
   *
   * @param members - One row per export and member, as {@link members}.
   * @returns The query, with when the episode was first seen and whether
   *   that was before anything bounds it.
   */
  private withEpisodes(
    members: SelectQueryBuilder<RosterProjectionInputEntity>,
  ): SelectQueryBuilder<RosterProjectionInputEntity> {
    return members
      .innerJoin(RosterEpisodeEntity, 'e', EPISODE_JOIN)
      .addSelect('MIN(e.firstObservedAt)', 'firstObservedAt')
      .addSelect(
        `BOOL_OR(e.startKind = '${RosterEpisodeStart.FIRST_SEEN}')`,
        'openStart',
      );
  }

  /**
   * Starts a query for each member on each of some exports, one row apiece.
   *
   * @param fleetId - The Fleet.
   * @param revision - The revision pinned.
   * @param importIds - The exports.
   * @returns The query, grouped by export and member.
   */
  private members(
    fleetId: string,
    revision: number,
    importIds: readonly string[],
  ): SelectQueryBuilder<RosterProjectionInputEntity> {
    return this._dataSource
      .createQueryBuilder(RosterProjectionInputEntity, 'i')
      .select('i.importSourceId', 'importId')
      .addSelect('i.exportedAt', 'exportedAt')
      .addSelect('a.identityId', 'identityId')
      .innerJoin(
        RosterObservationEntity,
        'o',
        'o.importSourceId = i.importSourceId AND o.excluded = false',
      )
      .innerJoin(RosterIdentityAliasEntity, 'a', ALIAS_JOIN)
      .where('i.fleetId = :fleetId', { fleetId })
      .andWhere('i.revision = :revision', { revision })
      .andWhere('i.importSourceId IN (:...importIds)', {
        importIds: [...importIds],
      })
      .groupBy('i.importSourceId')
      .addGroupBy('i.exportedAt')
      .addGroupBy('a.identityId');
  }

  /**
   * Counts the members of a per-member query by a band worked out from it.
   *
   * @param members - One row per export and member, as {@link members}.
   * @param band - The SQL working out a member's band from `m`.
   * @returns Each export's count in each band.
   */
  private async countBands<T extends string>(
    members: SelectQueryBuilder<RosterProjectionInputEntity>,
    band: string,
  ): Promise<Array<ExportBandCount<T>>> {
    const rows = await this._dataSource
      .createQueryBuilder()
      .select('m."importId"', 'importId')
      .addSelect(band, 'band')
      .addSelect('COUNT(*)', 'count')
      .from(`(${members.getQuery()})`, 'm')
      .setParameters(members.getParameters())
      .groupBy('m."importId"')
      .addGroupBy('2')
      .getRawMany<{ importId: string; band: T; count: string }>();

    return rows.map(row => ({
      importId: row.importId,
      band: row.band,
      count: Number(row.count),
    }));
  }
}
