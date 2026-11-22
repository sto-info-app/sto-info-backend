import { NotFoundException } from '@nestjs/common';

import { FleetAudienceService } from '../authorisation/fleet-audience.service';
import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { REQUIRES_SCOPE_CAPABILITY_KEY } from '../authorisation/requires-scope-capability.decorator';
import { FleetCommunityEntity } from '../entities/fleet-community.entity';
import { StoArmadaEntity } from '../entities/sto-armada.entity';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { ArmadaPosition } from '../enums/armada-position.enum';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { FleetCommunityService } from '../services/fleet-community.service';
import { StoArmadaService } from '../services/sto-armada.service';
import { StoFleetService } from '../services/sto-fleet.service';
import { ArmadaTopologyController } from './armada-topology.controller';
import { ArmadaArrangeService } from './services/armada-arrange.service';
import { ArmadaRequestService } from './services/armada-request.service';
import { ArmadaViewService } from './services/armada-view.service';

const COMMUNITY: FleetCommunityEntity = {
  id: 'community-1',
  visibility: FleetAudience.PUBLIC,
} as FleetCommunityEntity;
const ARMADA = {
  id: 'armada-1',
  communityId: 'community-1',
  community: COMMUNITY,
} as StoArmadaEntity;
const FLEET = {
  id: 'fleet-1',
  visibility: FleetAudience.COMMUNITY,
} as StoFleetEntity;

