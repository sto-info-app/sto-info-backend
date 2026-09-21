import { NotFoundException } from '@nestjs/common';

import { UserRole } from 'src/user/enums/user-role.enum';

import { FleetAudienceService } from './authorisation/fleet-audience.service';
import { FLEET_CAPABILITIES } from './authorisation/fleet-capability.constants';
import {
  REQUIRES_SCOPE_CAPABILITY_KEY,
  ScopeCapabilityRequirement,
} from './authorisation/requires-scope-capability.decorator';
import { FLEET_FEATURE_FLAGS } from './constants/fleet-feature.constants';
import { FleetCommunityEntity } from './entities/fleet-community.entity';
import { FleetAudience } from './enums/fleet-audience.enum';
import { FleetScopeKind } from './enums/fleet-scope-kind.enum';
import { FleetCommunitiesController } from './fleet-communities.controller';
import { FleetFeatureService } from './fleet-feature.service';
import { FleetCommunityMapper } from './mappers/fleet-community.mapper';
import { FleetCommunityService } from './services/fleet-community.service';
import { FleetScopeViewerService } from './services/fleet-scope-viewer.service';

const COMMUNITY_ID = '00000000-0000-4000-8000-000000000000';
const USER_ID = '22222222-2222-4222-8222-222222222222';

const COMMUNITY = {
  id: COMMUNITY_ID,
  ownerUserId: USER_ID,
  name: 'Jupiter Force',
  slug: 'jupiter-force',
  visibility: FleetAudience.PUBLIC,
} as FleetCommunityEntity;

/** What the viewer service answers for a caller who may do nothing. */
const NO_VIEWER = {
  capabilities: [],
  mayManageBanner: false,
  mayManageEmblem: false,
};

