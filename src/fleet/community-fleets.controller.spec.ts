import { NotFoundException } from '@nestjs/common';

import { FleetAudienceService } from './authorisation/fleet-audience.service';
import { FLEET_CAPABILITIES } from './authorisation/fleet-capability.constants';
import {
  REQUIRES_SCOPE_CAPABILITY_KEY,
  ScopeCapabilityRequirement,
} from './authorisation/requires-scope-capability.decorator';
import { CommunityFleetsController } from './community-fleets.controller';
import { FLEET_FEATURE_FLAGS } from './constants/fleet-feature.constants';
import { StoFleetEntity } from './entities/sto-fleet.entity';
import { FleetAudience } from './enums/fleet-audience.enum';
import { FleetScopeKind } from './enums/fleet-scope-kind.enum';
import { FleetFeatureService } from './fleet-feature.service';
import { StoFleetMapper } from './mappers/sto-fleet.mapper';
import { StoFleetService } from './services/sto-fleet.service';

const COMMUNITY_ID = '10000000-0000-4000-8000-000000000001';
const FLEET_ID = '10000000-0000-4000-8000-000000000002';
const PLATFORM_ID = '10000000-0000-4000-8000-000000000003';
const USER_ID = '10000000-0000-4000-8000-000000000004';

const FLEET = {
  id: FLEET_ID,
  communityId: COMMUNITY_ID,
  platformId: PLATFORM_ID,
  exactGameName: ' Omega Command',
  slug: 'omega-command',
  visibility: FleetAudience.PUBLIC,
} as StoFleetEntity;

const RIVAL = {
  id: '10000000-0000-4000-8000-000000000005',
  exactGameName: 'Omega Command',
} as StoFleetEntity;

