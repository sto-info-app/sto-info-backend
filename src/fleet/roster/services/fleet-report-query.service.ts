import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, SelectQueryBuilder } from 'typeorm';

import { RosterIdentityAliasEntity } from '../../identity/entities/roster-identity-alias.entity';
import { RosterObservationEntity } from '../../imports/entities/roster-observation.entity';
import { RosterProjectionInputEntity } from '../../projection/entities/roster-projection-input.entity';
import { RosterActivityBand } from '../enums/roster-activity-band.enum';

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

/** Joins an export's rows to the members they belong to. */
const ALIAS_JOIN =
  'a.fleetId = o.fleetId AND a.characterNameNormalised = o.characterNameNormalised AND a.accountHandleNormalised = o.accountHandleNormalised';

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
