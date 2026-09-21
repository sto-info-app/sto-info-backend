import { NotFoundException } from '@nestjs/common';

import { FleetAudienceService } from './authorisation/fleet-audience.service';
import { FLEET_CAPABILITIES } from './authorisation/fleet-capability.constants';
import {
  REQUIRES_SCOPE_CAPABILITY_KEY,
  ScopeCapabilityRequirement,
} from './authorisation/requires-scope-capability.decorator';
import { CommunityArmadasController } from './community-armadas.controller';
import { FLEET_FEATURE_FLAGS } from './constants/fleet-feature.constants';
import { FleetCommunityEntity } from './entities/fleet-community.entity';
import { StoArmadaEntity } from './entities/sto-armada.entity';
import { FleetAudience } from './enums/fleet-audience.enum';
import { FleetScopeKind } from './enums/fleet-scope-kind.enum';
import { FleetFeatureService } from './fleet-feature.service';
import { StoArmadaMapper } from './mappers/sto-armada.mapper';
import { StoArmadaService } from './services/sto-armada.service';

const COMMUNITY_ID = '30000000-0000-4000-8000-000000000001';
const ARMADA_ID = '30000000-0000-4000-8000-000000000002';
const PLATFORM_ID = '30000000-0000-4000-8000-000000000003';
const USER_ID = '30000000-0000-4000-8000-000000000004';

const ARMADA = {
  id: ARMADA_ID,
  communityId: COMMUNITY_ID,
  platformId: PLATFORM_ID,
  exactGameName: 'Sol Armada',
  slug: 'sol-armada',
  community: { visibility: FleetAudience.COMMUNITY } as FleetCommunityEntity,
} as StoArmadaEntity;

const RIVAL = {
  id: '30000000-0000-4000-8000-000000000005',
  exactGameName: 'Sol Armada',
} as StoArmadaEntity;

