import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { jest } from '@jest/globals';

import { FleetAudience } from 'src/fleet/enums/fleet-audience.enum';

import { FileAssetEntity } from '../entities/file-asset.entity';
import { FileAssetAudience } from '../enums/file-asset-audience.enum';
import { FileAssetKind } from '../enums/file-asset-kind.enum';
import { FileAssetState } from '../enums/file-asset-state.enum';
import { FileAssetStorage } from '../enums/file-asset-storage.enum';
import { FileAssetService } from './file-asset.service';

/**
 * The registry, tested against the states it refuses as much as the ones it
 * writes.
 *
 * The repository is a mock that returns whatever it is saved, so what is under
 * test is the service's own rules rather than TypeORM's behaviour. The
 * database has its own opinions about these invariants and they are exercised
 * separately, against a real PostgreSQL, by the migration rehearsal.
 */
describe('FileAssetService', () => {
  let service: FileAssetService;
  let repository: {
    create: jest.Mock<(...args: any[]) => any>;
    save: jest.Mock<(...args: any[]) => any>;
    findOne: jest.Mock<(...args: any[]) => any>;
  };

  /** A verdict from a scanner that reports everything about itself. */
  const verdict = {
    engine: 'clamav',
    engineVersion: '1.4.1',
    signatureVersion: '27500',
    policyVersion: 3,
  };

  /**
   * Builds an asset in a given state.
   *
   * @param overrides - What to change about it.
   * @returns The asset.
   */
  const assetIn = (overrides: Partial<FileAssetEntity>): FileAssetEntity =>
    ({
      id: 'asset-1',
      kind: FileAssetKind.ROSTER_IMPORT_SOURCE,
      state: FileAssetState.RECEIVING,
      audience: FileAssetAudience.RESTRICTED,
      storage: FileAssetStorage.NONE,
      ownerUserId: 'user-1',
      communityId: null,
      fleetId: null,
      armadaId: null,
      scopeAudience: null,
      objectKey: null,
      objectVersion: null,
      sha256: null,
      byteSize: null,
      declaredContentType: null,
      detectedContentType: null,
      originalFilename: null,
      policyVersion: 1,
      scanEngine: null,
      scanEngineVersion: null,
      scanSignatureVersion: null,
      rejectionCode: null,
      revocationReason: null,
      purgeRequiredAt: null,
      purgedAt: null,
      retainUntil: null,
      lastVerdictAt: null,
      availableAt: null,
      withdrawnAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    }) as FileAssetEntity;

  beforeEach(async () => {
    repository = {
      create: jest.fn<(...args: any[]) => any>(input => input),
      save: jest.fn<(...args: any[]) => any>(async input => input),
      findOne: jest.fn<(...args: any[]) => any>().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileAssetService,
        { provide: getRepositoryToken(FileAssetEntity), useValue: repository },
      ],
    }).compile();

    service = module.get(FileAssetService);
  });

  describe('register', () => {
    it('starts an asset before its bytes exist anywhere', async () => {
      const asset = await service.register({
        kind: FileAssetKind.PROFILE_IMAGE,
        audience: FileAssetAudience.PUBLIC,
        ownerUserId: 'user-1',
        declaredContentType: 'image/png',
        originalFilename: 'me.png',
      });

      expect(asset.state).toBe(FileAssetState.RECEIVING);
      expect(asset.storage).toBe(FileAssetStorage.NONE);
      expect(asset.objectKey).toBeUndefined();
    });

    it('records a scope when the audience names one', async () => {
      const asset = await service.register({
        kind: FileAssetKind.FLEET_IMAGE,
        audience: FileAssetAudience.SCOPE,
        ownerUserId: 'user-1',
        fleetId: 'fleet-1',
        scopeAudience: FleetAudience.FLEET_MEMBERS,
        declaredContentType: 'image/png',
        originalFilename: null,
      });

      expect(asset.fleetId).toBe('fleet-1');
      expect(asset.scopeAudience).toBe(FleetAudience.FLEET_MEMBERS);
    });

    it('leaves the scope empty when none was given', async () => {
      const asset = await service.register({
        kind: FileAssetKind.PROFILE_IMAGE,
        audience: FileAssetAudience.PUBLIC,
        ownerUserId: null,
        declaredContentType: null,
        originalFilename: null,
        retainUntil: null,
      });

      expect(asset.communityId).toBeNull();
      expect(asset.armadaId).toBeNull();
      expect(asset.scopeAudience).toBeNull();
      expect(asset.retainUntil).toBeNull();
    });

    it('carries a retention date when the kind has a policy', async () => {
      const retainUntil = new Date('2027-03-16T00:00:00.000Z');

      const asset = await service.register({
        kind: FileAssetKind.ROSTER_IMPORT_SOURCE,
        audience: FileAssetAudience.RESTRICTED,
        ownerUserId: 'user-1',
        declaredContentType: 'text/csv',
        originalFilename: 'roster.csv',
        retainUntil,
      });

      expect(asset.retainUntil).toBe(retainUntil);
    });
  });

  describe('recordStored', () => {
    it('binds the verdict-to-come to a key, a version and a hash', async () => {
      repository.findOne.mockResolvedValue(
        assetIn({ state: FileAssetState.RECEIVING }),
      );

      const asset = await service.recordStored('asset-1', {
        objectKey: 'local/assets/asset-1',
        objectVersion: 'v-9',
        sha256: 'a'.repeat(64),
        byteSize: 2048,
        detectedContentType: 'text/csv',
      });

      expect(asset.state).toBe(FileAssetState.QUARANTINED);
      expect(asset.storage).toBe(FileAssetStorage.QUARANTINE);
      expect(asset.objectVersion).toBe('v-9');
      expect(asset.byteSize).toBe('2048');
    });

    it('refuses to store bytes against an asset that is already refused', async () => {
      repository.findOne.mockResolvedValue(
        assetIn({ state: FileAssetState.REJECTED }),
      );

      await expect(
        service.recordStored('asset-1', {
          objectKey: 'k',
          objectVersion: null,
          sha256: 'b'.repeat(64),
          byteSize: 1,
          detectedContentType: null,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses when there is no such asset', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.recordStored('missing', {
          objectKey: 'k',
          objectVersion: null,
          sha256: 'c'.repeat(64),
          byteSize: 1,
          detectedContentType: null,
        }),
      ).rejects.toThrow('No such asset: missing');
    });
  });

  describe('markScanning', () => {
    it('moves a quarantined asset to scanning', async () => {
      repository.findOne.mockResolvedValue(
        assetIn({ state: FileAssetState.QUARANTINED }),
      );

      await expect(service.markScanning('asset-1')).resolves.toMatchObject({
        state: FileAssetState.SCANNING,
      });
    });

    it('refuses to rescan something that is already published', async () => {
      repository.findOne.mockResolvedValue(
        assetIn({ state: FileAssetState.AVAILABLE }),
      );

      await expect(service.markScanning('asset-1')).rejects.toThrow(
        'An asset cannot move from AVAILABLE to SCANNING',
      );
    });
  });

  describe('recordCleanVerdict', () => {
    it('records what the scanner said about itself', async () => {
      repository.findOne.mockResolvedValue(
        assetIn({ state: FileAssetState.SCANNING }),
      );

      const asset = await service.recordCleanVerdict('asset-1', verdict);

      expect(asset.state).toBe(FileAssetState.CLEAN);
      expect(asset.scanEngine).toBe('clamav');
      expect(asset.scanSignatureVersion).toBe('27500');
      expect(asset.policyVersion).toBe(3);
      expect(asset.lastVerdictAt).not.toBeNull();
    });

    /**
     * The first acceptance criterion, in the shape a caller would get it
     * wrong: a clean verdict is not publication and this method does not
     * perform one.
     */
    it('does not make the asset serveable', async () => {
      repository.findOne.mockResolvedValue(
        assetIn({ state: FileAssetState.SCANNING }),
      );

      const asset = await service.recordCleanVerdict('asset-1', verdict);

      expect(asset.state).not.toBe(FileAssetState.AVAILABLE);
      expect(asset.availableAt).toBeNull();
    });

    /**
     * ADR-0005. A scanner that does not expose a version or a signature
     * database is recorded as having none, and the null must survive to the
     * row rather than being replaced by something plausible.
     */
    it('records absent scanner metadata as absent', async () => {
      repository.findOne.mockResolvedValue(
        assetIn({ state: FileAssetState.SCANNING }),
      );

      const asset = await service.recordCleanVerdict('asset-1', {
        engine: 'provider-managed',
        engineVersion: null,
        signatureVersion: null,
        policyVersion: 1,
      });

      expect(asset.scanEngineVersion).toBeNull();
      expect(asset.scanSignatureVersion).toBeNull();
    });
  });

  describe('reject', () => {
    it('refuses an asset and records an administrator-only code', async () => {
      repository.findOne.mockResolvedValue(
        assetIn({ state: FileAssetState.SCANNING }),
      );

      const asset = await service.reject('asset-1', 'SIGNATURE_MATCH', verdict);

      expect(asset.state).toBe(FileAssetState.REJECTED);
      expect(asset.rejectionCode).toBe('SIGNATURE_MATCH');
      expect(asset.scanEngine).toBe('clamav');
      expect(asset.withdrawnAt).not.toBeNull();
    });

    it('refuses an asset that no scanner ever saw', async () => {
      repository.findOne.mockResolvedValue(
        assetIn({ state: FileAssetState.RECEIVING }),
      );

      const asset = await service.reject('asset-1', 'UPLOAD_ABANDONED');

      expect(asset.state).toBe(FileAssetState.REJECTED);
      expect(asset.scanEngine).toBeNull();
    });

    it('refuses to refuse something already withdrawn', async () => {
      repository.findOne.mockResolvedValue(
        assetIn({ state: FileAssetState.REVOKED }),
      );

      await expect(service.reject('asset-1', 'LATE')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('markRetryPending', () => {
    it('leaves a transient fault eligible to be tried again', async () => {
      repository.findOne.mockResolvedValue(
        assetIn({ state: FileAssetState.SCANNING }),
      );

      await expect(service.markRetryPending('asset-1')).resolves.toMatchObject({
        state: FileAssetState.RETRY_PENDING,
      });
    });

    it('refuses when the asset is already published', async () => {
      repository.findOne.mockResolvedValue(
        assetIn({ state: FileAssetState.AVAILABLE }),
      );

      await expect(service.markRetryPending('asset-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('publish', () => {
    it('makes a clean asset serveable from quarantine', async () => {
      repository.findOne.mockResolvedValue(
        assetIn({
          state: FileAssetState.CLEAN,
          storage: FileAssetStorage.QUARANTINE,
        }),
      );

      const asset = await service.publish('asset-1');

      expect(asset.state).toBe(FileAssetState.AVAILABLE);
      expect(asset.storage).toBe(FileAssetStorage.QUARANTINE);
      expect(asset.availableAt).not.toBeNull();
    });

    it('publishes a public image to the public delivery path', async () => {
      repository.findOne.mockResolvedValue(
        assetIn({ state: FileAssetState.CLEAN }),
      );

      const asset = await service.publish(
        'asset-1',
        FileAssetStorage.PUBLIC_IMAGES,
      );

      expect(asset.storage).toBe(FileAssetStorage.PUBLIC_IMAGES);
    });

    it('lets a legacy asset be published without a verdict it never had', async () => {
      repository.findOne.mockResolvedValue(
        assetIn({
          state: FileAssetState.UNVERIFIED,
          storage: FileAssetStorage.PUBLIC_IMAGES,
        }),
      );

      await expect(
        service.publish('asset-1', FileAssetStorage.PUBLIC_IMAGES),
      ).resolves.toMatchObject({ state: FileAssetState.AVAILABLE });
    });

    /**
     * The fourth acceptance criterion. There is no sequence of calls that
     * publishes bytes a scanner refused: replacing them is a new asset with a
     * verdict of its own.
     */
    it('refuses to publish a rejected asset', async () => {
      repository.findOne.mockResolvedValue(
        assetIn({ state: FileAssetState.REJECTED }),
      );

      await expect(service.publish('asset-1')).rejects.toThrow(
        'An asset cannot move from REJECTED to AVAILABLE',
      );
    });

    it('refuses to publish bytes no scanner has looked at', async () => {
      repository.findOne.mockResolvedValue(
        assetIn({ state: FileAssetState.QUARANTINED }),
      );

      await expect(service.publish('asset-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('revoke', () => {
    it('withdraws a privately delivered asset with no purge owed', async () => {
      repository.findOne.mockResolvedValue(
        assetIn({
          state: FileAssetState.AVAILABLE,
          storage: FileAssetStorage.QUARANTINE,
        }),
      );

      const asset = await service.revoke('asset-1', 'Later detection');

      expect(asset.state).toBe(FileAssetState.REVOKED);
      expect(asset.revocationReason).toBe('Later detection');
      expect(asset.withdrawnAt).not.toBeNull();
      expect(asset.purgeRequiredAt).toBeNull();
    });

    /**
     * The third acceptance criterion's operational half. Bytes that reached a
     * CDN are not withdrawn by a database write alone, and the gap between the
     * write and the purge is recorded rather than assumed away.
     */
    it('records that a public image still owes a purge', async () => {
      repository.findOne.mockResolvedValue(
        assetIn({
          state: FileAssetState.AVAILABLE,
          storage: FileAssetStorage.PUBLIC_IMAGES,
        }),
      );

      const asset = await service.revoke('asset-1', 'Later detection');

      expect(asset.purgeRequiredAt).not.toBeNull();
      expect(asset.purgedAt).toBeNull();
    });

    it('records that a legacy public object still owes a purge', async () => {
      repository.findOne.mockResolvedValue(
        assetIn({
          state: FileAssetState.AVAILABLE,
          storage: FileAssetStorage.LEGACY_PUBLIC_R2,
        }),
      );

      const asset = await service.revoke('asset-1', 'Later detection');

      expect(asset.purgeRequiredAt).not.toBeNull();
    });

    it('refuses to withdraw something that was never published', async () => {
      repository.findOne.mockResolvedValue(
        assetIn({ state: FileAssetState.CLEAN }),
      );

      await expect(service.revoke('asset-1', 'why')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('confirmPurged', () => {
    it('records that the public routes have been cleared', async () => {
      repository.findOne.mockResolvedValue(
        assetIn({
          state: FileAssetState.REVOKED,
          purgeRequiredAt: new Date(),
        }),
      );

      await expect(service.confirmPurged('asset-1')).resolves.toMatchObject({
        purgedAt: expect.any(Date),
      });
    });

    it('refuses when no purge was owed', async () => {
      repository.findOne.mockResolvedValue(
        assetIn({ state: FileAssetState.REVOKED }),
      );

      await expect(service.confirmPurged('asset-1')).rejects.toThrow(
        'No purge is outstanding for this asset',
      );
    });
  });

  describe('findById', () => {
    it('returns null rather than throwing for an unknown asset', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findById('nobody')).resolves.toBeNull();
    });

    it('asks for the asset by its identifier', async () => {
      repository.findOne.mockResolvedValue(assetIn({}));

      await service.findById('asset-1');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: 'asset-1' },
      });
    });
  });
});
