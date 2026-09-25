import { BadRequestException, Injectable } from '@nestjs/common';

import { FleetReportQueryDto } from '../dto/fleet-report-query.dto';
import { FleetReportHeaderDto } from '../dto/fleet-report.dto';
import { FleetReportView } from '../enums/fleet-report-view.enum';
import { FleetReport } from '../enums/fleet-report.enum';
import { REPORT_MINIMUM_COHORT } from '../utilities/report-suppression.utility';
import {
  EffectiveRosterExport,
  PublishedRosterRevisionService,
} from './published-roster-revision.service';

/** What a report is built from: one revision, one span. */
export interface FleetReportContext {
  /** The Fleet. */
  readonly fleetId: string;
  /** What the report says about itself. */
  readonly header: FleetReportHeaderDto;
  /** The effective exports within the span, oldest first. */
  readonly exports: readonly EffectiveRosterExport[];
  /**
   * For a full view, the export whose detail is shown: the one asked for,
   * or the latest in the span. Null for an aggregate view, or an empty span.
   */
  readonly at: EffectiveRosterExport | null;
}

/**
 * Opens a report: pins the published revision and works out the span
 * (FC-020).
 *
 * Every report reads one revision, as the roster and history do, and says
 * which, over which span, from which exports (plan section 7: "projection
 * revision, bounds/coverage and source provenance").
 */
@Injectable()
export class FleetReportContextService {
  /**
   * Creates an instance of FleetReportContextService.
   *
   * @param _revisions - Pins the reader to the published revision.
   */
  constructor(private readonly _revisions: PublishedRosterRevisionService) {}

  /**
   * Opens one report for one viewer.
   *
   * @param fleetId - The Fleet.
   * @param report - The report.
   * @param view - How much of it the viewer is shown.
   * @param query - The span, and the export for its detail.
   * @returns What it is built from.
   * @throws BadRequestException when `at` names no effective export in the
   *   span.
   */
  async open(
    fleetId: string,
    report: FleetReport,
    view: FleetReportView,
    query: FleetReportQueryDto,
  ): Promise<FleetReportContext> {
    const pinned = await this._revisions.pin(fleetId);
    const from = query.from === undefined ? null : new Date(query.from);
    const to = query.to === undefined ? null : new Date(query.to);
    const exports = (
      await this._revisions.effectiveExports(fleetId, pinned.revision)
    ).filter(
      entry =>
        (from === null || entry.exportedAt >= from) &&
        (to === null || entry.exportedAt <= to),
    );

    return {
      fleetId,
      header: {
        report,
        view,
        ...pinned,
        range: { from, to },
        coverage: {
          exports: exports.length,
          first: exports.length > 0 ? refOf(exports[0]) : null,
          latest:
            exports.length > 0 ? refOf(exports[exports.length - 1]) : null,
        },
        minimumCohort: REPORT_MINIMUM_COHORT,
      },
      exports,
      at: view === FleetReportView.FULL ? chooseAt(exports, query.at) : null,
    };
  }
}

/**
 * Chooses the export a full report's detail is drawn at.
 *
 * @param exports - The span's effective exports, oldest first.
 * @param importId - The export asked for, if any.
 * @returns It, or the latest; null for an empty span.
 * @throws BadRequestException when the one asked for is not in the span.
 */
function chooseAt(
  exports: readonly EffectiveRosterExport[],
  importId: string | undefined,
): EffectiveRosterExport | null {
  if (importId === undefined) {
    return exports.length > 0 ? exports[exports.length - 1] : null;
  }

  const chosen = exports.find(entry => entry.importId === importId);

  if (chosen === undefined) {
    throw new BadRequestException('That export is not one the report covers.');
  }

  return chosen;
}

/**
 * Reduces an export to the reference a reader steps with.
 *
 * @param source - The export.
 * @returns Its import and instant.
 */
function refOf(source: EffectiveRosterExport): {
  importId: string;
  exportedAt: Date;
} {
  return { importId: source.importId, exportedAt: source.exportedAt };
}