describe('ArmadaTopologyController', () => {
  let feature: { assertEnabled: jest.Mock };
  let communities: { findByIdOrFail: jest.Mock };
  let armadas: { findByIdOrFail: jest.Mock };
  let fleets: { findByIdOrFail: jest.Mock };
  let audience: { assertCanView: jest.Mock; assertCanViewFleet: jest.Mock };
  let views: Record<string, jest.Mock>;
  let requests: Record<string, jest.Mock>;
  let arrange: Record<string, jest.Mock>;
  let controller: ArmadaTopologyController;

  beforeEach(() => {
    feature = { assertEnabled: jest.fn(() => Promise.resolve()) };
    communities = { findByIdOrFail: jest.fn(() => Promise.resolve(COMMUNITY)) };
    armadas = { findByIdOrFail: jest.fn(() => Promise.resolve(ARMADA)) };
    fleets = { findByIdOrFail: jest.fn(() => Promise.resolve(FLEET)) };
    audience = {
      assertCanView: jest.fn(() => Promise.resolve()),
      assertCanViewFleet: jest.fn(() => Promise.resolve()),
    };
    views = {
      communityStructure: jest.fn(() => Promise.resolve('structure')),
      view: jest.fn(() => Promise.resolve('view')),
      history: jest.fn(() => Promise.resolve('history')),
      requests: jest.fn(() => Promise.resolve('requests')),
      fleetView: jest.fn(() => Promise.resolve('fleet view')),
    };
    requests = {
      request: jest.fn(() => Promise.resolve()),
      withdraw: jest.fn(() => Promise.resolve()),
      approve: jest.fn(() => Promise.resolve()),
      reject: jest.fn(() => Promise.resolve()),
    };
    arrange = {
      move: jest.fn(() => Promise.resolve()),
      remove: jest.fn(() => Promise.resolve()),
      leave: jest.fn(() => Promise.resolve()),
    };
    controller = new ArmadaTopologyController(
      feature as unknown as FleetFeatureService,
      communities as unknown as FleetCommunityService,
      armadas as unknown as StoArmadaService,
      fleets as unknown as StoFleetService,
      audience as unknown as FleetAudienceService,
      views as unknown as ArmadaViewService,
      requests as unknown as ArmadaRequestService,
      arrange as unknown as ArmadaArrangeService,
    );
  });

  describe('the capabilities the routes require', () => {
    const armadaSource = {
      kind: FleetScopeKind.ARMADA,
      param: 'armadaId',
      communityParam: 'communityId',
    };
    const fleetSource = {
      kind: FleetScopeKind.FLEET,
      param: 'fleetId',
      communityParam: 'communityId',
    };

    it.each([
      ['requests', FLEET_CAPABILITIES.ARMADA_MANAGE, armadaSource],
      ['approve', FLEET_CAPABILITIES.ARMADA_MANAGE, armadaSource],
      ['reject', FLEET_CAPABILITIES.ARMADA_MANAGE, armadaSource],
      ['move', FLEET_CAPABILITIES.ARMADA_MANAGE, armadaSource],
      ['remove', FLEET_CAPABILITIES.ARMADA_MANAGE, armadaSource],
      ['request', FLEET_CAPABILITIES.ARMADA_REQUEST, fleetSource],
      ['withdraw', FLEET_CAPABILITIES.ARMADA_REQUEST, fleetSource],
      ['leave', FLEET_CAPABILITIES.ARMADA_REQUEST, fleetSource],
    ] as const)('keeps %s to holders of %s', (route, capability, source) => {
      expect(
        Reflect.getMetadata(
          REQUIRES_SCOPE_CAPABILITY_KEY,
          ArmadaTopologyController.prototype[route],
        ),
      ).toEqual({ capability, source });
    });

    it.each(['communityStructure', 'view', 'history', 'fleetView'] as const)(
      'leaves %s to whoever may see it',
      route => {
        expect(
          Reflect.getMetadata(
            REQUIRES_SCOPE_CAPABILITY_KEY,
            ArmadaTopologyController.prototype[route],
          ),
        ).toBeUndefined();
      },
    );
  });

  describe('reading', () => {
    it('shows a Community’s structure to whoever may see the Community', async () => {
      await expect(
        controller.communityStructure('community-1', null),
      ).resolves.toBe('structure');
      expect(audience.assertCanView).toHaveBeenCalledWith(
        FleetAudience.PUBLIC,
        { kind: FleetScopeKind.COMMUNITY, id: 'community-1' },
        null,
      );
      expect(views.communityStructure).toHaveBeenCalledWith(COMMUNITY, null);
    });

    it('shows an Armada’s shape and history to whoever may see its Community', async () => {
      await expect(
        controller.view('community-1', 'armada-1', 'user-1'),
      ).resolves.toBe('view');
      await expect(
        controller.history('community-1', 'armada-1', 'user-1', { page: 2 }),
      ).resolves.toBe('history');

      expect(armadas.findByIdOrFail).toHaveBeenCalledWith(
        'community-1',
        'armada-1',
      );
      expect(views.history).toHaveBeenCalledWith(ARMADA, 'user-1', { page: 2 });
    });

    it('shows a Fleet’s Armada to whoever may see the Fleet', async () => {
      await expect(
        controller.fleetView('community-1', 'fleet-1', null),
      ).resolves.toBe('fleet view');
      expect(audience.assertCanViewFleet).toHaveBeenCalledWith(FLEET, null);
    });

    it('lists requests for a manager', async () => {
      await expect(
        controller.requests('community-1', 'armada-1', 'user-1', {}),
      ).resolves.toBe('requests');
      expect(views.requests).toHaveBeenCalledWith(ARMADA, 'user-1', {});
    });

    it('hides everything from somebody who may not see it', async () => {
      audience.assertCanView.mockRejectedValue(new NotFoundException());
      audience.assertCanViewFleet.mockRejectedValue(new NotFoundException());

      await expect(
        controller.view('community-1', 'armada-1', null),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        controller.fleetView('community-1', 'fleet-1', null),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(views.view).not.toHaveBeenCalled();
      expect(views.fleetView).not.toHaveBeenCalled();
    });
  });

  describe('changing', () => {
    it('answers a request, then shows the Armada as it now is', async () => {
      await expect(
        controller.approve('community-1', 'armada-1', 'request-1', 'user-1', {
          position: ArmadaPosition.BETA,
        }),
      ).resolves.toBe('view');
      await controller.reject(
        'community-1',
        'armada-1',
        'request-1',
        'user-1',
        {
          reason: 'Full',
        },
      );

      expect(requests.approve).toHaveBeenCalledWith(
        'community-1',
        'armada-1',
        'request-1',
        { position: ArmadaPosition.BETA },
        'user-1',
      );
      expect(requests.reject).toHaveBeenCalledWith(
        'community-1',
        'armada-1',
        'request-1',
        'Full',
        'user-1',
      );
      expect(views.view).toHaveBeenCalledWith(ARMADA, 'user-1');
    });

    it('moves and removes Fleets', async () => {
      const move = { position: ArmadaPosition.ALPHA, reason: 'Lead' };
      const remove = { reason: 'Inactive' };

      await controller.move(
        'community-1',
        'armada-1',
        'fleet-1',
        'user-1',
        move,
      );
      await controller.remove(
        'community-1',
        'armada-1',
        'fleet-1',
        'user-1',
        remove,
      );

      expect(arrange.move).toHaveBeenCalledWith(
        'community-1',
        'armada-1',
        'fleet-1',
        move,
        'user-1',
      );
      expect(arrange.remove).toHaveBeenCalledWith(
        'community-1',
        'armada-1',
        'fleet-1',
        remove,
        'user-1',
      );
    });

    it('asks, withdraws and leaves for a Fleet, then shows its Armada', async () => {
      await expect(
        controller.request('community-1', 'fleet-1', 'user-1', {
          armadaId: 'armada-1',
        }),
      ).resolves.toBe('fleet view');
      await controller.withdraw(
        'community-1',
        'fleet-1',
        'request-1',
        'user-1',
      );
      await controller.leave('community-1', 'fleet-1', 'user-1', {
        reason: 'Moving on',
      });

      expect(requests.request).toHaveBeenCalledWith(
        'community-1',
        'fleet-1',
        { armadaId: 'armada-1' },
        'user-1',
      );
      expect(requests.withdraw).toHaveBeenCalledWith(
        'community-1',
        'fleet-1',
        'request-1',
        'user-1',
      );
      expect(arrange.leave).toHaveBeenCalledWith(
        'community-1',
        'fleet-1',
        { reason: 'Moving on' },
        'user-1',
      );
      expect(views.fleetView).toHaveBeenCalledWith(FLEET, 'user-1');
    });

    it('checks the feature is on before every route', async () => {
      await controller.communityStructure('community-1', null);
      await controller.requests('community-1', 'armada-1', 'user-1', {});

      expect(feature.assertEnabled).toHaveBeenCalledTimes(2);
    });
  });
});
