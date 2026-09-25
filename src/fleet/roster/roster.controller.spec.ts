import { NotFoundException } from '@nestjs/common';

import { FleetAuthorisationService } from '../authorisation/fleet-authorisation.service';
import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { REQUIRES_SCOPE_CAPABILITY_KEY } from '../authorisation/requires-scope-capability.decorator';
import { FLEET_FEATURE_FLAGS } from '../constants/fleet-feature.constants';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { RosterChangeKind } from '../projection/enums/roster-change-kind.enum';
import { RosterController } from './roster.controller';
import { RosterHistoryService } from './services/roster-history.service';
import { RosterTimelineService } from './services/roster-timeline.service';
import { RosterViewService } from './services/roster-view.service';

describe('RosterController', () => {
  let viewService: { page: jest.Mock };
  let historyService: { page: jest.Mock };
  let timelineService: { timeline: jest.Mock };
  let authorisationService: { hasCapability: jest.Mock };
  let featureService: { assertFlagEnabled: jest.Mock };
  let controller: RosterController;

  beforeEach(() => {
    viewService = { page: jest.fn(() => Promise.resolve({ revision: 3 })) };
    historyService = {
      page: jest.fn(() => Promise.resolve({ revision: 3, items: [] })),
    };
    timelineService = {
      timeline: jest.fn(() => Promise.resolve({ identityId: 'identity-1' })),
    };
    authorisationService = {
      hasCapability: jest.fn(() => Promise.resolve(false)),
    };
    featureService = {
      assertFlagEnabled: jest.fn(() => Promise.resolve()),
    };
    controller = new RosterController(
      viewService as unknown as RosterViewService,
      historyService as unknown as RosterHistoryService,
      timelineService as unknown as RosterTimelineService,
      authorisationService as unknown as FleetAuthorisationService,
      featureService as unknown as FleetFeatureService,
    );
  });

  // The private roster: following a Community never confers roster.view.
  it.each(['roster', 'history', 'timeline'] as const)(
    'keeps %s to roster.view holders',
    route => {
      expect(
        Reflect.getMetadata(
          REQUIRES_SCOPE_CAPABILITY_KEY,
          RosterController.prototype[route],
        ),
      ).toEqual({
        capability: FLEET_CAPABILITIES.ROSTER_VIEW,
        source: {
          kind: FleetScopeKind.FLEET,
          param: 'fleetId',
          communityParam: 'communityId',
        },
      });
    },
  );

  describe('roster', () => {
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
  });

  describe('history', () => {
    it('reads the history asked for', async () => {
      const query = { page: 2, kinds: [RosterChangeKind.LEFT] };

      await expect(controller.history('fleet-1', query)).resolves.toEqual({
        revision: 3,
        items: [],
      });
      expect(historyService.page).toHaveBeenCalledWith('fleet-1', query);
    });
  });

  describe('timeline', () => {
    it('reads one member as the reader may see them', async () => {
      authorisationService.hasCapability.mockResolvedValue(true);

      await expect(
        controller.timeline('fleet-1', 'identity-1', 'user-1'),
      ).resolves.toEqual({ identityId: 'identity-1' });
      expect(timelineService.timeline).toHaveBeenCalledWith(
        'fleet-1',
        'identity-1',
        { userId: 'user-1', investigator: true },
      );
    });
  });

  describe('while imports are switched off', () => {
    beforeEach(() => {
      featureService.assertFlagEnabled.mockRejectedValue(
        new NotFoundException('Not found'),
      );
    });

    it('hides the roster', async () => {
      await expect(
        controller.roster('fleet-1', {}, 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(viewService.page).not.toHaveBeenCalled();
    });

    it('hides the history', async () => {
      await expect(controller.history('fleet-1', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(historyService.page).not.toHaveBeenCalled();
    });

    it('hides a member', async () => {
      await expect(
        controller.timeline('fleet-1', 'identity-1', 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(timelineService.timeline).not.toHaveBeenCalled();
    });
  });
});
