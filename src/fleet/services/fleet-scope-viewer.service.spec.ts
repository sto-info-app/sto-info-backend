import { Repository } from 'typeorm';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { UserRole } from 'src/user/enums/user-role.enum';

import { FleetAuthorisationService } from '../authorisation/fleet-authorisation.service';
import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { ScopeAuthorisation } from '../authorisation/scope-authorisation.interface';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetScopeViewerService } from './fleet-scope-viewer.service';

const USER_ID = '30000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '30000000-0000-4000-8000-000000000002';
const FLEET_ID = '30000000-0000-4000-8000-000000000003';

const FLEET_REF = { kind: FleetScopeKind.FLEET, id: FLEET_ID };

/**
 * Builds an authorisation holding the given capabilities.
 *
 * @param capabilities - What the caller holds at the scope.
 * @returns The authorisation.
 */
function authorisation(capabilities: string[]): ScopeAuthorisation {
  return {
    capabilities: new Set(capabilities),
  } as unknown as ScopeAuthorisation;
}

describe('FleetScopeViewerService', () => {
  let service: FleetScopeViewerService;
  let authorise: jest.Mock;
  let findOne: jest.Mock;

  beforeEach(() => {
    authorise = jest.fn(() => Promise.resolve(authorisation([])));
    findOne = jest.fn(() => Promise.resolve(null));

    service = new FleetScopeViewerService(
      { authorise } as unknown as FleetAuthorisationService,
      { findOne } as unknown as Repository<FileAssetEntity>,
    );
  });

  describe('at a registered scope', () => {
    /*
     * Every capability requires a user, so resolving one for a caller who has
     * not signed in could only confirm what the absent token already said —
     * and a scope page is served far more often to readers than to owners.
     */
    it('answers a signed-out caller without resolving anything', async () => {
      await expect(
        service.forScope({ userId: null, role: null }, FLEET_REF),
      ).resolves.toEqual({
        capabilities: [],
        mayManageBanner: false,
        mayManageEmblem: false,
      });
      expect(authorise).not.toHaveBeenCalled();
    });

    it('reports the capabilities the caller holds there', async () => {
      authorise.mockResolvedValue(
        authorisation([
          FLEET_CAPABILITIES.SCOPE_IMAGES_MANAGE,
          FLEET_CAPABILITIES.MEMBERS_VIEW,
        ]),
      );

      await expect(
        service.forScope({ userId: USER_ID, role: null }, FLEET_REF),
      ).resolves.toEqual({
        capabilities: [
          FLEET_CAPABILITIES.SCOPE_IMAGES_MANAGE,
          FLEET_CAPABILITIES.MEMBERS_VIEW,
        ],
        mayManageBanner: true,
        mayManageEmblem: true,
      });
      expect(authorise).toHaveBeenCalledWith(USER_ID, FLEET_REF);
    });

    /*
     * One capability covers both slots at a registered scope. They are
     * answered separately all the same, because an unregistered Fleet
     * answers them separately and a single flag would have to be taken apart
     * again there.
     */
    it('offers neither picture without the artwork capability', async () => {
      authorise.mockResolvedValue(
        authorisation([FLEET_CAPABILITIES.MEMBERS_VIEW]),
      );

      await expect(
        service.forScope({ userId: USER_ID, role: null }, FLEET_REF),
      ).resolves.toEqual({
        capabilities: [FLEET_CAPABILITIES.MEMBERS_VIEW],
        mayManageBanner: false,
        mayManageEmblem: false,
      });
    });

    /*
     * A scope that does not resolve is not an error here. Deciding what to
     * render is not the same question as deciding what to allow, and a page
     * that threw would tell a reader nothing they could act on.
     */
    it('offers nothing when the scope does not resolve', async () => {
      authorise.mockResolvedValue(null);

      await expect(
        service.forScope({ userId: USER_ID, role: null }, FLEET_REF),
      ).resolves.toEqual({
        capabilities: [],
        mayManageBanner: false,
        mayManageEmblem: false,
      });
    });

    /*
     * A site-wide role confers nothing at a scope — FC-005's first
     * acceptance criterion. It widens only the unregistered rule below,
     * where there is no scope for it to be confused with.
     */
    it('gives a site administrator nothing they were not granted', async () => {
      await expect(
        service.forScope({ userId: USER_ID, role: UserRole.ADMIN }, FLEET_REF),
      ).resolves.toEqual({
        capabilities: [],
        mayManageBanner: false,
        mayManageEmblem: false,
      });
    });
  });

  describe('at a Fleet nobody has registered', () => {
    const empty = { bannerImageId: null, emblemImageId: null };

    it('offers nothing to a caller who is not signed in', async () => {
      await expect(
        service.forStandaloneFleet({ userId: null, role: null }, empty),
      ).resolves.toEqual({
        capabilities: [],
        mayManageBanner: false,
        mayManageEmblem: false,
      });
      expect(findOne).not.toHaveBeenCalled();
    });

    /*
     * An empty slot is open to anybody signed in, which is what makes an
     * unregistered Fleet worth having artwork at all.
     */
    it('opens an empty slot to anybody signed in', async () => {
      await expect(
        service.forStandaloneFleet({ userId: USER_ID, role: null }, empty),
      ).resolves.toEqual({
        capabilities: [],
        mayManageBanner: true,
        mayManageEmblem: true,
      });
      expect(findOne).not.toHaveBeenCalled();
    });

    it('offers a filled slot to whoever filled it', async () => {
      findOne.mockResolvedValue({ ownerUserId: USER_ID });

      await expect(
        service.forStandaloneFleet(
          { userId: USER_ID, role: null },
          { bannerImageId: 'banner-ref', emblemImageId: null },
        ),
      ).resolves.toEqual({
        capabilities: [],
        mayManageBanner: true,
        mayManageEmblem: true,
      });
      expect(findOne).toHaveBeenCalledWith({
        where: { deliveryReference: 'banner-ref' },
      });
    });

    /*
     * The two slots are answered separately here, which is the whole reason
     * they are two fields: one may be free while the other is somebody
     * else's work.
     */
    it('answers each slot on its own', async () => {
      findOne.mockResolvedValue({ ownerUserId: OTHER_USER_ID });

      await expect(
        service.forStandaloneFleet(
          { userId: USER_ID, role: null },
          { bannerImageId: null, emblemImageId: 'emblem-ref' },
        ),
      ).resolves.toEqual({
        capabilities: [],
        mayManageBanner: true,
        mayManageEmblem: false,
      });
    });

    /*
     * Nobody can be shown to own a picture whose asset has gone, and the
     * safe reading of that is not "therefore anybody may" — the same reading
     * the upload route takes.
     */
    it('treats a picture with no asset behind it as somebody else’s', async () => {
      findOne.mockResolvedValue(null);

      await expect(
        service.forStandaloneFleet(
          { userId: USER_ID, role: null },
          { bannerImageId: 'banner-ref', emblemImageId: 'emblem-ref' },
        ),
      ).resolves.toEqual({
        capabilities: [],
        mayManageBanner: false,
        mayManageEmblem: false,
      });
    });

    it('lets a site administrator displace either picture', async () => {
      findOne.mockResolvedValue({ ownerUserId: OTHER_USER_ID });

      await expect(
        service.forStandaloneFleet(
          { userId: USER_ID, role: UserRole.ADMIN },
          { bannerImageId: 'banner-ref', emblemImageId: 'emblem-ref' },
        ),
      ).resolves.toEqual({
        capabilities: [],
        mayManageBanner: true,
        mayManageEmblem: true,
      });
      expect(findOne).not.toHaveBeenCalled();
    });

    /*
     * Nothing to hold. An unregistered Fleet is not a scope: no Community
     * owns it, so no role reaches it and no grant can name it.
     */
    it('never reports a capability, whoever is asking', async () => {
      const viewer = await service.forStandaloneFleet(
        { userId: USER_ID, role: UserRole.ADMIN },
        empty,
      );

      expect(viewer.capabilities).toEqual([]);
      expect(authorise).not.toHaveBeenCalled();
    });
  });
});
