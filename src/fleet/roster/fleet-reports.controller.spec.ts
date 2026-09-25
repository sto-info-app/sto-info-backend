import { NotFoundException } from '@nestjs/common';

import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { REQUIRES_SCOPE_CAPABILITY_KEY } from '../authorisation/requires-scope-capability.decorator';
import { FLEET_FEATURE_FLAGS } from '../constants/fleet-feature.constants';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { FleetReportView } from './enums/fleet-report-view.enum';
import { FleetReport } from './enums/fleet-report.enum';
import { FleetReportsController } from './fleet-reports.controller';
import { FleetReportAccessService } from './services/fleet-report-access.service';
import { FleetReportAudienceService } from './services/fleet-report-audience.service';

const SOURCE = {
  kind: FleetScopeKind.FLEET,
  param: 'fleetId',
  communityParam: 'communityId',
};

describe('FleetReportsController', () => {
  let audienceService: { audiences: jest.Mock; set: jest.Mock };
  let accessService: { visible: jest.Mock };
  let featureService: { assertFlagEnabled: jest.Mock };
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
    };
    featureService = {
      assertFlagEnabled: jest.fn(() => Promise.resolve()),
    };
    controller = new FleetReportsController(
      audienceService as unknown as FleetReportAudienceService,
      accessService as unknown as FleetReportAccessService,
      featureService as unknown as FleetFeatureService,
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
    );
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

  it('reads the audiences', async () => {
    await expect(controller.audiences('fleet-1')).resolves.toEqual({
      reports: [],
      changes: [],
    });
    expect(featureService.assertFlagEnabled).toHaveBeenCalledWith(
      FLEET_FEATURE_FLAGS.IMPORTS_ENABLED,
    );
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

  it('is hidden while imports are switched off', async () => {
    featureService.assertFlagEnabled.mockRejectedValue(
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
      controller.setAudience('fleet-1', FleetReport.GROWTH, 'owner-1', {
        audience: FleetAudience.PUBLIC,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(audienceService.audiences).not.toHaveBeenCalled();
    expect(audienceService.set).not.toHaveBeenCalled();
  });
});
