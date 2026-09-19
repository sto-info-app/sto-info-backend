import { Readable } from 'stream';

import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';

import { FleetAudienceService } from 'src/fleet/authorisation/fleet-audience.service';
import { FleetAudience } from 'src/fleet/enums/fleet-audience.enum';
import { FleetScopeKind } from 'src/fleet/enums/fleet-scope-kind.enum';

import { FileAssetEntity } from '../entities/file-asset.entity';
import { FileAssetAudience } from '../enums/file-asset-audience.enum';
import { FileAssetKind } from '../enums/file-asset-kind.enum';
import { FileAssetState } from '../enums/file-asset-state.enum';
import { FileAssetStorage } from '../enums/file-asset-storage.enum';
import { FileAssetDeliveryService } from './file-asset-delivery.service';
import { FileAssetService } from './file-asset.service';
import { QuarantineStorageService } from './quarantine-storage.service';

/**
 * Delivery, tested mostly through what it refuses.
 *
 * Two of the ticket's acceptance criteria are absences — bytes that must not
 * be served and readers who must not receive them — so most of these assert
 * that a 404 came back. The repetition is the point: every state that is not
 * `AVAILABLE` gets its own case, so a state added later without a decision
 * about it fails here.
 */
describe('FileAssetDeliveryService', () => {
  let service: FileAssetDeliveryService;
  let assetService: { findById: jest.Mock<(...args: any[]) => any> };
  let storage: { getStream: jest.Mock<(...args: any[]) => any> };
  let audienceService: { canView: jest.Mock<(...args: any[]) => any> };

  /**
   * Builds an available, publicly readable asset in quarantine.
   *
   * @param overrides - What to change about it.
   * @returns The asset.
   */
  const availableAsset = (
    overrides: Partial<FileAssetEntity> = {},
  ): FileAssetEntity =>
    ({
      id: 'asset-1',
      kind: FileAssetKind.PROFILE_IMAGE,
      state: FileAssetState.AVAILABLE,
      audience: FileAssetAudience.PUBLIC,
      storage: FileAssetStorage.QUARANTINE,
      ownerUserId: 'owner-1',
      communityId: null,
      fleetId: null,
      armadaId: null,
      scopeAudience: null,
      objectKey: 'local/assets/asset-1',
      objectVersion: 'v-3',
      sha256: 'd'.repeat(64),
      byteSize: '4096',
      detectedContentType: 'image/png',
      originalFilename: 'portrait.png',
      ...overrides,
    }) as FileAssetEntity;

  beforeEach(async () => {
    assetService = {
      findById: jest
        .fn<(...args: any[]) => any>()
        .mockResolvedValue(availableAsset()),
    };
    storage = {
      getStream: jest
        .fn<(...args: any[]) => any>()
        .mockResolvedValue(Readable.from(['bytes'])),
    };
    audienceService = {
      canView: jest.fn<(...args: any[]) => any>().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileAssetDeliveryService,
        { provide: FileAssetService, useValue: assetService },
        { provide: QuarantineStorageService, useValue: storage },
        { provide: FleetAudienceService, useValue: audienceService },
      ],
    }).compile();

    service = module.get(FileAssetDeliveryService);
  });

  describe('the state check', () => {
    it('serves an available asset', async () => {
      await expect(
        service.resolveForReader('asset-1', null),
      ).resolves.toMatchObject({ id: 'asset-1' });
    });

    /**
     * The first acceptance criterion, case by case. A clean scanner status is
     * explicitly among the refusals: it is a statement about bytes, not a
     * decision to publish them.
     */
    it.each([
      FileAssetState.UNVERIFIED,
      FileAssetState.RECEIVING,
      FileAssetState.QUARANTINED,
      FileAssetState.SCANNING,
      FileAssetState.CLEAN,
      FileAssetState.RETRY_PENDING,
      FileAssetState.REJECTED,
      FileAssetState.REVOKED,
      FileAssetState.DELETED,
    ])('refuses an asset in %s', async state => {
      assetService.findById.mockResolvedValue(availableAsset({ state }));

      await expect(service.resolveForReader('asset-1', null)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses an asset that does not exist', async () => {
      assetService.findById.mockResolvedValue(null);

      await expect(service.resolveForReader('nobody', null)).rejects.toThrow(
        NotFoundException,
      );
    });

    /**
     * An asset whose bytes are on a public CDN has its own URL and is not
     * fetched through here. A second path to those bytes would be a second
     * path whose revocation story is a purge rather than a database write.
     */
    it.each([
      FileAssetStorage.PUBLIC_IMAGES,
      FileAssetStorage.LEGACY_PUBLIC_R2,
      FileAssetStorage.NONE,
    ])('refuses to serve an asset stored as %s', async assetStorage => {
      assetService.findById.mockResolvedValue(
        availableAsset({ storage: assetStorage }),
      );

      await expect(service.resolveForReader('asset-1', null)).rejects.toThrow(
        NotFoundException,
      );
    });

    /**
     * Every refusal is the same refusal. Distinguishing "not found" from
     * "refused" from "not yours" would let somebody enumerate what is stored
     * and, for a quarantined file, confirm that the scanner rejected it.
     */
    it('says the same thing however it refuses', async () => {
      assetService.findById.mockResolvedValue(null);
      const missing = await service
        .resolveForReader('asset-1', null)
        .catch((error: Error) => error.message);

      assetService.findById.mockResolvedValue(
        availableAsset({ state: FileAssetState.REJECTED }),
      );
      const rejected = await service
        .resolveForReader('asset-1', null)
        .catch((error: Error) => error.message);

      assetService.findById.mockResolvedValue(
        availableAsset({ audience: FileAssetAudience.OWNER }),
      );
      const notYours = await service
        .resolveForReader('asset-1', 'somebody-else')
        .catch((error: Error) => error.message);

      expect(missing).toBe('Not found');
      expect(rejected).toBe(missing);
      expect(notYours).toBe(missing);
    });
  });

  describe('the audience check', () => {
    it('hands a public asset to a signed-out visitor', async () => {
      await expect(
        service.resolveForReader('asset-1', null),
      ).resolves.toBeDefined();
    });

    it('refuses an authenticated-only asset to a signed-out visitor', async () => {
      assetService.findById.mockResolvedValue(
        availableAsset({ audience: FileAssetAudience.AUTHENTICATED }),
      );

      await expect(service.resolveForReader('asset-1', null)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('hands an authenticated-only asset to any signed-in reader', async () => {
      assetService.findById.mockResolvedValue(
        availableAsset({ audience: FileAssetAudience.AUTHENTICATED }),
      );

      await expect(
        service.resolveForReader('asset-1', 'anybody'),
      ).resolves.toBeDefined();
    });

    it('hands an owner-only asset to its owner', async () => {
      assetService.findById.mockResolvedValue(
        availableAsset({ audience: FileAssetAudience.OWNER }),
      );

      await expect(
        service.resolveForReader('asset-1', 'owner-1'),
      ).resolves.toBeDefined();
    });

    it('refuses an owner-only asset to everybody else', async () => {
      assetService.findById.mockResolvedValue(
        availableAsset({ audience: FileAssetAudience.OWNER }),
      );

      await expect(
        service.resolveForReader('asset-1', 'someone-else'),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses an owner-only asset to a signed-out visitor', async () => {
      assetService.findById.mockResolvedValue(
        availableAsset({ audience: FileAssetAudience.OWNER }),
      );

      await expect(service.resolveForReader('asset-1', null)).rejects.toThrow(
        NotFoundException,
      );
    });

    /**
     * A retained import source is evidence, not content. There is no ordinary
     * route to it — not even for the person who uploaded it — and the
     * investigation route is W09's, with its own authority and reason logging.
     */
    it('refuses a restricted asset to everybody, including its owner', async () => {
      assetService.findById.mockResolvedValue(
        availableAsset({
          audience: FileAssetAudience.RESTRICTED,
          kind: FileAssetKind.ROSTER_IMPORT_SOURCE,
        }),
      );

      await expect(
        service.resolveForReader('asset-1', 'owner-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('a scoped audience', () => {
    it('asks the Fleet policy about a Fleet asset', async () => {
      assetService.findById.mockResolvedValue(
        availableAsset({
          audience: FileAssetAudience.SCOPE,
          fleetId: 'fleet-1',
          scopeAudience: FleetAudience.FLEET_MEMBERS,
        }),
      );

      await service.resolveForReader('asset-1', 'user-1');

      expect(audienceService.canView).toHaveBeenCalledWith(
        FleetAudience.FLEET_MEMBERS,
        { kind: FleetScopeKind.FLEET, id: 'fleet-1' },
        'user-1',
      );
    });

    it('asks about an Armada asset', async () => {
      assetService.findById.mockResolvedValue(
        availableAsset({
          audience: FileAssetAudience.SCOPE,
          armadaId: 'armada-1',
          scopeAudience: FleetAudience.COMMUNITY,
        }),
      );

      await service.resolveForReader('asset-1', 'user-1');

      expect(audienceService.canView).toHaveBeenCalledWith(
        FleetAudience.COMMUNITY,
        { kind: FleetScopeKind.ARMADA, id: 'armada-1' },
        'user-1',
      );
    });

    it('asks about a Community asset', async () => {
      assetService.findById.mockResolvedValue(
        availableAsset({
          audience: FileAssetAudience.SCOPE,
          communityId: 'community-1',
          scopeAudience: FleetAudience.PUBLIC,
        }),
      );

      await service.resolveForReader('asset-1', null);

      expect(audienceService.canView).toHaveBeenCalledWith(
        FleetAudience.PUBLIC,
        { kind: FleetScopeKind.COMMUNITY, id: 'community-1' },
        null,
      );
    });

    it('refuses when the policy says no', async () => {
      audienceService.canView.mockResolvedValue(false);
      assetService.findById.mockResolvedValue(
        availableAsset({
          audience: FileAssetAudience.SCOPE,
          fleetId: 'fleet-1',
          scopeAudience: FleetAudience.FLEET_MEMBERS,
        }),
      );

      await expect(
        service.resolveForReader('asset-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    /**
     * A row that claims a scoped audience but names no scope is not a licence
     * to guess. It fails closed, and it never reaches the policy service,
     * which would otherwise be asked about a scope that does not exist.
     */
    it('refuses when the row names no scope', async () => {
      assetService.findById.mockResolvedValue(
        availableAsset({
          audience: FileAssetAudience.SCOPE,
          scopeAudience: FleetAudience.PUBLIC,
        }),
      );

      await expect(
        service.resolveForReader('asset-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
      expect(audienceService.canView).not.toHaveBeenCalled();
    });

    it('refuses when the row names a scope but no scope audience', async () => {
      assetService.findById.mockResolvedValue(
        availableAsset({
          audience: FileAssetAudience.SCOPE,
          fleetId: 'fleet-1',
          scopeAudience: null,
        }),
      );

      await expect(
        service.resolveForReader('asset-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
      expect(audienceService.canView).not.toHaveBeenCalled();
    });
  });

  describe('openForReader', () => {
    /**
     * The version is passed to the store, so what is served is the version a
     * scanner cleared rather than whatever happens to be under the key now.
     */
    it('reads the exact version the verdict was bound to', async () => {
      const content = await service.openForReader('asset-1', null);

      expect(storage.getStream).toHaveBeenCalledWith(
        'local/assets/asset-1',
        'v-3',
      );
      expect(content.contentType).toBe('image/png');
      expect(content.byteSize).toBe(4096);
      expect(content.filename).toBe('portrait.png');
    });

    it('falls back to an opaque content type when none was detected', async () => {
      assetService.findById.mockResolvedValue(
        availableAsset({ detectedContentType: null, byteSize: null }),
      );

      const content = await service.openForReader('asset-1', null);

      expect(content.contentType).toBe('application/octet-stream');
      expect(content.byteSize).toBeNull();
    });

    it('does not open anything it would have refused', async () => {
      assetService.findById.mockResolvedValue(
        availableAsset({ state: FileAssetState.REVOKED }),
      );

      await expect(service.openForReader('asset-1', null)).rejects.toThrow(
        NotFoundException,
      );
      expect(storage.getStream).not.toHaveBeenCalled();
    });
  });
});
