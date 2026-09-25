import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { RosterChangeEntity } from '../../projection/entities/roster-change.entity';
import { RosterChangeKind } from '../../projection/enums/roster-change-kind.enum';
import { compareText } from '../../projection/utilities/compare-text.utility';
import {
  FleetRanksReportDto,
  FleetTenureReportDto,
  RankChangeCountDto,
  TenureExportDto,
  TenureMemberDto,
} from '../dto/fleet-tenure-report.dto';
import { FleetReportView } from '../enums/fleet-report-view.enum';
import { RosterRankMove } from '../enums/roster-rank-move.enum';
import { RosterTenureBand } from '../enums/roster-tenure-band.enum';
import {
  suppressCount,
  suppressGroup,
} from '../utilities/report-suppression.utility';
import { rosterRankMove } from '../utilities/roster-rank-move.utility';
import { FleetReportContext } from './fleet-report-context.service';
import { FleetReportQueryService } from './fleet-report-query.service';
import { RosterRankOrderService } from './roster-rank-order.service';

/** The tenure bands, in the order they are shown. */
const TENURE_BANDS = Object.values(RosterTenureBand);

/** A day, in milliseconds. */
const DAY = 24 * 60 * 60 * 1000;

/** The upper bound of each tenure band but the last, in days. */
const TENURE_LIMITS: ReadonlyArray<[RosterTenureBand, number]> = [
  [RosterTenureBand.UNDER_30_DAYS, 30],
  [RosterTenureBand.DAYS_30_TO_90, 90],
  [RosterTenureBand.MONTHS_3_TO_12, 365],
  [RosterTenureBand.YEARS_1_TO_2, 730],
];

/**
 * Builds the tenure and ranks reports (FC-020).
 *
 * - **Tenure** is observed: how long each export's members had been listed,
 *   from the first export of the episode it falls in, banded at 30 and 90
 *   days and one and two years. A member no earlier export bounds had been
 *   listed at least that long, and is counted as such (Steve's decisions of
 *   25 September 2026). A full view also lists the members at one export.
 * - **Ranks** is each export's members under each rank label, ordered by
 *   the Fleet's tiers, beside the rank changes it revealed: promotions and
 *   demotions where the tiers allow, every other change only "changed".
 */
@Injectable()
export class FleetTenureReportService {
  /**
   * Creates an instance of FleetTenureReportService.
   *
   * @param _changes - Each revision's changes.
   * @param _queries - The counting queries.
   * @param _rankOrder - Reads the Fleet's rank order.
   */
  constructor(
    @InjectRepository(RosterChangeEntity)
    private readonly _changes: Repository<RosterChangeEntity>,
    private readonly _queries: FleetReportQueryService,
    private readonly _rankOrder: RosterRankOrderService,
  ) {}

  /**
   * Builds the tenure report.
   *
   * @param context - The revision, span and view.
   * @returns The report, oldest export first.
   */
  async tenure(context: FleetReportContext): Promise<FleetTenureReportDto> {
    const { header, exports, at } = context;
    const counts = await this._queries.tenure(
      context.fleetId,
      header.revision,
      exports.map(entry => entry.importId),
    );
    const aggregate = header.view === FleetReportView.AGGREGATE;

    return {
      ...header,
      exports: exports.map(entry => {
        const mine = counts.filter(count => count.importId === entry.importId);
        const bands = TENURE_BANDS.map(band =>
          sum(mine.filter(count => count.band === band)),
        );
        const atLeast = TENURE_BANDS.map(band =>
          sum(mine.filter(count => count.band === band && count.openStart)),
        );
        const members = bands.reduce((total, value) => total + value, 0);

        return {
          export: { importId: entry.importId, exportedAt: entry.exportedAt },
          partial: entry.partial,
          members: aggregate ? suppressCount(members) : members,
          bands: byBand(aggregate ? suppressGroup(bands) : bands),
          atLeast: byBand(
            aggregate ? atLeast.map(value => suppressCount(value)) : atLeast,
          ),
        };
      }),
      at:
        at === null
          ? null
          : { importId: at.importId, exportedAt: at.exportedAt },
      members:
        at === null
          ? null
          : (
              await this._queries.tenureMembers(
                context.fleetId,
                header.revision,
                at.importId,
              )
            ).map(member => {
              const days = Math.floor(
                (at.exportedAt.getTime() -
                  new Date(member.firstObservedAt).getTime()) /
                  DAY,
              );

              return {
                identityId: member.identityId,
                characterName: member.characterName,
                accountHandle: member.accountHandle,
                firstObservedAt: new Date(member.firstObservedAt),
                days,
                band: tenureBand(days),
                atLeast: member.openStart,
              } satisfies TenureMemberDto;
            }),
    };
  }

