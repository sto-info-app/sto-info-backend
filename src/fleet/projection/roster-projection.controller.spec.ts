import { NotFoundException } from '@nestjs/common';

import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { REQUIRES_SCOPE_CAPABILITY_KEY } from '../authorisation/requires-scope-capability.decorator';
import { FLEET_FEATURE_FLAGS } from '../constants/fleet-feature.constants';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { RosterProjectionController } from './roster-projection.controller';
import { RosterProjectionStatusService } from './services/roster-projection-status.service';

describe('RosterProjectionController', () => {
  let statusService: { status: jest.Mock };
  let featureService: { assertFlagEnabled: jest.Mock };
  let controller: RosterProjectionController;

  beforeEach(() => {
    statusService = {
      status: jest.fn(() => Promise.resolve({ revision: 3 })),
    };
    featureService = {
      assertFlagEnabled: jest.fn(() => Promise.resolve()),
    };
    controller = new RosterProjectionController(
      statusService as unknown as RosterProjectionStatusService,
      featureService as unknown as FleetFeatureService,
    );
  });

  // Whoever sends rosters and whoever corrects them both need to know
  // whether their change has reached the history.
  it('is open to importers and investigators alike', () => {
    expect(
      Reflect.getMetadata(
        REQUIRES_SCOPE_CAPABILITY_KEY,
        RosterProjectionController.prototype.status,
      ),
    ).toEqual({
      capability: [
        FLEET_CAPABILITIES.ROSTER_IMPORT,
        FLEET_CAPABILITIES.ROSTER_INVESTIGATE,
      ],
      source: {
        kind: FleetScopeKind.FLEET,
        param: 'fleetId',
        communityParam: 'communityId',
      },
    });
  });

  it('reports the Fleet it was asked about', async () => {
    await expect(controller.status('fleet-1')).resolves.toEqual({
      revision: 3,
    });

    expect(featureService.assertFlagEnabled).toHaveBeenCalledWith(
      FLEET_FEATURE_FLAGS.IMPORTS_ENABLED,
    );
    expect(statusService.status).toHaveBeenCalledWith('fleet-1');
  });

  it('is hidden while imports are switched off', async () => {
    featureService.assertFlagEnabled.mockRejectedValue(
      new NotFoundException('Not found'),
    );

    await expect(controller.status('fleet-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(statusService.status).not.toHaveBeenCalled();
  });
});
