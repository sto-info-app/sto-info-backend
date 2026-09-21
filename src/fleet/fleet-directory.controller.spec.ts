import { NotFoundException } from '@nestjs/common';

import {
  REQUIRES_SCOPE_CAPABILITY_KEY,
  ScopeCapabilityRequirement,
} from './authorisation/requires-scope-capability.decorator';
import { FleetCommunityEntity } from './entities/fleet-community.entity';
import { StoArmadaEntity } from './entities/sto-armada.entity';
import { StoFleetEntity } from './entities/sto-fleet.entity';
import { FleetDirectoryController } from './fleet-directory.controller';
import { FleetFeatureService } from './fleet-feature.service';
import { FleetCommunityMapper } from './mappers/fleet-community.mapper';
import { StoArmadaMapper } from './mappers/sto-armada.mapper';
import { StoFleetMapper } from './mappers/sto-fleet.mapper';
import { FleetCommunityService } from './services/fleet-community.service';
import { StoArmadaService } from './services/sto-armada.service';
import { StoFleetService } from './services/sto-fleet.service';

const COMMUNITY = {
  id: '50000000-0000-4000-8000-000000000001',
  name: 'Jupiter Force',
} as FleetCommunityEntity;

const FLEET = {
  id: '50000000-0000-4000-8000-000000000002',
  exactGameName: 'Omega Command',
} as StoFleetEntity;

const ARMADA = {
  id: '50000000-0000-4000-8000-000000000003',
  exactGameName: 'Sol Armada',
} as StoArmadaEntity;

/**
 * Builds the page shape a service hands the controller.
 *
 * @param items - What the page holds.
 * @returns A one-page result.
 */
function pageOf<T>(items: T[]): {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
} {
  return { items, total: 41, page: 2, pageSize: 20 };
}

describe('FleetDirectoryController', () => {
  let controller: FleetDirectoryController;
  let communityService: { findDirectoryPage: jest.Mock };
  let fleetService: { findDirectoryPage: jest.Mock };
  let armadaService: { findDirectoryPage: jest.Mock };
  let featureService: {
    assertEnabled: jest.Mock;
    assertFlagEnabled: jest.Mock;
  };
  let communityMapper: { toCardDto: jest.Mock };
  let fleetMapper: { toCardDto: jest.Mock };
  let armadaMapper: { toCardDto: jest.Mock };

  beforeEach(() => {
    communityService = {
      findDirectoryPage: jest.fn(() => Promise.resolve(pageOf([COMMUNITY]))),
    };

    fleetService = {
      findDirectoryPage: jest.fn(() =>
        Promise.resolve(pageOf([{ record: FLEET, duplicateCount: 3 }])),
      ),
    };

    armadaService = {
      findDirectoryPage: jest.fn(() =>
        Promise.resolve(pageOf([{ record: ARMADA, duplicateCount: 0 }])),
      ),
    };

    featureService = {
      assertEnabled: jest.fn(() => Promise.resolve()),
      assertFlagEnabled: jest.fn(() => Promise.resolve()),
    };

    communityMapper = { toCardDto: jest.fn(() => ({ id: COMMUNITY.id })) };
    fleetMapper = {
      toCardDto: jest.fn((entry: { duplicateCount: number }) => ({
        id: FLEET.id,
        duplicateCount: entry.duplicateCount,
      })),
    };
    armadaMapper = { toCardDto: jest.fn(() => ({ id: ARMADA.id })) };

    controller = new FleetDirectoryController(
      communityService as unknown as FleetCommunityService,
      fleetService as unknown as StoFleetService,
      armadaService as unknown as StoArmadaService,
      featureService as unknown as FleetFeatureService,
      communityMapper as unknown as FleetCommunityMapper,
      fleetMapper as unknown as StoFleetMapper,
      armadaMapper as unknown as StoArmadaMapper,
    );
  });

  describe('listCommunities', () => {
    it('answers a page of cards', async () => {
      const page = await controller.listCommunities({});

      expect(page.items).toStrictEqual([{ id: COMMUNITY.id }]);
      expect(page.total).toBe(41);
      expect(page.page).toBe(2);
      expect(page.pageSize).toBe(20);
    });

    it('passes the query through rather than interpreting it', async () => {
      const query = { search: 'jupiter', page: 2 };

      await controller.listCommunities(query);

      expect(communityService.findDirectoryPage).toHaveBeenCalledWith(query);
    });

    it('lists nothing while the feature is switched off', async () => {
      featureService.assertEnabled.mockRejectedValue(
        new NotFoundException('Not found'),
      );

      await expect(controller.listCommunities({})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(communityService.findDirectoryPage).not.toHaveBeenCalled();
    });
  });

  describe('listFleets', () => {
    it('answers a page of cards, each with its duplicate count', async () => {
      const page = await controller.listFleets({});

      expect(page.items).toStrictEqual([{ id: FLEET.id, duplicateCount: 3 }]);
    });

    it('passes the query through rather than interpreting it', async () => {
      const query = { search: 'omega', platformId: undefined };

      await controller.listFleets(query);

      expect(fleetService.findDirectoryPage).toHaveBeenCalledWith(query);
    });

    it('lists nothing while the feature is switched off', async () => {
      featureService.assertEnabled.mockRejectedValue(
        new NotFoundException('Not found'),
      );

      await expect(controller.listFleets({})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(fleetService.findDirectoryPage).not.toHaveBeenCalled();
    });
  });

  describe('listArmadas', () => {
    it('answers a page of cards', async () => {
      const page = await controller.listArmadas({});

      expect(page.items).toStrictEqual([{ id: ARMADA.id }]);
    });

    it('passes the query through rather than interpreting it', async () => {
      const query = { sort: undefined, pageSize: 5 };

      await controller.listArmadas(query);

      expect(armadaService.findDirectoryPage).toHaveBeenCalledWith(query);
    });

    it('lists nothing while the feature is switched off', async () => {
      featureService.assertEnabled.mockRejectedValue(
        new NotFoundException('Not found'),
      );

      await expect(controller.listArmadas({})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(armadaService.findDirectoryPage).not.toHaveBeenCalled();
    });
  });

  /**
   * The browse surface takes no token and holds no capability, and that is a
   * decision rather than an omission: the answer does not depend on who is
   * asking, so there is nothing to authenticate. Stated as a test because a
   * scoped capability added here by habit would name no scope to resolve, and
   * would deny every request while looking exactly like a working
   * restriction.
   */
  describe('the capabilities the routes require', () => {
    it.each([
      ['listCommunities', FleetDirectoryController.prototype.listCommunities],
      ['listFleets', FleetDirectoryController.prototype.listFleets],
      ['listArmadas', FleetDirectoryController.prototype.listArmadas],
    ])('%s requires none, there being no scope at all', (_name, handler) => {
      const requirement: ScopeCapabilityRequirement | undefined =
        Reflect.getMetadata(REQUIRES_SCOPE_CAPABILITY_KEY, handler);

      expect(requirement).toBeUndefined();
    });

    it.each([
      ['listCommunities', FleetDirectoryController.prototype.listCommunities],
      ['listFleets', FleetDirectoryController.prototype.listFleets],
      ['listArmadas', FleetDirectoryController.prototype.listArmadas],
    ])('%s is reachable signed out', (_name, handler) => {
      const guards: unknown[] | undefined = Reflect.getMetadata(
        '__guards__',
        handler,
      );

      expect(guards).toBeUndefined();
    });
  });
});
