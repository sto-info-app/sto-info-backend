import { NotFoundException } from '@nestjs/common';

import { FleetAudienceService } from '../../authorisation/fleet-audience.service';
import { FleetAuthorisationService } from '../../authorisation/fleet-authorisation.service';
import {
  FLEET_CAPABILITIES,
  FleetCapability,
} from '../../authorisation/fleet-capability.constants';
import { FleetAudience } from '../../enums/fleet-audience.enum';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetReportView } from '../enums/fleet-report-view.enum';
import { FleetReport } from '../enums/fleet-report.enum';
import { FleetReportAccessService } from './fleet-report-access.service';
import { FleetReportAudienceService } from './fleet-report-audience.service';

const REF = {
  kind: FleetScopeKind.FLEET,
  id: 'fleet-1',
  withinCommunityId: 'community-1',
};

/** One report at each audience; the fifth left private. */
const CHOSEN = new Map([
  [FleetReport.GROWTH, FleetAudience.PUBLIC],
  [FleetReport.TENURE, FleetAudience.COMMUNITY],
  [FleetReport.RANKS, FleetAudience.FLEET_MEMBERS],
  [FleetReport.ACTIVITY, FleetAudience.PRIVATE],
  [FleetReport.CONTRIBUTION, FleetAudience.PUBLIC],
]);

describe('FleetReportAccessService', () => {
  let authorisation: { authorise: jest.Mock };
  let audience: { canViewScope: jest.Mock; canView: jest.Mock };
  let reportAudiences: { chosen: jest.Mock };
  let service: FleetReportAccessService;

  /**
   * Makes the viewer hold some capabilities at the Fleet.
   *
   * @param capabilities - What they hold.
   */
  function holding(...capabilities: FleetCapability[]): void {
    authorisation.authorise.mockResolvedValue({
      capabilities: new Set(capabilities),
    });
  }

  beforeEach(() => {
    authorisation = { authorise: jest.fn(() => Promise.resolve(null)) };
    audience = {
      canViewScope: jest.fn(() => Promise.resolve(true)),
      canView: jest.fn(() => Promise.resolve(false)),
    };
    reportAudiences = { chosen: jest.fn(() => Promise.resolve(CHOSEN)) };
    service = new FleetReportAccessService(
      authorisation as unknown as FleetAuthorisationService,
      audience as unknown as FleetAudienceService,
      reportAudiences as unknown as FleetReportAudienceService,
    );
  });

  describe('visible', () => {
    it('shows a reports.view holder every report in full', async () => {
      holding(FLEET_CAPABILITIES.REPORTS_VIEW, FLEET_CAPABILITIES.ROSTER_VIEW);

      const views = await service.visible(REF, 'owner-1');

      expect([...views]).toEqual(
        [...CHOSEN.keys()].map(report => [report, FleetReportView.FULL]),
      );
      expect(authorisation.authorise).toHaveBeenCalledWith('owner-1', REF);
    });

    it('shows a member every report wider than private, in full', async () => {
      holding(FLEET_CAPABILITIES.ROSTER_VIEW);

      await expect(service.visible(REF, 'member-1')).resolves.toEqual(
        new Map([
          [FleetReport.GROWTH, FleetReportView.FULL],
          [FleetReport.TENURE, FleetReportView.FULL],
          [FleetReport.RANKS, FleetReportView.FULL],
          [FleetReport.CONTRIBUTION, FleetReportView.FULL],
        ]),
      );
    });

    it('shows a follower the Community and public reports as aggregates', async () => {
      audience.canView.mockResolvedValue(true);

      await expect(service.visible(REF, 'follower-1')).resolves.toEqual(
        new Map([
          [FleetReport.GROWTH, FleetReportView.AGGREGATE],
          [FleetReport.TENURE, FleetReportView.AGGREGATE],
          [FleetReport.CONTRIBUTION, FleetReportView.AGGREGATE],
        ]),
      );
      expect(audience.canView).toHaveBeenCalledWith(
        FleetAudience.COMMUNITY,
        REF,
        'follower-1',
      );
    });

    it('asks once whether the viewer follows, however many reports need it', async () => {
      reportAudiences.chosen.mockResolvedValue(
        new Map([
          [FleetReport.GROWTH, FleetAudience.COMMUNITY],
          [FleetReport.TENURE, FleetAudience.COMMUNITY],
        ]),
      );

      await service.visible(REF, 'visitor-1');

      expect(audience.canView).toHaveBeenCalledTimes(1);
    });

    it('shows anybody else, signed out included, the public reports as aggregates', async () => {
      await expect(service.visible(REF, null)).resolves.toEqual(
        new Map([
          [FleetReport.GROWTH, FleetReportView.AGGREGATE],
          [FleetReport.CONTRIBUTION, FleetReportView.AGGREGATE],
        ]),
      );
      expect(authorisation.authorise).toHaveBeenCalledWith(null, REF);
    });

    it('shows nothing of a Fleet the viewer may not see, public reports included', async () => {
      audience.canViewScope.mockResolvedValue(false);

      await expect(service.visible(REF, null)).resolves.toEqual(new Map());
      expect(reportAudiences.chosen).not.toHaveBeenCalled();
    });
  });

  describe('require', () => {
    it('says how much of a report the viewer is shown', async () => {
      await expect(
        service.require(REF, FleetReport.GROWTH, null),
      ).resolves.toBe(FleetReportView.AGGREGATE);
    });

    it('reports one hidden from the viewer as not found', async () => {
      await expect(
        service.require(REF, FleetReport.RANKS, null),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
