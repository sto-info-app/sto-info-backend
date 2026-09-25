import { Injectable, NotFoundException } from '@nestjs/common';

import { FleetAudienceService } from '../../authorisation/fleet-audience.service';
import { FleetAuthorisationService } from '../../authorisation/fleet-authorisation.service';
import { FLEET_CAPABILITIES } from '../../authorisation/fleet-capability.constants';
import { ScopeRef } from '../../authorisation/scope-authorisation.interface';
import { FleetAudience } from '../../enums/fleet-audience.enum';
import { FleetReportView } from '../enums/fleet-report-view.enum';
import { FleetReport } from '../enums/fleet-report.enum';
import { FleetReportAudienceService } from './fleet-report-audience.service';

/**
 * Decides how much of a Fleet's report a viewer is shown (FC-020).
 *
 * Steve's decisions of 25 September 2026:
 *
 * - Nobody is shown anything of a Fleet they may not see at all. The Fleet
 *   and its Community's own audiences come first, so a public report on a
 *   private Fleet stays hidden, and is reported as not found.
 * - A `reports.view` holder — the Owner or an Admin — sees every report in
 *   full, whatever its audience.
 * - A Fleet member — a `roster.view` holder — sees a report in full when its
 *   audience includes them: anything wider than `PRIVATE`. They can read the
 *   roster it is built from already.
 * - The Community's followers see a `COMMUNITY` or `PUBLIC` report, and
 *   anybody else a `PUBLIC` one, as aggregates only.
 */
@Injectable()
export class FleetReportAccessService {
  /**
   * Creates an instance of FleetReportAccessService.
   *
   * @param _authorisationService - Resolves a viewer's capabilities.
   * @param _audienceService - Decides who may see a scope and its content.
   * @param _reportAudiences - Reads each report's audience.
   */
  constructor(
    private readonly _authorisationService: FleetAuthorisationService,
    private readonly _audienceService: FleetAudienceService,
    private readonly _reportAudiences: FleetReportAudienceService,
  ) {}

  /**
   * Says how much of each report a viewer is shown.
   *
   * @param ref - The Fleet, as the route named it.
   * @param userId - The viewer, or null when signed out.
   * @returns Each report they may see, with how much. Empty when they may
   *   see none, or not the Fleet.
   */
  async visible(
    ref: ScopeRef,
    userId: string | null,
  ): Promise<Map<FleetReport, FleetReportView>> {
    const views = new Map<FleetReport, FleetReportView>();

    if (!(await this._audienceService.canViewScope(ref, userId))) {
      return views;
    }

    const authorisation = await this._authorisationService.authorise(
      userId,
      ref,
    );
    const capabilities = authorisation?.capabilities ?? new Set();
    const chosen = await this._reportAudiences.chosen(ref.id);
    let follower: boolean | undefined;

    for (const [report, audience] of chosen) {
      if (capabilities.has(FLEET_CAPABILITIES.REPORTS_VIEW)) {
        views.set(report, FleetReportView.FULL);
      } else if (audience === FleetAudience.PRIVATE) {
        continue;
      } else if (capabilities.has(FLEET_CAPABILITIES.ROSTER_VIEW)) {
        views.set(report, FleetReportView.FULL);
      } else if (audience === FleetAudience.PUBLIC) {
        views.set(report, FleetReportView.AGGREGATE);
      } else if (audience === FleetAudience.COMMUNITY) {
        follower ??= await this._audienceService.canView(
          FleetAudience.COMMUNITY,
          ref,
          userId,
        );

        if (follower) {
          views.set(report, FleetReportView.AGGREGATE);
        }
      }
    }

    return views;
  }

  /**
   * Requires that a viewer may see a report, and says how much of it.
   *
   * @param ref - The Fleet, as the route named it.
   * @param report - The report.
   * @param userId - The viewer, or null when signed out.
   * @returns How much of it they are shown.
   * @throws NotFoundException when they may see none of it. A report hidden
   *   from them is reported as absent, not forbidden, so the answer does not
   *   confirm what a private Fleet has.
   */
  async require(
    ref: ScopeRef,
    report: FleetReport,
    userId: string | null,
  ): Promise<FleetReportView> {
    const view = (await this.visible(ref, userId)).get(report);

    if (view === undefined) {
      throw new NotFoundException('Not found');
    }

    return view;
  }
}
