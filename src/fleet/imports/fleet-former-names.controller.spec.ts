import { NotFoundException } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';

import { FleetAuthorisationService } from '../authorisation/fleet-authorisation.service';
import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import {
  REQUIRES_SCOPE_CAPABILITY_KEY,
  ScopeCapabilityRequirement,
} from '../authorisation/requires-scope-capability.decorator';
import { FLEET_FEATURE_FLAGS } from '../constants/fleet-feature.constants';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { FleetFormerNamesController } from './fleet-former-names.controller';
import { FleetFormerNameService } from './services/fleet-former-name.service';

const COMMUNITY_ID = '3f2c1b0a-9e8d-4c7b-a6f5-e4d3c2b1a090';
const FLEET_ID = '8038747f-fcc3-41b4-b37e-83569c8800a3';
const ALIAS_ID = '0b6d8e1c-8f53-4a4e-9f5e-2f8f0c1d9a01';
const USER_ID = 'user-1';

const RECORD = {
  exactName: 'Old Name',
  validFrom: new Date('2025-01-01T00:00:00Z'),
  validTo: new Date('2026-01-01T00:00:00Z'),
  reason: 'Renamed in game in January',
};

describe('FleetFormerNamesController', () => {
  let names: { list: jest.Mock; record: jest.Mock; remove: jest.Mock };
  let feature: { assertFlagEnabled: jest.Mock };
  let authorisation: { hasCapability: jest.Mock };
  let controller: FleetFormerNamesController;

  beforeEach(() => {
    names = {
      list: jest.fn(() => Promise.resolve({ items: [] })),
      record: jest.fn(() => Promise.resolve({ id: ALIAS_ID })),
      remove: jest.fn(() => Promise.resolve({ id: ALIAS_ID })),
    };
    feature = { assertFlagEnabled: jest.fn(() => Promise.resolve()) };
    authorisation = { hasCapability: jest.fn(() => Promise.resolve(true)) };
    controller = new FleetFormerNamesController(
      names as unknown as FleetFormerNameService,
      feature as unknown as FleetFeatureService,
      authorisation as unknown as FleetAuthorisationService,
    );
  });

  describe.each([['list'], ['record'], ['remove']] as const)('%s', handler => {
    it('is for roster investigators of the Fleet', () => {
      const requirement = Reflect.getMetadata(
        REQUIRES_SCOPE_CAPABILITY_KEY,
        FleetFormerNamesController.prototype[handler],
      ) as ScopeCapabilityRequirement;

      expect(requirement).toEqual({
        // A site admin looking in reads, and never changes (FC-036).
        capability:
          handler === 'list'
            ? [
                FLEET_CAPABILITIES.ROSTER_INVESTIGATE,
                FLEET_CAPABILITIES.ROSTER_INVESTIGATE_READ,
              ]
            : FLEET_CAPABILITIES.ROSTER_INVESTIGATE,
        source: {
          kind: FleetScopeKind.FLEET,
          param: 'fleetId',
          communityParam: 'communityId',
        },
      });
    });

    it('is hidden while imports are switched off', async () => {
      feature.assertFlagEnabled.mockImplementationOnce(() => {
        throw new NotFoundException('Not found');
      });

      const calls = {
        list: () => controller.list(COMMUNITY_ID, FLEET_ID, USER_ID),
        record: () => controller.record(FLEET_ID, USER_ID, RECORD),
        remove: () =>
          controller.remove(FLEET_ID, ALIAS_ID, USER_ID, { reason: 'Wrong' }),
      };

      await expect(calls[handler]()).rejects.toBeInstanceOf(NotFoundException);
      expect(feature.assertFlagEnabled).toHaveBeenCalledWith(
        FLEET_FEATURE_FLAGS.IMPORTS_ENABLED,
      );
      expect(names[handler]).not.toHaveBeenCalled();
    });
  });

  it.each([true, false])(
    'lists the names, saying whether the reader may change them (%s)',
    async investigator => {
      authorisation.hasCapability.mockResolvedValue(investigator);

      await expect(
        controller.list(COMMUNITY_ID, FLEET_ID, USER_ID),
      ).resolves.toEqual({ items: [] });

      expect(authorisation.hasCapability).toHaveBeenCalledWith(
        USER_ID,
        {
          kind: FleetScopeKind.FLEET,
          id: FLEET_ID,
          withinCommunityId: COMMUNITY_ID,
        },
        FLEET_CAPABILITIES.ROSTER_INVESTIGATE,
      );
      expect(names.list).toHaveBeenCalledWith(FLEET_ID, investigator);
    },
  );

  it('records a name as the one recording it', async () => {
    await expect(controller.record(FLEET_ID, USER_ID, RECORD)).resolves.toEqual(
      { id: ALIAS_ID },
    );

    expect(names.record).toHaveBeenCalledWith(FLEET_ID, USER_ID, RECORD);
  });

  it('removes a name with its reason, answering 200', async () => {
    await controller.remove(FLEET_ID, ALIAS_ID, USER_ID, { reason: 'Wrong' });

    expect(names.remove).toHaveBeenCalledWith(FLEET_ID, ALIAS_ID, USER_ID, {
      reason: 'Wrong',
    });
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        FleetFormerNamesController.prototype.remove,
      ),
    ).toBe(200);
  });
});
