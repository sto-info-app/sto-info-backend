import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { RosterIntervalSummaryEntity } from '../../projection/entities/roster-interval-summary.entity';
import {
  ActivityExportDto,
  FleetActivityReportDto,
  FleetGrowthReportDto,
  GrowthIntervalDto,
} from '../dto/fleet-growth-report.dto';
import { FleetReportView } from '../enums/fleet-report-view.enum';
import { RosterActivityBand } from '../enums/roster-activity-band.enum';
import {
  suppressCount,
  suppressGroup,
} from '../utilities/report-suppression.utility';
import { FleetReportContext } from './fleet-report-context.service';
import { FleetReportQueryService } from './fleet-report-query.service';

/** The activity bands, in the order they are shown. */
const ACTIVITY_BANDS = Object.values(RosterActivityBand);

/**
 * Builds the growth and activity reports (FC-020).
 *
 * Neither names anybody, so a full view and an aggregate view show the same
 * figures; an aggregate view has its small ones hidden.
 *
 * - **Growth** is FC-019's interval summaries: members at each end, who
 *   joined, rejoined and left, who a partial export left unknown and what it
 *   revealed across a gap. Beside them, the account handles each end
 *   listed, counted as observed accounts, never as people (plan section 7).
 * - **Activity** is each export's members banded by their Last Active,
 *   measured back from the export itself at 7, 30 and 90 days (Steve's
 *   decision of 25 September 2026).
 */
@Injectable()
export class FleetGrowthReportService {
  /**
   * Creates an instance of FleetGrowthReportService.
   *
   * @param _intervals - Each revision's interval summaries.
   * @param _queries - The counting queries.
   */
  constructor(
    @InjectRepository(RosterIntervalSummaryEntity)
    private readonly _intervals: Repository<RosterIntervalSummaryEntity>,
    private readonly _queries: FleetReportQueryService,
  ) {}

  /**
   * Builds the growth report.
   *
   * @param context - The revision, span and view.
   * @returns The report, oldest interval first.
   */
  async growth(context: FleetReportContext): Promise<FleetGrowthReportDto> {
    const { header, exports } = context;

    if (exports.length === 0) {
      return { ...header, intervals: [] };
    }

    const intervals = await this._intervals.find({
      where: {
        fleetId: context.fleetId,
        revision: header.revision,
        toImportId: In(exports.map(entry => entry.importId)),
      },
      order: { toAt: 'ASC' },
    });
    const accounts = new Map(
      (
        await this._queries.accounts([
          ...new Set(
            intervals.flatMap(interval => [
              interval.fromImportId,
              interval.toImportId,
            ]),
          ),
        ])
      ).map(entry => [entry.importId, entry.count]),
    );
    const aggregate = header.view === FleetReportView.AGGREGATE;

    return {
      ...header,
      intervals: intervals.map(interval => {
        const row = toGrowthRow(
          interval,
          accounts.get(interval.fromImportId) ?? 0,
          accounts.get(interval.toImportId) ?? 0,
        );

        return aggregate ? suppressGrowthRow(row) : row;
      }),
    };
  }

  /**
   * Builds the activity report.
   *
   * @param context - The revision, span and view.
   * @returns The report, oldest export first.
   */
  async activity(context: FleetReportContext): Promise<FleetActivityReportDto> {
    const { header, exports } = context;
    const counts = await this._queries.activity(
      context.fleetId,
      header.revision,
      exports.map(entry => entry.importId),
    );
    const byExport = new Map<string, Map<RosterActivityBand, number>>();

    for (const { importId, band, count } of counts) {
      byExport.set(
        importId,
        (byExport.get(importId) ?? new Map()).set(band, count),
      );
    }

    return {
      ...header,
      exports: exports.map(entry => {
        const bands = byExport.get(entry.importId) ?? new Map();
        const values = ACTIVITY_BANDS.map(band => bands.get(band) ?? 0);
        const members = values.reduce((sum, value) => sum + value, 0);
        const aggregate = header.view === FleetReportView.AGGREGATE;
        const shown = aggregate ? suppressGroup(values) : values;

        return {
          export: { importId: entry.importId, exportedAt: entry.exportedAt },
          partial: entry.partial,
          members: aggregate ? suppressCount(members) : members,
          bands: Object.fromEntries(
            ACTIVITY_BANDS.map((band, index) => [band, shown[index]]),
          ) as ActivityExportDto['bands'],
        };
      }),
    };
  }
}

/**
 * Maps an interval summary to a growth row.
 *
 * @param interval - The summary.
 * @param accountsAtStart - The handles its earlier export listed.
 * @param accountsAtEnd - The handles its later export listed.
 * @returns The row, unsuppressed.
 */
function toGrowthRow(
  interval: RosterIntervalSummaryEntity,
  accountsAtStart: number,
  accountsAtEnd: number,
): GrowthIntervalDto {
  return {
    from: { importId: interval.fromImportId, exportedAt: interval.fromAt },
    to: { importId: interval.toImportId, exportedAt: interval.toAt },
    partial: interval.partial,
    membersAtStart: interval.membersAtStart,
    membersAtEnd: interval.membersAtEnd,
    joined: interval.joined,
    rejoined: interval.rejoined,
    left: interval.left,
    unknown: interval.unknown,
    acrossGap: interval.acrossGap,
    accountsAtStart,
    accountsAtEnd,
  };
}

/**
 * Hides a growth row's small figures from an aggregate audience.
 *
 * The movements — joined, rejoined, left, unknown and across a gap — are
 * one group: with the members at each end shown, any one of them alone
 * could be worked out from the others.
 *
 * @param row - The row.
 * @returns It with its small figures null.
 */
function suppressGrowthRow(row: GrowthIntervalDto): GrowthIntervalDto {
  const [joined, rejoined, left, unknown, acrossGap] = suppressGroup([
    row.joined as number,
    row.rejoined as number,
    row.left as number,
    row.unknown as number,
    row.acrossGap as number,
  ]);

  return {
    ...row,
    membersAtStart: suppressCount(row.membersAtStart as number),
    membersAtEnd: suppressCount(row.membersAtEnd as number),
    joined,
    rejoined,
    left,
    unknown,
    acrossGap,
    accountsAtStart: suppressCount(row.accountsAtStart as number),
    accountsAtEnd: suppressCount(row.accountsAtEnd as number),
  };
}
