import { NotFoundException } from '@nestjs/common';

import {
  REQUIRES_SCOPE_CAPABILITY_KEY,
  ScopeCapabilityRequirement,
} from './authorisation/requires-scope-capability.decorator';
import { FLEET_FEATURE_FLAGS } from './constants/fleet-feature.constants';
import { StoFleetEntity } from './entities/sto-fleet.entity';
import { FleetFeatureService } from './fleet-feature.service';
import { StoFleetMapper } from './mappers/sto-fleet.mapper';
import { StoFleetService } from './services/sto-fleet.service';
import { UnregisteredFleetsController } from './unregistered-fleets.controller';

const USER_ID = '40000000-0000-4000-8000-000000000001';
const PLATFORM_ID = '40000000-0000-4000-8000-000000000002';

const FLEET = {
  id: '40000000-0000-4000-8000-000000000003',
  communityId: null,
  platformId: PLATFORM_ID,
  exactGameName: 'Omega Command',
} as StoFleetEntity;

const RIVAL = {
  id: '40000000-0000-4000-8000-000000000004',
  exactGameName: 'Omega Command',
} as StoFleetEntity;

const BODY = {
  exactGameName: 'Omega Command',
  platformId: PLATFORM_ID,
  confirmUnregistered: true as const,
};

describe('UnregisteredFleetsController', () => {
  let controller: UnregisteredFleetsController;
  let fleetService: { registerUnregistered: jest.Mock };
  let featureService: {
    assertEnabled: jest.Mock;
    assertFlagEnabled: jest.Mock;
  };
  let mapper: { toDto: jest.Mock; toDuplicateDto: jest.Mock };

  beforeEach(() => {
    fleetService = {
      registerUnregistered: jest.fn(() =>
        Promise.resolve({ fleet: FLEET, duplicates: [RIVAL] }),
      ),
    };

    featureService = {
      assertEnabled: jest.fn(() => Promise.resolve()),
      assertFlagEnabled: jest.fn(() => Promise.resolve()),
    };

    mapper = {
      toDto: jest.fn((fleet: StoFleetEntity) => fleet),
      toDuplicateDto: jest.fn((fleet: StoFleetEntity) => fleet),
    };

    controller = new UnregisteredFleetsController(
      fleetService as unknown as StoFleetService,
      featureService as unknown as FleetFeatureService,
      mapper as unknown as StoFleetMapper,
    );
  });

  it('confirms a Fleet that belongs to no Community', async () => {
    const confirmed = await controller.confirm(USER_ID, BODY);

    expect(confirmed.fleet).toBe(FLEET);
    expect(fleetService.registerUnregistered).toHaveBeenCalledWith(
      BODY,
      USER_ID,
    );
  });

  /**
   * The same rule as everywhere else: never refuse for looking like
   * something that already exists. Here it matters more, because the person
   * confirming has no Community of their own to compare against and the
   * list is the only thing telling them the record may be unnecessary.
   */
  it('returns what already answered to the name, having saved anyway', async () => {
    const confirmed = await controller.confirm(USER_ID, BODY);

    expect(confirmed.duplicates).toEqual([RIVAL]);
  });

  it('checks the registration flag rather than the master switch', async () => {
    await controller.confirm(USER_ID, BODY);

    expect(featureService.assertFlagEnabled).toHaveBeenCalledWith(
      FLEET_FEATURE_FLAGS.REGISTRATION_ENABLED,
    );
  });

  it('writes nothing while registration is switched off', async () => {
    featureService.assertFlagEnabled.mockRejectedValue(
      new NotFoundException('Not found'),
    );

    await expect(controller.confirm(USER_ID, BODY)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(fleetService.registerUnregistered).not.toHaveBeenCalled();
  });

  /**
   * There is no scope to hold a capability at and no owner to hold one
   * either, so the route declares none. Stating that as a test rather than
   * leaving it unsaid is the point: a scoped capability quietly added here
   * would never match, and would deny every request while looking exactly
   * like a working restriction.
   */
  it('requires no scoped capability, because there is no scope at all', () => {
    const requirement: ScopeCapabilityRequirement | undefined =
      Reflect.getMetadata(
        REQUIRES_SCOPE_CAPABILITY_KEY,
        UnregisteredFleetsController.prototype.confirm,
      );

    expect(requirement).toBeUndefined();
  });
});