  /**
   * Builds the ranks report.
   *
   * @param context - The revision, span and view.
   * @returns The report, oldest export first.
   */
  async ranks(context: FleetReportContext): Promise<FleetRanksReportDto> {
    const { header, exports } = context;

    if (exports.length === 0) {
      return { ...header, exports: [] };
    }

    const importIds = exports.map(entry => entry.importId);
    const counts = await this._queries.ranks(
      context.fleetId,
      header.revision,
      importIds,
    );
    const tiers = await this._rankOrder.tiers(context.fleetId);
    const changes = await this._changes.find({
      where: {
        fleetId: context.fleetId,
        revision: header.revision,
        kind: RosterChangeKind.RANK_CHANGED,
        toImportId: In(importIds),
      },
      select: { id: true, toImportId: true, acrossGap: true, detail: true },
    });
    const aggregate = header.view === FleetReportView.AGGREGATE;

    return {
      ...header,
      exports: exports.map(entry => {
        const labels = counts
          .filter(count => count.importId === entry.importId)
          .map(count => ({
            label: count.label,
            tier: tiers.get(count.label) ?? null,
            members: count.count,
          }))
          .sort(
            (a, b) =>
              (a.tier ?? Number.MAX_SAFE_INTEGER) -
                (b.tier ?? Number.MAX_SAFE_INTEGER) ||
              compareText(a.label, b.label),
          );
        const shown = aggregate
          ? suppressGroup(labels.map(label => label.members))
          : labels.map(label => label.members);

        return {
          export: { importId: entry.importId, exportedAt: entry.exportedAt },
          partial: entry.partial,
          labels: labels.map((label, index) => ({
            ...label,
            members: shown[index],
          })),
          // The Fleet's first export ends no interval, so has no changes.
          changes:
            entry.importId !== context.first?.importId
              ? countChanges(
                  changes.filter(
                    change => change.toImportId === entry.importId,
                  ),
                  tiers,
                  aggregate,
                )
              : null,
        };
      }),
    };
  }
}

/**
 * Sums some counts.
 *
 * @param counts - The counts.
 * @returns Their total.
 */
function sum(counts: ReadonlyArray<{ count: number }>): number {
  return counts.reduce((total, entry) => total + entry.count, 0);
}

/**
 * Keys some values, one per tenure band in order, by band.
 *
 * @param values - The values.
 * @returns Them, keyed.
 */
function byBand(
  values: ReadonlyArray<number | null>,
): TenureExportDto['bands'] {
  return Object.fromEntries(
    TENURE_BANDS.map((band, index) => [band, values[index]]),
  ) as TenureExportDto['bands'];
}

/**
 * Bands a tenure.
 *
 * @param days - Whole days listed.
 * @returns Its band.
 */
function tenureBand(days: number): RosterTenureBand {
  return (
    TENURE_LIMITS.find(([, limit]) => days < limit)?.[0] ??
    RosterTenureBand.OVER_2_YEARS
  );
}

/**
 * Counts one interval's rank changes by what the tiers make of them.
 *
 * @param changes - Its rank changes.
 * @param tiers - The Fleet's rank order.
 * @param aggregate - Whether to hide the small counts.
 * @returns The counts.
 */
function countChanges(
  changes: readonly RosterChangeEntity[],
  tiers: ReadonlyMap<string, number>,
  aggregate: boolean,
): RankChangeCountDto {
  let promoted = 0;
  let demoted = 0;
  let changed = 0;
  let acrossGap = 0;

  for (const change of changes) {
    if (change.acrossGap) {
      acrossGap += 1;
      continue;
    }

    const move = rosterRankMove(
      tiers,
      change.detail.fromRank,
      change.detail.toRank,
    );

    if (move === RosterRankMove.PROMOTED) {
      promoted += 1;
    } else if (move === RosterRankMove.DEMOTED) {
      demoted += 1;
    } else {
      changed += 1;
    }
  }

  const counts = [promoted, demoted, changed, acrossGap];
  const [p, d, c, g] = aggregate ? suppressGroup(counts) : counts;

  return { promoted: p, demoted: d, changed: c, acrossGap: g };
}