describe('CommunityFleetsController', () => {
  let controller: CommunityFleetsController;
  let fleetService: {
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
    fleetService = {
      register: jest.fn(() =>
        Promise.resolve({ fleet: FLEET, duplicates: [RIVAL] }),
      ),
      findByIdOrFail: jest.fn(() => Promise.resolve(FLEET)),
      findDuplicates: jest.fn(() => Promise.resolve([RIVAL])),
      update: jest.fn(() => Promise.resolve(FLEET)),
      close: jest.fn(() => Promise.resolve(FLEET)),
    };

    audienceService = { assertCanView: jest.fn(() => Promise.resolve()) };

    featureService = {
      assertEnabled: jest.fn(() => Promise.resolve()),
      assertFlagEnabled: jest.fn(() => Promise.resolve()),
    };

    mapper = {
      toDto: jest.fn((fleet: StoFleetEntity) => fleet),
      toDuplicateDto: jest.fn((fleet: StoFleetEntity) => fleet),
    };

    controller = new CommunityFleetsController(
      fleetService as unknown as StoFleetService,
      audienceService as unknown as FleetAudienceService,
      featureService as unknown as FleetFeatureService,
      mapper as unknown as StoFleetMapper,
    );
  });

  describe('register', () => {
    it('registers the Fleet under the Community in the path', async () => {
      const registered = await controller.register(COMMUNITY_ID, USER_ID, {
        exactGameName: ' Omega Command',
        platformId: PLATFORM_ID,
      });

      expect(registered.fleet).toBe(FLEET);
      expect(fleetService.register).toHaveBeenCalledWith(
        COMMUNITY_ID,
        { exactGameName: ' Omega Command', platformId: PLATFORM_ID },
        USER_ID,
      );
    });

    /**
     * FC-013's third acceptance criterion. A preflight answer can be stale by
     * the time the form is submitted, so the warning that matters is the one
     * describing what was actually saved.
     */
    it('returns what already answered to the name, having saved anyway', async () => {
      const registered = await controller.register(COMMUNITY_ID, USER_ID, {
        exactGameName: ' Omega Command',
        platformId: PLATFORM_ID,
      });

      expect(registered.duplicates).toEqual([RIVAL]);
    });

    it('checks the registration flag rather than the master switch', async () => {
      await controller.register(COMMUNITY_ID, USER_ID, {
        exactGameName: ' Omega Command',
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
          name: 'Omega Command',
        }),
      ).resolves.toEqual([RIVAL]);
    });

    it('includes the acting Community’s own records in the search', async () => {
      await controller.findDuplicates(COMMUNITY_ID, {
        platformId: PLATFORM_ID,
        name: 'Omega Command',
      });

      expect(fleetService.findDuplicates).toHaveBeenCalledWith(
        PLATFORM_ID,
        'Omega Command',
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
          name: 'Omega Command',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(fleetService.findDuplicates).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('reads the Fleet', async () => {
      await expect(
        controller.findOne(COMMUNITY_ID, FLEET_ID, USER_ID),
      ).resolves.toBe(FLEET);
      expect(fleetService.findByIdOrFail).toHaveBeenCalledWith(
        COMMUNITY_ID,
        FLEET_ID,
      );
    });

    it('serves a signed-out visitor a Fleet they may see', async () => {
      await expect(
        controller.findOne(COMMUNITY_ID, FLEET_ID, null),
      ).resolves.toBe(FLEET);
      expect(audienceService.assertCanView).toHaveBeenCalledWith(
        FleetAudience.PUBLIC,
        { kind: FleetScopeKind.FLEET, id: FLEET_ID },
        null,
      );
    });

    /**
     * A Fleet the caller may not see is absent rather than forbidden, so the
     * response cannot confirm that a private Fleet exists — plan section 5.
     */
    it('reports a Fleet the caller may not see as absent', async () => {
      audienceService.assertCanView.mockRejectedValue(
        new NotFoundException('Not found'),
      );

      await expect(
        controller.findOne(COMMUNITY_ID, FLEET_ID, null),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('changes the Fleet’s settings', async () => {
      await expect(
        controller.update(COMMUNITY_ID, FLEET_ID, USER_ID, {
          visibility: FleetAudience.PUBLIC,
        }),
      ).resolves.toBe(FLEET);
      expect(fleetService.update).toHaveBeenCalledWith(
        COMMUNITY_ID,
        FLEET_ID,
        { visibility: FleetAudience.PUBLIC },
        USER_ID,
      );
    });

    it('checks the master switch before anything else', async () => {
      featureService.assertEnabled.mockRejectedValue(
        new NotFoundException('Not found'),
      );

      await expect(
        controller.update(COMMUNITY_ID, FLEET_ID, USER_ID, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(fleetService.update).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('closes the Fleet', async () => {
      await expect(
        controller.close(COMMUNITY_ID, FLEET_ID, USER_ID),
      ).resolves.toBe(FLEET);
      expect(fleetService.close).toHaveBeenCalledWith(
        COMMUNITY_ID,
        FLEET_ID,
        USER_ID,
      );
    });
  });

  /**
   * Read back from the metadata rather than reviewed by eye. A mistyped
   * capability denies quietly and looks exactly like a working restriction,
   * which is the one failure in authorisation that nobody notices.
   */
  describe('the capabilities the routes require', () => {
    const requirementOf = (
      method: keyof CommunityFleetsController,
    ): ScopeCapabilityRequirement | undefined =>
      Reflect.getMetadata(
        REQUIRES_SCOPE_CAPABILITY_KEY,
        CommunityFleetsController.prototype[method],
      );

    /**
     * Checked at the Community, because there is no Fleet yet to check
     * against. The capability is delegable, so a Community need not route
     * every new Fleet through its Owner.
     */
    it('requires the child-registration capability at the Community', () => {
      expect(requirementOf('register')).toEqual({
        capability: FLEET_CAPABILITIES.SCOPE_CHILDREN_REGISTER,
        source: { kind: FleetScopeKind.COMMUNITY, param: 'communityId' },
      });
    });

    it('requires the same capability to ask what already exists', () => {
      expect(requirementOf('findDuplicates')).toEqual({
        capability: FLEET_CAPABILITIES.SCOPE_CHILDREN_REGISTER,
        source: { kind: FleetScopeKind.COMMUNITY, param: 'communityId' },
      });
    });

    /**
     * Once a Fleet exists it is a scope in its own right, so its own
     * settings are checked against it rather than against its Community.
     */
    it('requires settings management at the Fleet to change one', () => {
      expect(requirementOf('update')).toEqual({
        capability: FLEET_CAPABILITIES.SCOPE_SETTINGS_MANAGE,
        source: {
          kind: FleetScopeKind.FLEET,
          param: 'fleetId',
          communityParam: 'communityId',
        },
      });
    });

    it('requires the closure capability at the Fleet to close one', () => {
      expect(requirementOf('close')).toEqual({
        capability: FLEET_CAPABILITIES.SCOPE_CLOSE,
        source: {
          kind: FleetScopeKind.FLEET,
          param: 'fleetId',
          communityParam: 'communityId',
        },
      });
    });

    /**
     * Naming the Community parameter is what turns the path segment into a
     * checked claim: a Fleet held by a different Community resolves to
     * nothing. Leaving it out would make the segment decorative, which is
     * the shape most cross-tenant mistakes take.
     */
    it.each(['update', 'close'] as const)(
      'checks the Community segment of the %s route rather than trusting it',
      method => {
        expect(requirementOf(method)?.source.communityParam).toBe(
          'communityId',
        );
      },
    );

    /** Reading is visibility, not capability — ADR-0002. */
    it('requires none to read, which is a question for the audience', () => {
      expect(requirementOf('findOne')).toBeUndefined();
    });
  });
});
