import { NotFoundException } from '@nestjs/common';

import { FleetAuthorisationService } from '../authorisation/fleet-authorisation.service';
import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { REQUIRES_SCOPE_CAPABILITY_KEY } from '../authorisation/requires-scope-capability.decorator';
import { FLEET_FEATURE_FLAGS } from '../constants/fleet-feature.constants';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { RosterController } from './roster.controller';
import { RosterViewService } from './services/roster-view.service';

describe('RosterController', () => {
  let viewService: { page: jest.Mock };
  let authorisationService: { hasCapability: jest.Mock };
  let featureService: { assertFlagEnabled: jest.Mock };
  let controller: RosterController;

  beforeEach(() => {
    viewService = { page: jest.fn(() => Promise.resolve({ revision: 3 })) };
    authorisationService = {
      hasCapability: jest.fn(() => Promise.resolve(false)),
    };
    featureService = {
      assertFlagEnabled: jest.fn(() => Promise.resolve()),
    };
    controller = new RosterController(
      viewService as unknown as RosterViewService,
      authorisationService as unknown as FleetAuthorisationService,
      featureService as unknown as FleetFeatureService,
    );
  });

  // The private roster: following a Community never confers roster.view.
  it('is for roster.view holders only', () => {
    expect(
      Reflect.getMetadata(
        REQUIRES_SCOPE_CAPABILITY_KEY,
        RosterController.prototype.roster,
      ),
    ).toEqual({
      capability: FLEET_CAPABILITIES.ROSTER_VIEW,
      source: {
        kind: FleetScopeKind.FLEET,
        param: 'fleetId',
        communityParam: 'communityId',
      },
    });
  });

  it('reads the roster as a reader', async () => {
    const query = { asOf: '2024-11-15T23:59:59Z' };

    await expect(
      controller.roster('fleet-1', query, 'user-1'),
    ).resolves.toEqual({ revision: 3 });

    expect(featureService.assertFlagEnabled).toHaveBeenCalledWith(
      FLEET_FEATURE_FLAGS.IMPORTS_ENABLED,
    );
    expect(authorisationService.hasCapability).toHaveBeenCalledWith(
      'user-1',
      { kind: FleetScopeKind.FLEET, id: 'fleet-1' },
      FLEET_CAPABILITIES.ROSTER_INVESTIGATE,
    );
    expect(viewService.page).toHaveBeenCalledWith('fleet-1', query, {
      userId: 'user-1',
      investigator: false,
    });
  });

  it('reads the roster as an investigator when they are one', async () => {
    authorisationService.hasCapability.mockResolvedValue(true);

    await controller.roster('fleet-1', {}, 'user-1');

    expect(viewService.page).toHaveBeenCalledWith(
      'fleet-1',
      {},
      { userId: 'user-1', investigator: true },
    );
  });

  it('is hidden while imports are switched off', async () => {
    featureService.assertFlagEnabled.mockRejectedValue(
      new NotFoundException('Not found'),
    );

    await expect(
      controller.roster('fleet-1', {}, 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(viewService.page).not.toHaveBeenCalled();
  });
});
