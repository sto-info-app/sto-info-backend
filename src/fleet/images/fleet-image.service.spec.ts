import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { jest } from '@jest/globals';
import { Repository } from 'typeorm';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetAudience } from 'src/file-assets/enums/file-asset-audience.enum';
import { FileAssetKind } from 'src/file-assets/enums/file-asset-kind.enum';
import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { AssetWithdrawalService } from 'src/file-assets/services/asset-withdrawal.service';
import { FileAssetService } from 'src/file-assets/services/file-asset.service';
import { ImageIngressService } from 'src/file-assets/services/image-ingress.service';
import { UserRole } from 'src/user/enums/user-role.enum';

import { FLEET_IMAGE_SPECS } from '../constants/fleet-image.constants';
import { FleetCommunityEntity } from '../entities/fleet-community.entity';
import { StoArmadaEntity } from '../entities/sto-armada.entity';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetImageService } from './fleet-image.service';

const COMMUNITY_ID = '60000000-0000-4000-8000-000000000001';
const FLEET_ID = '60000000-0000-4000-8000-000000000002';
const ARMADA_ID = '60000000-0000-4000-8000-000000000003';
const UPLOADER = '60000000-0000-4000-8000-000000000009';

/** A minimal repository double. */
interface MockRepository {
  findOne: jest.Mock<(...args: any[]) => Promise<any>>;
  save: jest.Mock<(...args: any[]) => Promise<any>>;
}

/**
 * Builds a repository double that answers with one row.
 *
 * @returns The double.
 */
function createRepository(): MockRepository {
  return {
    findOne: jest.fn<(...args: any[]) => Promise<any>>(),
    save: jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockImplementation((row: unknown) => Promise.resolve(row)),
  };
}

/** The file every upload in here carries. */
const FILE = { originalname: 'banner.jpg' } as Express.Multer.File;