describe('FleetCommunitiesController', () => {
  let controller: FleetCommunitiesController;
  let communityService: {
    register: jest.Mock;
    findByIdOrFail: jest.Mock;
    resolveBySlugOrFail: jest.Mock;
    update: jest.Mock;
    close: jest.Mock;
  };
  let audienceService: { assertCanView: jest.Mock };
  let featureService: {
    assertEnabled: jest.Mock;
    assertFlagEnabled: jest.Mock;
  };
  let viewerService: { forScope: jest.Mock };
  let mapper: { toDto: jest.Mock };

  beforeEach(() => {
    communityService = {
      register: jest.fn(() => Promise.resolve(COMMUNITY)),
      findByIdOrFail: jest.fn(() => Promise.resolve(COMMUNITY)),
      resolveBySlugOrFail: jest.fn(() =>
        Promise.resolve({ community: COMMUNITY, redirectedFrom: null }),
      ),
      update: jest.fn(() => Promise.resolve(COMMUNITY)),
      close: jest.fn(() => Promise.resolve(COMMUNITY)),
    };

    audienceService = { assertCanView: jest.fn(() => Promise.resolve()) };

    featureService = {
      assertEnabled: jest.fn(() => Promise.resolve()),
      assertFlagEnabled: jest.fn(() => Promise.resolve()),
    };

    viewerService = { forScope: jest.fn(() => Promise.resolve(NO_VIEWER)) };
    mapper = { toDto: jest.fn((community: FleetCommunityEntity) => community) };

    controller = new FleetCommunitiesController(
      communityService as unknown as FleetCommunityService,
      audienceService as unknown as FleetAudienceService,
      featureService as unknown as FleetFeatureService,
      viewerService as unknown as FleetScopeViewerService,
      mapper as unknown as FleetCommunityMapper,
    );
  });

  describe('register', () => {
    it('registers the Community for the caller', async () => {
      await expect(
        controller.register(USER_ID, { name: 'Jupiter Force' }),
      ).resolves.toBe(COMMUNITY);
      expect(communityService.register).toHaveBeenCalledWith(
        { name: 'Jupiter Force' },
        USER_ID,
      );
    });

    it('checks the registration flag rather than the master switch', async () => {
      await controller.register(USER_ID, { name: 'Jupiter Force' });

      expect(featureService.assertFlagEnabled).toHaveBeenCalledWith(
        FLEET_FEATURE_FLAGS.REGISTRATION_ENABLED,
      );
    });

    /**
     * A switched-off feature answers 404 rather than "disabled", so a staged
     * rollout does not advertise what is coming — and it answers before the
     * body reaches the service.
     */
    it('refuses before registering anything when the feature is off', async () => {
      featureService.assertFlagEnabled.mockImplementationOnce(() => {
        throw new NotFoundException('Not found');
      });

      await expect(
        controller.register(USER_ID, { name: 'Jupiter Force' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(communityService.register).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('reads a Community the caller may see', async () => {
      await expect(controller.findOne(COMMUNITY_ID, USER_ID)).resolves.toBe(
        COMMUNITY,
      );
    });

    it('serves a signed-out visitor', async () => {
      await expect(controller.findOne(COMMUNITY_ID, null)).resolves.toBe(
        COMMUNITY,
      );
      expect(audienceService.assertCanView).toHaveBeenCalledWith(
        FleetAudience.PUBLIC,
        { kind: FleetScopeKind.COMMUNITY, id: COMMUNITY_ID },
        null,
      );
    });

    /**
     * Visibility is checked against the row rather than against the request,
     * and a Community the caller may not see is reported as absent — so the
     * response cannot confirm that a private one exists.
     */
    it('answers not found when the caller may not see it', async () => {
      audienceService.assertCanView.mockImplementationOnce(() => {
        throw new NotFoundException('Not found');
      });

      await expect(
        controller.findOne(COMMUNITY_ID, null),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses when the feature is switched off', async () => {
      featureService.assertEnabled.mockImplementationOnce(() => {
        throw new NotFoundException('Not found');
      });

      await expect(
        controller.findOne(COMMUNITY_ID, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(communityService.findByIdOrFail).not.toHaveBeenCalled();
    });
  });

  describe('resolveBySlug', () => {
    it('resolves a current segment with nothing to redirect', async () => {
      await expect(
        controller.resolveBySlug('jupiter-force', null, null),
      ).resolves.toEqual({
        community: COMMUNITY,
        redirectedFrom: null,
        viewer: NO_VIEWER,
      });
    });

    /*
     * Answered with the record rather than asked for separately. A page that
     * had to make a second request to find out whether to draw a control
     * would draw it after the reader had decided there was not one.
     */
    it('says what the caller may do to the Community it found', async () => {
      await controller.resolveBySlug('jupiter-force', USER_ID, UserRole.USER);

      expect(viewerService.forScope).toHaveBeenCalledWith(
        { userId: USER_ID, role: UserRole.USER },
        { kind: FleetScopeKind.COMMUNITY, id: COMMUNITY_ID },
      );
    });

    /**
     * Answered in the body rather than as a 301, because the caller is a
     * single-page application that has to replace its own history entry —
     * something a transparent HTTP redirect would have followed without
     * telling it.
     */
    it('reports the retired segment a link arrived on', async () => {
      communityService.resolveBySlugOrFail.mockResolvedValue({
        community: COMMUNITY,
        redirectedFrom: 'jupiter-fleet',
      });

      await expect(
        controller.resolveBySlug('jupiter-fleet', USER_ID, null),
      ).resolves.toEqual({
        community: COMMUNITY,
        redirectedFrom: 'jupiter-fleet',
        viewer: NO_VIEWER,
      });
    });

    it('checks visibility on what the segment resolved to', async () => {
      audienceService.assertCanView.mockImplementationOnce(() => {
        throw new NotFoundException('Not found');
      });

      await expect(
        controller.resolveBySlug('jupiter-force', null, null),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses when the feature is switched off', async () => {
      featureService.assertEnabled.mockImplementationOnce(() => {
        throw new NotFoundException('Not found');
      });

      await expect(
        controller.resolveBySlug('jupiter-force', null, null),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(communityService.resolveBySlugOrFail).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('applies the changes for the caller', async () => {
      await expect(
        controller.update(COMMUNITY_ID, USER_ID, { name: 'Jupiter Command' }),
      ).resolves.toBe(COMMUNITY);
      expect(communityService.update).toHaveBeenCalledWith(
        COMMUNITY_ID,
        { name: 'Jupiter Command' },
        USER_ID,
      );
    });

    it('refuses when the feature is switched off', async () => {
      featureService.assertEnabled.mockImplementationOnce(() => {
        throw new NotFoundException('Not found');
      });

      await expect(
        controller.update(COMMUNITY_ID, USER_ID, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(communityService.update).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('closes the Community for the caller', async () => {
      await expect(controller.close(COMMUNITY_ID, USER_ID)).resolves.toBe(
        COMMUNITY,
      );
      expect(communityService.close).toHaveBeenCalledWith(
        COMMUNITY_ID,
        USER_ID,
      );
    });

    it('refuses when the feature is switched off', async () => {
      featureService.assertEnabled.mockImplementationOnce(() => {
        throw new NotFoundException('Not found');
      });

      await expect(
        controller.close(COMMUNITY_ID, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(communityService.close).not.toHaveBeenCalled();
    });
  });

  /**
   * The capability a route requires is metadata, so a wrong one denies
   * quietly and looks exactly like a working restriction. Reading it back is
   * the only way the wiring is tested rather than reviewed.
   */
  describe('the capabilities the routes require', () => {
    const requirementOf = (
      method: keyof FleetCommunitiesController,
    ): ScopeCapabilityRequirement | undefined =>
      Reflect.getMetadata(
        REQUIRES_SCOPE_CAPABILITY_KEY,
        FleetCommunitiesController.prototype[method],
      );

    it('requires settings management to change a Community', () => {
      expect(requirementOf('update')).toEqual({
        capability: FLEET_CAPABILITIES.SCOPE_SETTINGS_MANAGE,
        source: { kind: FleetScopeKind.COMMUNITY, param: 'communityId' },
      });
    });

    it('requires the closure capability to close one', () => {
      expect(requirementOf('close')).toEqual({
        capability: FLEET_CAPABILITIES.SCOPE_CLOSE,
        source: { kind: FleetScopeKind.COMMUNITY, param: 'communityId' },
      });
    });

    /**
     * Registration cannot require a scoped capability: there is no scope yet
     * to hold one at. That is exactly why the owner limit is a database
     * trigger rather than a guard.
     */
    it('requires none to register, because there is no scope yet', () => {
      expect(requirementOf('register')).toBeUndefined();
    });

    /** Reading is visibility, not capability — ADR-0002. */
    it('requires none to read, which is a question for the audience', () => {
      expect(requirementOf('findOne')).toBeUndefined();
      expect(requirementOf('resolveBySlug')).toBeUndefined();
    });
  });
});
