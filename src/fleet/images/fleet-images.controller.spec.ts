import { BadRequestException, NotFoundException } from '@nestjs/common';

import { jest } from '@jest/globals';

import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { UserRole } from 'src/user/enums/user-role.enum';

import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import {
  REQUIRES_SCOPE_CAPABILITY_KEY,
  ScopeCapabilityRequirement,
} from '../authorisation/requires-scope-capability.decorator';
import { FleetImageUploadDto } from '../dto/fleet-image-upload.dto';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { FleetImageService } from './fleet-image.service';
import { FleetImagesController } from './fleet-images.controller';

const COMMUNITY_ID = '70000000-0000-4000-8000-000000000001';
const FLEET_ID = '70000000-0000-4000-8000-000000000002';
const ARMADA_ID = '70000000-0000-4000-8000-000000000003';
const USER_ID = '70000000-0000-4000-8000-000000000009';

const FILE = { originalname: 'banner.jpg' } as Express.Multer.File;
const DTO = { altText: 'A fleet yard' } as FleetImageUploadDto;

/** A handler that sets a picture on a scope reached through a Community. */
type Setter = (
  id: string,
  userId: string,
  file: Express.Multer.File | undefined,
  dto: FleetImageUploadDto,
) => Promise<unknown>;

/** A handler that removes a picture from such a scope. */
type Clearer = (id: string) => Promise<unknown>;

/** A handler that sets a picture on a Fleet nobody has registered. */
type UnclaimedSetter = Setter;

/** A handler that removes one. */
type UnclaimedClearer = (
  id: string,
  userId: string,
  role: UserRole | null,
) => Promise<unknown>;