describe('FleetImageService', () => {
  let service: FleetImageService;
  let communities: MockRepository;
  let fleets: MockRepository;
  let armadas: MockRepository;
  let accept: jest.Mock<(...args: any[]) => Promise<any>>;
  let withdrawSlot: jest.Mock<(...args: any[]) => Promise<any>>;
  let findByDeliveryReference: jest.Mock<(...args: any[]) => Promise<any>>;

  beforeEach(() => {
    communities = createRepository();
    fleets = createRepository();
    armadas = createRepository();

    accept = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue({ assetId: 'asset-1', status: 'SCANNING' });
    withdrawSlot = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue(undefined);
    findByDeliveryReference = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue(null);

    service = new FleetImageService(
      communities as unknown as Repository<FleetCommunityEntity>,
      fleets as unknown as Repository<StoFleetEntity>,
      armadas as unknown as Repository<StoArmadaEntity>,
      { accept } as unknown as ImageIngressService,
      { withdrawSlot } as unknown as AssetWithdrawalService,
      { findByDeliveryReference } as unknown as FileAssetService,
    );
  });

  /** The upload every case sends unless it is about the description. */
  const upload = { userId: UPLOADER, altText: 'A fleet yard', file: FILE };

  describe('setArtwork', () => {
    it('sends a Community banner to the shared ingress', async () => {
      communities.findOne.mockResolvedValue({
        id: COMMUNITY_ID,
        visibility: FleetAudience.PUBLIC,
        bannerImageId: null,
      });

      const accepted = await service.setArtwork(
        { kind: FleetScopeKind.COMMUNITY, id: COMMUNITY_ID },
        FileAssetSlot.BANNER,
        upload,
      );

      expect(accepted).toEqual({ assetId: 'asset-1', status: 'SCANNING' });
      expect(accept).toHaveBeenCalledWith(
        expect.objectContaining({
          spec: FLEET_IMAGE_SPECS.BANNER,
          kind: FileAssetKind.FLEET_IMAGE,
          subject: FileAssetSubject.FLEET_COMMUNITY,
          subjectId: COMMUNITY_ID,
          slot: FileAssetSlot.BANNER,
          entityTag: FLEET_IMAGE_SPECS.BANNER.entityTag,
          entityId: COMMUNITY_ID,
          userId: UPLOADER,
          feature: { altText: 'A fleet yard' },
        }),
      );
    });

    /**
     * Never a fixed audience. A Community that turns private takes its
     * banner with it, without a second rule here having to be kept in step
     * with the first.
     */
    it('lets the scope answer for who may see the picture', async () => {
      communities.findOne.mockResolvedValue({
        id: COMMUNITY_ID,
        visibility: FleetAudience.COMMUNITY,
      });

      await service.setArtwork(
        { kind: FleetScopeKind.COMMUNITY, id: COMMUNITY_ID },
        FileAssetSlot.EMBLEM,
        upload,
      );

      expect(accept).toHaveBeenCalledWith(
        expect.objectContaining({
          audience: FileAssetAudience.SCOPE,
          scope: {
            communityId: COMMUNITY_ID,
            fleetId: null,
            armadaId: null,
            audience: FleetAudience.COMMUNITY,
          },
        }),
      );
    });

    it('names both the Fleet and the Community it sits in', async () => {
      fleets.findOne.mockResolvedValue({
        id: FLEET_ID,
        communityId: COMMUNITY_ID,
        visibility: FleetAudience.FLEET_MEMBERS,
      });

      await service.setArtwork(
        { kind: FleetScopeKind.FLEET, id: FLEET_ID },
        FileAssetSlot.EMBLEM,
        upload,
      );

      expect(accept).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: FileAssetSubject.FLEET,
          scope: {
            communityId: COMMUNITY_ID,
            fleetId: FLEET_ID,
            armadaId: null,
            audience: FleetAudience.FLEET_MEMBERS,
          },
        }),
      );
    });

    /**
     * An Armada has no visibility column. It is a grouping inside a
     * Community and is seen by whoever sees the Community, so the audience
     * its artwork carries is read from the Community rather than guessed
     * when the picture is asked for.
     */
    it('gives an Armada’s picture the Community’s audience', async () => {
      armadas.findOne.mockResolvedValue({
        id: ARMADA_ID,
        communityId: COMMUNITY_ID,
        community: { visibility: FleetAudience.PUBLIC },
      });

      await service.setArtwork(
        { kind: FleetScopeKind.ARMADA, id: ARMADA_ID },
        FileAssetSlot.BANNER,
        upload,
      );

      expect(accept).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: FileAssetSubject.ARMADA,
          scope: {
            communityId: COMMUNITY_ID,
            fleetId: null,
            armadaId: ARMADA_ID,
            audience: FleetAudience.PUBLIC,
          },
        }),
      );
    });

    /**
     * An Armada whose Community could not be read is shown to nobody. The
     * safe reading of "we do not know who may see this" is not "everybody".
     */
    it('shows an Armada with no readable Community to nobody', async () => {
      armadas.findOne.mockResolvedValue({
        id: ARMADA_ID,
        communityId: COMMUNITY_ID,
        community: null,
      });

      await service.setArtwork(
        { kind: FleetScopeKind.ARMADA, id: ARMADA_ID },
        FileAssetSlot.BANNER,
        upload,
      );

      expect(accept).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: expect.objectContaining({
            audience: FleetAudience.PRIVATE,
          }),
        }),
      );
    });

    /**
     * A slot no scope has carries no rules for the picture and no Cloudflare
     * tag of its own. Nothing here is reachable through a route; it exists
     * so a misrouted placement fails as an unrecognised picture rather than
     * as a crash reading a specification that is not there.
     */
    it('holds a picture for an unknown slot to no shape at all', async () => {
      communities.findOne.mockResolvedValue({
        id: COMMUNITY_ID,
        visibility: FleetAudience.PUBLIC,
      });

      await service.setArtwork(
        { kind: FleetScopeKind.COMMUNITY, id: COMMUNITY_ID },
        FileAssetSlot.PORTRAIT,
        upload,
      );

      expect(accept).toHaveBeenCalledWith(
        expect.objectContaining({ spec: null, entityTag: 'fleet-image' }),
      );
    });

    it.each([
      [FleetScopeKind.COMMUNITY, COMMUNITY_ID, 'Community'],
      [FleetScopeKind.FLEET, FLEET_ID, 'Fleet'],
      [FleetScopeKind.ARMADA, ARMADA_ID, 'Armada'],
    ])('refuses a %s that is not there', async (kind, id, named) => {
      communities.findOne.mockResolvedValue(null);
      fleets.findOne.mockResolvedValue(null);
      armadas.findOne.mockResolvedValue(null);

      await expect(
        service.setArtwork({ kind, id }, FileAssetSlot.BANNER, upload),
      ).rejects.toThrow(new NotFoundException(`That ${named} does not exist.`));
      expect(accept).not.toHaveBeenCalled();
    });
  });

  describe('clearArtwork', () => {
    it('empties both columns and withdraws what was there', async () => {
      const community = {
        id: COMMUNITY_ID,
        visibility: FleetAudience.PUBLIC,
        bannerImageId: 'old-image',
        bannerImageAlt: 'The old one',
      };
      communities.findOne.mockResolvedValue(community);

      await service.clearArtwork(
        { kind: FleetScopeKind.COMMUNITY, id: COMMUNITY_ID },
        FileAssetSlot.BANNER,
      );

      expect(community.bannerImageId).toBeNull();
      expect(community.bannerImageAlt).toBeNull();
      expect(communities.save).toHaveBeenCalledWith(community);
      expect(withdrawSlot).toHaveBeenCalledWith(
        FileAssetSubject.FLEET_COMMUNITY,
        COMMUNITY_ID,
        FileAssetSlot.BANNER,
        'old-image',
        'Removed by the scope',
      );
    });

    /**
     * The columns are emptied first. Withdrawing first would leave the
     * scope pointing for a moment at bytes the delivery route had already
     * stopped serving, which reads to a visitor as a broken image rather
     * than as no image.
     */
    it('stops pointing at the picture before it stops being served', async () => {
      const order: string[] = [];
      communities.findOne.mockResolvedValue({
        id: COMMUNITY_ID,
        emblemImageId: 'old-image',
        emblemImageAlt: 'The old one',
      });
      communities.save.mockImplementation((row: unknown) => {
        order.push('save');

        return Promise.resolve(row);
      });
      withdrawSlot.mockImplementation(() => {
        order.push('withdraw');

        return Promise.resolve(undefined);
      });

      await service.clearArtwork(
        { kind: FleetScopeKind.COMMUNITY, id: COMMUNITY_ID },
        FileAssetSlot.EMBLEM,
      );

      expect(order).toEqual(['save', 'withdraw']);
    });

    it.each([
      ['the slot is already empty', FileAssetSlot.BANNER],
      ['no scope has that slot', FileAssetSlot.PORTRAIT],
    ])('refuses when %s', async (_name, slot) => {
      communities.findOne.mockResolvedValue({
        id: COMMUNITY_ID,
        bannerImageId: null,
      });

      await expect(
        service.clearArtwork(
          { kind: FleetScopeKind.COMMUNITY, id: COMMUNITY_ID },
          slot,
        ),
      ).rejects.toThrow(
        new NotFoundException('There is no picture there to remove.'),
      );
      expect(withdrawSlot).not.toHaveBeenCalled();
    });
  });

  describe('setUnclaimedFleetArtwork', () => {
    it('lets anybody signed in fill an empty slot', async () => {
      fleets.findOne.mockResolvedValue({
        id: FLEET_ID,
        communityId: null,
        visibility: FleetAudience.PUBLIC,
        bannerImageId: null,
      });

      await service.setUnclaimedFleetArtwork(
        FLEET_ID,
        FileAssetSlot.BANNER,
        upload,
      );

      expect(accept).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: FileAssetSubject.FLEET,
          scope: {
            communityId: null,
            fleetId: FLEET_ID,
            armadaId: null,
            audience: FleetAudience.PUBLIC,
          },
        }),
      );
      expect(findByDeliveryReference).not.toHaveBeenCalled();
    });

    it('lets whoever uploaded a picture replace it', async () => {
      fleets.findOne.mockResolvedValue({
        id: FLEET_ID,
        communityId: null,
        visibility: FleetAudience.PUBLIC,
        bannerImageId: 'old-image',
      });
      findByDeliveryReference.mockResolvedValue({
        ownerUserId: UPLOADER,
      } as FileAssetEntity);

      await service.setUnclaimedFleetArtwork(
        FLEET_ID,
        FileAssetSlot.BANNER,
        upload,
      );

      expect(findByDeliveryReference).toHaveBeenCalledWith('old-image');
      expect(accept).toHaveBeenCalled();
    });

    it('stops one person painting over another’s picture', async () => {
      fleets.findOne.mockResolvedValue({
        id: FLEET_ID,
        communityId: null,
        bannerImageId: 'old-image',
      });
      findByDeliveryReference.mockResolvedValue({
        ownerUserId: 'somebody-else',
      } as FileAssetEntity);

      await expect(
        service.setUnclaimedFleetArtwork(
          FLEET_ID,
          FileAssetSlot.BANNER,
          upload,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(accept).not.toHaveBeenCalled();
    });

    /**
     * Nobody can be shown to own it, and the safe reading of that is not
     * "therefore anybody may".
     */
    it('treats a picture with no findable asset as somebody else’s', async () => {
      fleets.findOne.mockResolvedValue({
        id: FLEET_ID,
        communityId: null,
        bannerImageId: 'old-image',
      });
      findByDeliveryReference.mockResolvedValue(null);

      await expect(
        service.setUnclaimedFleetArtwork(
          FLEET_ID,
          FileAssetSlot.BANNER,
          upload,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    /**
     * Missing rather than forbidden. The route is for unregistered records,
     * and a Fleet that has a Community is reachable — by the people
     * entitled to change it — through that Community's own route.
     */
    it('reports a registered Fleet as missing', async () => {
      fleets.findOne.mockResolvedValue({
        id: FLEET_ID,
        communityId: COMMUNITY_ID,
        bannerImageId: null,
      });

      await expect(
        service.setUnclaimedFleetArtwork(
          FLEET_ID,
          FileAssetSlot.BANNER,
          upload,
        ),
      ).rejects.toThrow(
        new NotFoundException('That Fleet is not an unregistered record.'),
      );
      expect(accept).not.toHaveBeenCalled();
    });

    /**
     * An uploader is never an administrator here, whatever they are on the
     * site. The override exists so somebody's artwork can be taken down,
     * not so it can be replaced with somebody else's.
     */
    it('gives an administrator no special right to paint over one', async () => {
      fleets.findOne.mockResolvedValue({
        id: FLEET_ID,
        communityId: null,
        bannerImageId: 'old-image',
      });
      findByDeliveryReference.mockResolvedValue({
        ownerUserId: 'somebody-else',
      } as FileAssetEntity);

      await expect(
        service.setUnclaimedFleetArtwork(
          FLEET_ID,
          FileAssetSlot.BANNER,
          upload,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('clearUnclaimedFleetArtwork', () => {
    beforeEach(() => {
      fleets.findOne.mockResolvedValue({
        id: FLEET_ID,
        communityId: null,
        emblemImageId: 'old-image',
        emblemImageAlt: 'The old one',
      });
    });

    it('lets whoever uploaded a picture take it down', async () => {
      findByDeliveryReference.mockResolvedValue({
        ownerUserId: UPLOADER,
      } as FileAssetEntity);

      await service.clearUnclaimedFleetArtwork(FLEET_ID, FileAssetSlot.EMBLEM, {
        userId: UPLOADER,
        role: UserRole.USER,
      });

      expect(withdrawSlot).toHaveBeenCalledWith(
        FileAssetSubject.FLEET,
        FLEET_ID,
        FileAssetSlot.EMBLEM,
        'old-image',
        'Removed by the scope',
      );
    });

    /**
     * There is always a route to take something down. Nobody owns an
     * unregistered record, so without this the only way to remove an
     * objectionable picture would be to find the person who uploaded it.
     */
    it('lets a site administrator take anybody’s picture down', async () => {
      findByDeliveryReference.mockResolvedValue({
        ownerUserId: 'somebody-else',
      } as FileAssetEntity);

      await service.clearUnclaimedFleetArtwork(FLEET_ID, FileAssetSlot.EMBLEM, {
        userId: 'an-administrator',
        role: UserRole.ADMIN,
      });

      expect(withdrawSlot).toHaveBeenCalled();
      expect(findByDeliveryReference).not.toHaveBeenCalled();
    });

    it('stops anybody else taking it down', async () => {
      findByDeliveryReference.mockResolvedValue({
        ownerUserId: 'somebody-else',
      } as FileAssetEntity);

      await expect(
        service.clearUnclaimedFleetArtwork(FLEET_ID, FileAssetSlot.EMBLEM, {
          userId: 'a-passer-by',
          role: null,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(withdrawSlot).not.toHaveBeenCalled();
    });
  });
});
