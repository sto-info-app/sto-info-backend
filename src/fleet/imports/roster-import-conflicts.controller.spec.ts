import { NotFoundException } from '@nestjs/common';

import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { REQUIRES_SCOPE_CAPABILITY_KEY } from '../authorisation/requires-scope-capability.decorator';
import { FLEET_FEATURE_FLAGS } from '../constants/fleet-feature.constants';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { RosterImportConflictFilter } from './enums/roster-import-conflict-filter.enum';
import { RosterImportConflictsController } from './roster-import-conflicts.controller';
import { RosterImportStatusService } from './services/roster-import-status.service';

describe('RosterImportConflictsController', () => {
  let statusService: { conflicts: jest.Mock };
  let featureService: { assertFlagEnabled: jest.Mock };
  let controller: RosterImportConflictsController;

  beforeEach(() => {
    statusService = {
      conflicts: jest.fn(() =>
        Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20 }),
      ),
    };
    featureService = {
      assertFlagEnabled: jest.fn(() => Promise.resolve()),
    };
    controller = new RosterImportConflictsController(
      statusService as unknown as RosterImportStatusService,
      featureService as unknown as FleetFeatureService,
    );
  });

  // Settling a conflict is investigating; an importer only sees their own.
  it('is open to investigators only', () => {
    expect(
      Reflect.getMetadata(
        REQUIRES_SCOPE_CAPABILITY_KEY,
        RosterImportConflictsController.prototype.list,
      ),
    ).toEqual({
      capability: FLEET_CAPABILITIES.ROSTER_INVESTIGATE,
      source: {
        kind: FleetScopeKind.FLEET,
        param: 'fleetId',
        communityParam: 'communityId',
      },
    });
  });

  it('lists the groups asked for', async () => {
    await expect(
      controller.list('fleet-1', {
        state: RosterImportConflictFilter.SETTLED,
        page: 2,
        pageSize: 10,
      }),
    ).resolves.toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
    expect(featureService.assertFlagEnabled).toHaveBeenCalledWith(
      FLEET_FEATURE_FLAGS.IMPORTS_ENABLED,
    );
    expect(statusService.conflicts).toHaveBeenCalledWith(
      'fleet-1',
      RosterImportConflictFilter.SETTLED,
      2,
      10,
    );
  });

  it('is hidden while imports are switched off', async () => {
    featureService.assertFlagEnabled.mockRejectedValue(
      new NotFoundException('Not found'),
    );

    await expect(controller.list('fleet-1', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(statusService.conflicts).not.toHaveBeenCalled();
  });
});