describe('CommunityArmadasController', () => {
  let controller: CommunityArmadasController;
  let armadaService: {
    register: jest.Mock;
    findByIdOrFail: jest.Mock;
    findDuplicates: jest.Mock;
    update: jest.Mock;
    close: jest.Mock;
  };
  let audienceService: { assertCanView: jest.Mock };
  let featureService: {
    assertEnabled: jest.Mock;
    assertFlagEnabled: jest.Mock;
  };
  let mapper: { toDto: jest.Mock; toDuplicateDto: jest.Mock };

  beforeEach(() => {
    armadaService = {
      register: jest.fn(() =>
        Promise.resolve({ armada: ARMADA, duplicates: [RIVAL] }),
      ),
      findByIdOrFail: jest.fn(() => Promise.resolve(ARMADA)),
      findDuplicates: jest.fn(() => Promise.resolve([RIVAL])),
      update: jest.fn(() => Promise.resolve(ARMADA)),
      close: jest.fn(() => Promise.resolve(ARMADA)),
    };

    audienceService = { assertCanView: jest.fn(() => Promise.resolve()) };

    featureService = {
      assertEnabled: jest.fn(() => Promise.resolve()),
      assertFlagEnabled: jest.fn(() => Promise.resolve()),
    };

    mapper = {
      toDto: jest.fn((armada: StoArmadaEntity) => armada),
      toDuplicateDto: jest.fn((armada: StoArmadaEntity) => armada),
    };

    controller = new CommunityArmadasController(
      armadaService as unknown as StoArmadaService,
      audienceService as unknown as FleetAudienceService,
      featureService as unknown as FleetFeatureService,
      mapper as unknown as StoArmadaMapper,
    );
  });

  describe('register', () => {
    it('registers the Armada under the Community in the path', async () => {
      const registered = await controller.register(COMMUNITY_ID, USER_ID, {
        exactGameName: 'Sol Armada',
        platformId: PLATFORM_ID,
      });

      expect(registered.armada).toBe(ARMADA);
      expect(armadaService.register).toHaveBeenCalledWith(
        COMMUNITY_ID,
        { exactGameName: 'Sol Armada', platformId: PLATFORM_ID },
        USER_ID,
      );
    });

    it('returns what already answered to the name, having saved anyway', async () => {
      const registered = await controller.register(COMMUNITY_ID, USER_ID, {
        exactGameName: 'Sol Armada',
        platformId: PLATFORM_ID,
      });

      expect(registered.duplicates).toEqual([RIVAL]);
    });

    it('checks the registration flag rather than the master switch', async () => {
      await controller.register(COMMUNITY_ID, USER_ID, {
        exactGameName: 'Sol Armada',
        platformId: PLATFORM_ID,
      });

      expect(featureService.assertFlagEnabled).toHaveBeenCalledWith(
        FLEET_FEATURE_FLAGS.REGISTRATION_ENABLED,
      );
    });
  });

  describe('findDuplicates', () => {
    it('reports what already answers to the name on that platform', async () => {
      await expect(
        controller.findDuplicates(COMMUNITY_ID, {
          platformId: PLATFORM_ID,
          name: 'Sol Armada',
        }),
      ).resolves.toEqual([RIVAL]);
      expect(armadaService.findDuplicates).toHaveBeenCalledWith(
        PLATFORM_ID,
        'Sol Armada',
        { withinCommunityId: COMMUNITY_ID },
      );
    });

    it('refuses to answer while the feature is switched off', async () => {
      featureService.assertEnabled.mockRejectedValue(
        new NotFoundException('Not found'),
      );

      await expect(
        controller.findDuplicates(COMMUNITY_ID, {
          platformId: PLATFORM_ID,
          name: 'Sol Armada',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(armadaService.findDuplicates).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('reads the Armada', async () => {
      await expect(
        controller.findOne(COMMUNITY_ID, ARMADA_ID, USER_ID),
      ).resolves.toBe(ARMADA);
    });

    /**
     * An Armada has no audience of its own, so the Community's is applied —
     * and applied against the Community, which is where it was declared.
     * Pairing an audience with a scope it was not set on is the kind of
     * mismatch that quietly widens a check.
     */
    it('asks whether the caller may see the Community holding it', async () => {
      await controller.findOne(COMMUNITY_ID, ARMADA_ID, USER_ID);

      expect(audienceService.assertCanView).toHaveBeenCalledWith(
        FleetAudience.COMMUNITY,
        { kind: FleetScopeKind.COMMUNITY, id: COMMUNITY_ID },
        USER_ID,
      );
    });

    it('reports an Armada whose Community the caller may not see as absent', async () => {
      audienceService.assertCanView.mockRejectedValue(
        new NotFoundException('Not found'),
      );

      await expect(
        controller.findOne(COMMUNITY_ID, ARMADA_ID, null),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('changes the Armada’s settings', async () => {
      await expect(
        controller.update(COMMUNITY_ID, ARMADA_ID, USER_ID, {
          displayName: 'The Sol Lot',
        }),
      ).resolves.toBe(ARMADA);
      expect(armadaService.update).toHaveBeenCalledWith(
        COMMUNITY_ID,
        ARMADA_ID,
        { displayName: 'The Sol Lot' },
        USER_ID,
      );
    });

    it('checks the master switch before anything else', async () => {
      featureService.assertEnabled.mockRejectedValue(
        new NotFoundException('Not found'),
      );

      await expect(
        controller.update(COMMUNITY_ID, ARMADA_ID, USER_ID, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(armadaService.update).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('closes the Armada', async () => {
      await expect(
        controller.close(COMMUNITY_ID, ARMADA_ID, USER_ID),
      ).resolves.toBe(ARMADA);
      expect(armadaService.close).toHaveBeenCalledWith(
        COMMUNITY_ID,
        ARMADA_ID,
        USER_ID,
      );
    });
  });

  /**
   * Read back from the metadata rather than reviewed by eye. A mistyped
   * capability denies quietly and looks exactly like a working restriction.
   */
  describe('the capabilities the routes require', () => {
    const requirementOf = (
      method: keyof CommunityArmadasController,
    ): ScopeCapabilityRequirement | undefined =>
      Reflect.getMetadata(
        REQUIRES_SCOPE_CAPABILITY_KEY,
        CommunityArmadasController.prototype[method],
      );

    it.each(['register', 'findDuplicates'] as const)(
      'requires the child-registration capability at the Community to %s',
      method => {
        expect(requirementOf(method)).toEqual({
          capability: FLEET_CAPABILITIES.SCOPE_CHILDREN_REGISTER,
          source: { kind: FleetScopeKind.COMMUNITY, param: 'communityId' },
        });
      },
    );

    it('requires settings management at the Armada to change one', () => {
      expect(requirementOf('update')).toEqual({
        capability: FLEET_CAPABILITIES.SCOPE_SETTINGS_MANAGE,
        source: {
          kind: FleetScopeKind.ARMADA,
          param: 'armadaId',
          communityParam: 'communityId',
        },
      });
    });

    it('requires the closure capability at the Armada to close one', () => {
      expect(requirementOf('close')).toEqual({
        capability: FLEET_CAPABILITIES.SCOPE_CLOSE,
        source: {
          kind: FleetScopeKind.ARMADA,
          param: 'armadaId',
          communityParam: 'communityId',
        },
      });
    });

    /**
     * Managing the Armada record is not managing its placements. Which
     * Fleets are in it is `armada.manage` against a different table, with
     * topology rules these routes know nothing about.
     */
    it.each(['register', 'update', 'close'] as const)(
      'does not let the %s route stand in for managing placements',
      method => {
        expect(requirementOf(method)?.capability).not.toBe(
          FLEET_CAPABILITIES.ARMADA_MANAGE,
        );
      },
    );

    it('requires none to read, which is a question for the audience', () => {
      expect(requirementOf('findOne')).toBeUndefined();
    });
  });
});
