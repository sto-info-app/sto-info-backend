import { NotFoundException } from '@nestjs/common';

import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { REQUIRES_SCOPE_CAPABILITY_KEY } from '../authorisation/requires-scope-capability.decorator';
import { FLEET_FEATURE_FLAGS } from '../constants/fleet-feature.constants';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { StoFleetService } from '../services/sto-fleet.service';
import { FleetReportView } from './enums/fleet-report-view.enum';
import { FleetReport } from './enums/fleet-report.enum';
import { FleetReportsController } from './fleet-reports.controller';
import { FleetContributionReportService } from './services/fleet-contribution-report.service';
import { FleetGrowthReportService } from './services/fleet-growth-report.service';
import { FleetRecordReportsService } from './services/fleet-record-reports.service';
import { FleetReportAccessService } from './services/fleet-report-access.service';
import { FleetReportAudienceService } from './services/fleet-report-audience.service';
import { FleetReportContextService } from './services/fleet-report-context.service';
import { FleetReportCsvService } from './services/fleet-report-csv.service';
import { FleetTenureReportService } from './services/fleet-tenure-report.service';

const SOURCE = {
  kind: FleetScopeKind.FLEET,
  param: 'fleetId',
  communityParam: 'communityId',
};

describe('FleetReportsController', () => {
  let audienceService: { audiences: jest.Mock; set: jest.Mock };
  let accessService: { visible: jest.Mock; require: jest.Mock };
  let contextService: { open: jest.Mock };
  let growthService: { growth: jest.Mock; activity: jest.Mock };
  let tenureService: { tenure: jest.Mock; ranks: jest.Mock };
  let contributionService: { contribution: jest.Mock };
  let csvService: { render: jest.Mock };
  let fleetService: { findByIdOrFail: jest.Mock };
  let featureService: {
    assertEnabled: jest.Mock;
    assertFlagEnabled: jest.Mock;
    isFlagEnabled: jest.Mock;
  };
  let recordReports: {
    open: jest.Mock;
    attendance: jest.Mock;
    recruitment: jest.Mock;
    holdings: jest.Mock;
  };
  let controller: FleetReportsController;

  beforeEach(() => {
    audienceService = {
      audiences: jest.fn(() => Promise.resolve({ reports: [], changes: [] })),
      set: jest.fn(() => Promise.resolve({ reports: [], changes: [] })),
    };
    accessService = {
      visible: jest.fn(() =>
        Promise.resolve(
          new Map([
            [FleetReport.GROWTH, FleetReportView.AGGREGATE],
            [FleetReport.CONTRIBUTION, FleetReportView.AGGREGATE],
          ]),
        ),
      ),
      require: jest.fn(() => Promise.resolve(FleetReportView.AGGREGATE)),
    };
    contextService = {
      open: jest.fn(() => Promise.resolve({ fleetId: 'fleet-1' })),
    };
    growthService = {
      growth: jest.fn(() => Promise.resolve({ intervals: [] })),
      activity: jest.fn(() => Promise.resolve({ exports: [] })),
    };
    tenureService = {
      tenure: jest.fn(() => Promise.resolve({ members: [] })),
      ranks: jest.fn(() => Promise.resolve({ exports: [] })),
    };
    contributionService = {
      contribution: jest.fn(() => Promise.resolve({ intervals: [] })),
    };
    csvService = { render: jest.fn(() => 'csv text') };
    fleetService = {
      findByIdOrFail: jest.fn(() =>
        Promise.resolve({
          slug: 'fixture-basic-fleet',
          exactGameName: 'Fixture Basic Fleet',
        }),
      ),
    };
    featureService = {
      assertEnabled: jest.fn(() => Promise.resolve()),
      assertFlagEnabled: jest.fn(() => Promise.resolve()),
      isFlagEnabled: jest.fn(() => Promise.resolve(true)),
    };
    recordReports = {
      open: jest.fn(() => ({ fleetId: 'fleet-1' })),
      attendance: jest.fn(() => Promise.resolve({ occurrences: [] })),
      recruitment: jest.fn(() => Promise.resolve({ months: [] })),
      holdings: jest.fn(() => Promise.resolve({ changes: [] })),
    };
    controller = new FleetReportsController(
      audienceService as unknown as FleetReportAudienceService,
      accessService as unknown as FleetReportAccessService,
      contextService as unknown as FleetReportContextService,
      growthService as unknown as FleetGrowthReportService,
      tenureService as unknown as FleetTenureReportService,
      contributionService as unknown as FleetContributionReportService,
      csvService as unknown as FleetReportCsvService,
      fleetService as unknown as StoFleetService,
      featureService as unknown as FleetFeatureService,
      recordReports as unknown as FleetRecordReportsService,
    );
  });

  it('shows the audiences to reports.view holders', () => {
    expect(
      Reflect.getMetadata(
        REQUIRES_SCOPE_CAPABILITY_KEY,
        FleetReportsController.prototype.audiences,
      ),
    ).toEqual({ capability: FLEET_CAPABILITIES.REPORTS_VIEW, source: SOURCE });
  });

  // The Owner alone: scope.settings.manage is not delegable.
  it('lets only the Owner change one', () => {
    expect(
      Reflect.getMetadata(
        REQUIRES_SCOPE_CAPABILITY_KEY,
        FleetReportsController.prototype.setAudience,
      ),
    ).toEqual({
      capability: FLEET_CAPABILITIES.SCOPE_SETTINGS_MANAGE,
      source: SOURCE,
    });
  });

  it('lists the reports a viewer may see, asking about the Fleet the path names', async () => {
    await expect(
      controller.list('community-1', 'fleet-1', null),
    ).resolves.toEqual([
      { report: FleetReport.GROWTH, view: FleetReportView.AGGREGATE },
      { report: FleetReport.CONTRIBUTION, view: FleetReportView.AGGREGATE },
    ]);
    expect(accessService.visible).toHaveBeenCalledWith(
      {
        kind: FleetScopeKind.FLEET,
        id: 'fleet-1',
        withinCommunityId: 'community-1',
      },
      null,
      true,
    );
    expect(featureService.assertEnabled).toHaveBeenCalled();
  });

  // FC-030: the Fleet's own records are reported whether imports are on or not.
  it('lists the roster’s reports only while imports are on', async () => {
    featureService.isFlagEnabled.mockResolvedValue(false);

    await controller.list('community-1', 'fleet-1', 'user-1');

    expect(featureService.isFlagEnabled).toHaveBeenCalledWith(
      FLEET_FEATURE_FLAGS.IMPORTS_ENABLED,
    );
    expect(accessService.visible).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      false,
    );
  });

  describe.each([
    ['attendance', FleetReport.ATTENDANCE, { occurrences: [] }],
    ['recruitment', FleetReport.RECRUITMENT, { months: [] }],
    ['holdings', FleetReport.HOLDINGS, { changes: [] }],
  ] as const)('the %s report (FC-030)', (route, report, answer) => {
    it('is opened over the Fleet’s own records, as much as the viewer is shown', async () => {
      const query = { from: '2026-01-01T00:00:00Z' };

      await expect(
        controller[route]('community-1', 'fleet-1', query, 'user-1'),
      ).resolves.toEqual(answer);
      expect(featureService.assertEnabled).toHaveBeenCalled();
      expect(featureService.assertFlagEnabled).not.toHaveBeenCalled();
      expect(accessService.require).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'fleet-1' }),
        report,
        'user-1',
      );
      expect(recordReports.open).toHaveBeenCalledWith(
        'fleet-1',
        report,
        FleetReportView.AGGREGATE,
        query,
      );
      expect(recordReports[route]).toHaveBeenCalledWith({ fleetId: 'fleet-1' });
    });

    it('asks no capability of its viewer', () => {
      expect(
        Reflect.getMetadata(
          REQUIRES_SCOPE_CAPABILITY_KEY,
          FleetReportsController.prototype[route],
        ),
      ).toBeUndefined();
    });
  });

  // Open to anybody: the list itself decides what to show.
  it('asks no capability of whoever lists them', () => {
    expect(
      Reflect.getMetadata(
        REQUIRES_SCOPE_CAPABILITY_KEY,
        FleetReportsController.prototype.list,
      ),
    ).toBeUndefined();
  });

  describe.each([
    ['growth', FleetReport.GROWTH, { intervals: [] }],
    ['activity', FleetReport.ACTIVITY, { exports: [] }],
    ['tenure', FleetReport.TENURE, { members: [] }],
    ['ranks', FleetReport.RANKS, { exports: [] }],
    ['contribution', FleetReport.CONTRIBUTION, { intervals: [] }],
  ] as const)('the %s report', (route, report, answer) => {
    it('is opened as much as the viewer is shown, over the span asked for', async () => {
      const query = { from: '2024-01-01T00:00:00Z' };

      await expect(
        controller[route]('community-1', 'fleet-1', query, 'user-1'),
      ).resolves.toEqual(answer);
      expect(accessService.require).toHaveBeenCalledWith(
        {
          kind: FleetScopeKind.FLEET,
          id: 'fleet-1',
          withinCommunityId: 'community-1',
        },
        report,
        'user-1',
      );
      expect(contextService.open).toHaveBeenCalledWith(
        'fleet-1',
        report,
        FleetReportView.AGGREGATE,
        query,
      );
      const builders = {
        growth: growthService.growth,
        activity: growthService.activity,
        tenure: tenureService.tenure,
        ranks: tenureService.ranks,
        contribution: contributionService.contribution,
      };
      const builder = builders[route];

      expect(builder).toHaveBeenCalledWith({ fleetId: 'fleet-1' });
    });

    it('is refused as not found to a viewer who may not see it', async () => {
      accessService.require.mockRejectedValue(
        new NotFoundException('Not found'),
      );

      await expect(
        controller[route]('community-1', 'fleet-1', {}, null),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(contextService.open).not.toHaveBeenCalled();
    });

    it('asks no capability of its viewer', () => {
      expect(
        Reflect.getMetadata(
          REQUIRES_SCOPE_CAPABILITY_KEY,
          FleetReportsController.prototype[route],
        ),
      ).toBeUndefined();
    });
  });

  describe('the CSV export', () => {
    let headers: Record<string, string>;
    let response: { setHeader: jest.Mock };

    beforeEach(() => {
      headers = {};
      response = {
        setHeader: jest.fn((name: string, value: string) => {
          headers[name] = value;
        }),
      };
      jest.useFakeTimers({ now: new Date('2026-09-25T12:00:00Z') });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it.each([
      [FleetReport.GROWTH, () => growthService.growth],
      [FleetReport.ACTIVITY, () => growthService.activity],
      [FleetReport.TENURE, () => tenureService.tenure],
      [FleetReport.RANKS, () => tenureService.ranks],
      [FleetReport.CONTRIBUTION, () => contributionService.contribution],
    ])(
      'writes the %s report as the viewer is shown it',
      async (report, builder) => {
        contextService.open.mockResolvedValue({
          fleetId: 'fleet-1',
          header: { report },
        });

        await expect(
          controller.csv(
            'community-1',
            'fleet-1',
            report,
            {},
            null,
            response as never,
          ),
        ).resolves.toBe('csv text');
        expect(accessService.require).toHaveBeenCalledWith(
          expect.objectContaining({ withinCommunityId: 'community-1' }),
          report,
          null,
        );
        expect(builder()).toHaveBeenCalledWith({
          fleetId: 'fleet-1',
          header: { report },
        });
        expect(csvService.render).toHaveBeenCalledWith(
          expect.anything(),
          'Fixture Basic Fleet',
          new Date('2026-09-25T12:00:00Z'),
        );
        expect(fleetService.findByIdOrFail).toHaveBeenCalledWith(
          'community-1',
          'fleet-1',
        );
      },
    );

    it.each([
      [FleetReport.ATTENDANCE, () => recordReports.attendance],
      [FleetReport.RECRUITMENT, () => recordReports.recruitment],
      [FleetReport.HOLDINGS, () => recordReports.holdings],
    ])(
      'writes the %s report from the Fleet’s own records',
      async (report, builder) => {
        recordReports.open.mockReturnValue({
          fleetId: 'fleet-1',
          header: { report },
        });

        await expect(
          controller.csv(
            'community-1',
            'fleet-1',
            report,
            {},
            null,
            response as never,
          ),
        ).resolves.toBe('csv text');
        expect(builder()).toHaveBeenCalledWith({
          fleetId: 'fleet-1',
          header: { report },
        });
        expect(contextService.open).not.toHaveBeenCalled();
      },
    );

    it('offers it as a download named for the Fleet, report and day', async () => {
      contextService.open.mockResolvedValue({
        fleetId: 'fleet-1',
        header: { report: FleetReport.GROWTH },
      });

      await controller.csv(
        'community-1',
        'fleet-1',
        FleetReport.GROWTH,
        {},
        'user-1',
        response as never,
      );

      expect(headers).toEqual({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition':
          'attachment; filename="fixture-basic-fleet-growth-2026-09-25.csv"',
        'Cache-Control': 'private, no-store',
      });
    });

    it('writes nothing for a viewer who may not see the report', async () => {
      accessService.require.mockRejectedValue(
        new NotFoundException('Not found'),
      );

      await expect(
        controller.csv(
          'community-1',
          'fleet-1',
          FleetReport.GROWTH,
          {},
          null,
          response as never,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(csvService.render).not.toHaveBeenCalled();
      expect(response.setHeader).not.toHaveBeenCalled();
    });
  });

  it('reads the audiences', async () => {
    await expect(controller.audiences('fleet-1')).resolves.toEqual({
      reports: [],
      changes: [],
    });
    expect(featureService.assertEnabled).toHaveBeenCalled();
    expect(audienceService.audiences).toHaveBeenCalledWith('fleet-1');
  });

  it('changes one as asked', async () => {
    await controller.setAudience('fleet-1', FleetReport.GROWTH, 'owner-1', {
      audience: FleetAudience.PUBLIC,
    });

    expect(audienceService.set).toHaveBeenCalledWith(
      'fleet-1',
      FleetReport.GROWTH,
      FleetAudience.PUBLIC,
      'owner-1',
    );
  });

  it('hides the roster’s reports while imports are switched off', async () => {
    featureService.assertFlagEnabled.mockRejectedValue(
      new NotFoundException('Not found'),
    );

    await expect(
      controller.growth('community-1', 'fleet-1', {}, null),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(accessService.require).not.toHaveBeenCalled();
    expect(featureService.assertFlagEnabled).toHaveBeenCalledWith(
      FLEET_FEATURE_FLAGS.IMPORTS_ENABLED,
    );
  });

  it('is hidden while the Fleet feature is switched off', async () => {
    featureService.assertEnabled.mockRejectedValue(
      new NotFoundException('Not found'),
    );

    await expect(controller.audiences('fleet-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      controller.list('community-1', 'fleet-1', null),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(accessService.visible).not.toHaveBeenCalled();
    await expect(
      controller.attendance('community-1', 'fleet-1', {}, null),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(accessService.require).not.toHaveBeenCalled();
    await expect(
      controller.setAudience('fleet-1', FleetReport.GROWTH, 'owner-1', {
        audience: FleetAudience.PUBLIC,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(audienceService.audiences).not.toHaveBeenCalled();
    expect(audienceService.set).not.toHaveBeenCalled();
  });
});