describe('FleetImagesController', () => {
  let controller: FleetImagesController;
  let imageService: {
    setArtwork: jest.Mock<(...args: any[]) => Promise<any>>;
    clearArtwork: jest.Mock<(...args: any[]) => Promise<any>>;
    setUnclaimedFleetArtwork: jest.Mock<(...args: any[]) => Promise<any>>;
    clearUnclaimedFleetArtwork: jest.Mock<(...args: any[]) => Promise<any>>;
  };
  let featureService: {
    assertEnabled: jest.Mock<(...args: any[]) => Promise<any>>;
  };

  beforeEach(() => {
    imageService = {
      setArtwork: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue({ assetId: 'asset-1', status: 'SCANNING' }),
      clearArtwork: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue(undefined),
      setUnclaimedFleetArtwork: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue({ assetId: 'asset-2', status: 'SCANNING' }),
      clearUnclaimedFleetArtwork: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue(undefined),
    };

    featureService = {
      assertEnabled: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue(undefined),
    };

    controller = new FleetImagesController(
      imageService as unknown as FleetImageService,
      featureService as unknown as FleetFeatureService,
    );
  });

  const setters: Array<
    [string, Setter, FleetScopeKind, string, FileAssetSlot]
  > = [
    [
      'a Community banner',
      (...args) => controller.setCommunityBanner(...args),
      FleetScopeKind.COMMUNITY,
      COMMUNITY_ID,
      FileAssetSlot.BANNER,
    ],
    [
      'a Community emblem',
      (...args) => controller.setCommunityEmblem(...args),
      FleetScopeKind.COMMUNITY,
      COMMUNITY_ID,
      FileAssetSlot.EMBLEM,
    ],
    [
      'a Fleet banner',
      (...args) => controller.setFleetBanner(...args),
      FleetScopeKind.FLEET,
      FLEET_ID,
      FileAssetSlot.BANNER,
    ],
    [
      'a Fleet emblem',
      (...args) => controller.setFleetEmblem(...args),
      FleetScopeKind.FLEET,
      FLEET_ID,
      FileAssetSlot.EMBLEM,
    ],
    [
      'an Armada banner',
      (...args) => controller.setArmadaBanner(...args),
      FleetScopeKind.ARMADA,
      ARMADA_ID,
      FileAssetSlot.BANNER,
    ],
    [
      'an Armada emblem',
      (...args) => controller.setArmadaEmblem(...args),
      FleetScopeKind.ARMADA,
      ARMADA_ID,
      FileAssetSlot.EMBLEM,
    ],
  ];

  describe.each(setters)('setting %s', (_name, handler, kind, id, slot) => {
    it('hands the scope, the slot and the description over', async () => {
      const accepted = await handler(id, USER_ID, FILE, DTO);

      expect(accepted).toEqual({ assetId: 'asset-1', status: 'SCANNING' });
      expect(imageService.setArtwork).toHaveBeenCalledWith({ kind, id }, slot, {
        userId: USER_ID,
        altText: 'A fleet yard',
        file: FILE,
      });
    });

    /**
     * Multer leaves the file undefined when the part is missing or was
     * rejected by the filter, and a scope would otherwise be sent to the
     * ingress with nothing to scan.
     */
    it('refuses a request carrying no file', async () => {
      await expect(handler(id, USER_ID, undefined, DTO)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(imageService.setArtwork).not.toHaveBeenCalled();
    });

    it('accepts nothing while the feature is switched off', async () => {
      featureService.assertEnabled.mockRejectedValue(
        new NotFoundException('Not found'),
      );

      await expect(handler(id, USER_ID, FILE, DTO)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(imageService.setArtwork).not.toHaveBeenCalled();
    });
  });

  const clearers: Array<
    [string, Clearer, FleetScopeKind, string, FileAssetSlot]
  > = [
    [
      'a Community banner',
      id => controller.clearCommunityBanner(id),
      FleetScopeKind.COMMUNITY,
      COMMUNITY_ID,
      FileAssetSlot.BANNER,
    ],
    [
      'a Community emblem',
      id => controller.clearCommunityEmblem(id),
      FleetScopeKind.COMMUNITY,
      COMMUNITY_ID,
      FileAssetSlot.EMBLEM,
    ],
    [
      'a Fleet banner',
      id => controller.clearFleetBanner(id),
      FleetScopeKind.FLEET,
      FLEET_ID,
      FileAssetSlot.BANNER,
    ],
    [
      'a Fleet emblem',
      id => controller.clearFleetEmblem(id),
      FleetScopeKind.FLEET,
      FLEET_ID,
      FileAssetSlot.EMBLEM,
    ],
    [
      'an Armada banner',
      id => controller.clearArmadaBanner(id),
      FleetScopeKind.ARMADA,
      ARMADA_ID,
      FileAssetSlot.BANNER,
    ],
    [
      'an Armada emblem',
      id => controller.clearArmadaEmblem(id),
      FleetScopeKind.ARMADA,
      ARMADA_ID,
      FileAssetSlot.EMBLEM,
    ],
  ];

  describe.each(clearers)('removing %s', (_name, handler, kind, id, slot) => {
    it('names the scope and the slot', async () => {
      await handler(id);

      expect(imageService.clearArtwork).toHaveBeenCalledWith(
        { kind, id },
        slot,
      );
    });

    it('removes nothing while the feature is switched off', async () => {
      featureService.assertEnabled.mockRejectedValue(
        new NotFoundException('Not found'),
      );

      await expect(handler(id)).rejects.toBeInstanceOf(NotFoundException);
      expect(imageService.clearArtwork).not.toHaveBeenCalled();
    });
  });

  const unclaimedSetters: Array<[string, UnclaimedSetter, FileAssetSlot]> = [
    [
      'banner',
      (...args) => controller.setUnclaimedFleetBanner(...args),
      FileAssetSlot.BANNER,
    ],
    [
      'emblem',
      (...args) => controller.setUnclaimedFleetEmblem(...args),
      FileAssetSlot.EMBLEM,
    ],
  ];

  describe.each(unclaimedSetters)(
    'setting an unregistered Fleet’s %s',
    (_name, handler, slot) => {
      it('goes to the route that applies the uploader rule', async () => {
        const accepted = await handler(FLEET_ID, USER_ID, FILE, DTO);

        expect(accepted).toEqual({ assetId: 'asset-2', status: 'SCANNING' });
        expect(imageService.setUnclaimedFleetArtwork).toHaveBeenCalledWith(
          FLEET_ID,
          slot,
          { userId: USER_ID, altText: 'A fleet yard', file: FILE },
        );
        expect(imageService.setArtwork).not.toHaveBeenCalled();
      });

      it('refuses a request carrying no file', async () => {
        await expect(
          handler(FLEET_ID, USER_ID, undefined, DTO),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(imageService.setUnclaimedFleetArtwork).not.toHaveBeenCalled();
      });

      it('accepts nothing while the feature is switched off', async () => {
        featureService.assertEnabled.mockRejectedValue(
          new NotFoundException('Not found'),
        );

        await expect(
          handler(FLEET_ID, USER_ID, FILE, DTO),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(imageService.setUnclaimedFleetArtwork).not.toHaveBeenCalled();
      });
    },
  );

  const unclaimedClearers: Array<[string, UnclaimedClearer, FileAssetSlot]> = [
    [
      'banner',
      (...args) => controller.clearUnclaimedFleetBanner(...args),
      FileAssetSlot.BANNER,
    ],
    [
      'emblem',
      (...args) => controller.clearUnclaimedFleetEmblem(...args),
      FileAssetSlot.EMBLEM,
    ],
  ];

  describe.each(unclaimedClearers)(
    'removing an unregistered Fleet’s %s',
    (_name, handler, slot) => {
      /**
       * The role travels with the request rather than being looked up. It
       * is what lets a site administrator take down artwork somebody else
       * put on a record nobody owns.
       */
      it('passes on who is asking and what they are', async () => {
        await handler(FLEET_ID, USER_ID, UserRole.ADMIN);

        expect(imageService.clearUnclaimedFleetArtwork).toHaveBeenCalledWith(
          FLEET_ID,
          slot,
          { userId: USER_ID, role: UserRole.ADMIN },
        );
      });

      it('reports an ordinary caller as having no role', async () => {
        await handler(FLEET_ID, USER_ID, null);

        expect(imageService.clearUnclaimedFleetArtwork).toHaveBeenCalledWith(
          FLEET_ID,
          slot,
          { userId: USER_ID, role: null },
        );
      });

      it('removes nothing while the feature is switched off', async () => {
        featureService.assertEnabled.mockRejectedValue(
          new NotFoundException('Not found'),
        );

        await expect(handler(FLEET_ID, USER_ID, null)).rejects.toBeInstanceOf(
          NotFoundException,
        );
        expect(imageService.clearUnclaimedFleetArtwork).not.toHaveBeenCalled();
      });
    },
  );

  /**
   * Stated as tests because a capability is silent when it is wrong. A
   * route declaring the wrong scope parameter resolves nothing and denies
   * everybody while looking exactly like a working restriction, and a route
   * declaring none at all lets everybody through while looking exactly like
   * one too.
   */
  describe('the capabilities the routes require', () => {
    const guarded: Array<[string, FleetScopeKind, string, string | undefined]> =
      [
        [
          'setCommunityBanner',
          FleetScopeKind.COMMUNITY,
          'communityId',
          undefined,
        ],
        [
          'clearCommunityBanner',
          FleetScopeKind.COMMUNITY,
          'communityId',
          undefined,
        ],
        [
          'setCommunityEmblem',
          FleetScopeKind.COMMUNITY,
          'communityId',
          undefined,
        ],
        [
          'clearCommunityEmblem',
          FleetScopeKind.COMMUNITY,
          'communityId',
          undefined,
        ],
        ['setFleetBanner', FleetScopeKind.FLEET, 'fleetId', 'communityId'],
        ['clearFleetBanner', FleetScopeKind.FLEET, 'fleetId', 'communityId'],
        ['setFleetEmblem', FleetScopeKind.FLEET, 'fleetId', 'communityId'],
        ['clearFleetEmblem', FleetScopeKind.FLEET, 'fleetId', 'communityId'],
        ['setArmadaBanner', FleetScopeKind.ARMADA, 'armadaId', 'communityId'],
        ['clearArmadaBanner', FleetScopeKind.ARMADA, 'armadaId', 'communityId'],
        ['setArmadaEmblem', FleetScopeKind.ARMADA, 'armadaId', 'communityId'],
        ['clearArmadaEmblem', FleetScopeKind.ARMADA, 'armadaId', 'communityId'],
      ];

    it.each(guarded)(
      '%s wants artwork management at the scope in the path',
      (method, kind, param, communityParam) => {
        const requirement: ScopeCapabilityRequirement | undefined =
          Reflect.getMetadata(
            REQUIRES_SCOPE_CAPABILITY_KEY,
            FleetImagesController.prototype[
              method as keyof FleetImagesController
            ],
          );

        expect(requirement?.capability).toBe(
          FLEET_CAPABILITIES.SCOPE_IMAGES_MANAGE,
        );
        expect(requirement?.source).toEqual({
          kind,
          param,
          ...(communityParam === undefined ? {} : { communityParam }),
        });
      },
    );

    /**
     * A nested route without the Community parameter would make the
     * Community segment decorative, which is the shape of most
     * cross-tenant bugs: a Fleet belonging to somebody else's Community
     * would resolve happily under a path claiming it was yours.
     */
    it.each(
      guarded.filter(([, , , communityParam]) => communityParam !== undefined),
    )('%s checks the Community the path claims', method => {
      const requirement: ScopeCapabilityRequirement | undefined =
        Reflect.getMetadata(
          REQUIRES_SCOPE_CAPABILITY_KEY,
          FleetImagesController.prototype[
            method as keyof FleetImagesController
          ],
        );

      expect(requirement?.source.communityParam).toBe('communityId');
    });

    it.each([
      ['setUnclaimedFleetBanner'],
      ['clearUnclaimedFleetBanner'],
      ['setUnclaimedFleetEmblem'],
      ['clearUnclaimedFleetEmblem'],
    ])('%s requires none, there being no scope to hold one', method => {
      const requirement: ScopeCapabilityRequirement | undefined =
        Reflect.getMetadata(
          REQUIRES_SCOPE_CAPABILITY_KEY,
          FleetImagesController.prototype[
            method as keyof FleetImagesController
          ],
        );

      expect(requirement).toBeUndefined();
    });
  });
});
