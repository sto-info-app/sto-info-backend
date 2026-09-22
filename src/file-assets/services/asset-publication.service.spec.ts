import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { Logger } from '@nestjs/common';

import { jest } from '@jest/globals';

import { ImageUploadsService } from 'src/shared/utilities/image-uploads.service';

import { FileAssetPlacementEntity } from '../entities/file-asset-placement.entity';
import { FileAssetEntity } from '../entities/file-asset.entity';
import { FileAssetAudience } from '../enums/file-asset-audience.enum';
import { FileAssetPlacementState } from '../enums/file-asset-placement-state.enum';
import { FileAssetSlot } from '../enums/file-asset-slot.enum';
import { FileAssetState } from '../enums/file-asset-state.enum';
import { FileAssetStorage } from '../enums/file-asset-storage.enum';
import { FileAssetSubject } from '../enums/file-asset-subject.enum';
import { AssetPublicationService } from './asset-publication.service';
import { AssetPublisherRegistry } from './asset-publisher.registry';
import { AssetWithdrawalService } from './asset-withdrawal.service';
import { FileAssetPlacementService } from './file-asset-placement.service';
import { FileAssetService } from './file-asset.service';
import { QuarantineStorageService } from './quarantine-storage.service';

/**
 * Builds a cleared asset.
 *
 * @param overrides - Whatever the case is actually about.
 * @returns The asset.
 */
const asset = (overrides: Partial<FileAssetEntity> = {}): FileAssetEntity =>
  ({
    id: 'asset-1',
    state: FileAssetState.CLEAN,
    ownerUserId: 'user-1',
    objectKey: 'test/assets/asset-1',
    objectVersion: null,
    deliveryReference: null,
    originalFilename: 'banner.jpg',
    declaredContentType: 'image/jpeg',
    detectedContentType: 'image/jpeg',
    ...overrides,
  }) as FileAssetEntity;

/**
 * Builds the placement waiting for it.
 *
 * @param overrides - Whatever the case is actually about.
 * @returns The placement.
 */
const placement = (
  overrides: Partial<FileAssetPlacementEntity> = {},
): FileAssetPlacementEntity =>
  ({
    id: 'placement-1',
    assetId: 'asset-1',
    state: FileAssetPlacementState.PENDING,
    subject: FileAssetSubject.STORYTIME_STORY,
    subjectId: 'story-1',
    slot: FileAssetSlot.BANNER,
    detail: {
      entityTag: 'storytime-story-banner',
      entityId: 'story-1',
      feature: { altText: 'A ship' },
    },
    settledAt: null,
    createdAt: new Date('2026-09-20T10:00:00.000Z'),
    updatedAt: new Date('2026-09-20T10:00:00.000Z'),
    ...overrides,
  }) as FileAssetPlacementEntity;

describe('AssetPublicationService', () => {
  let findById: jest.Mock<(...args: any[]) => Promise<any>>;
  let publishAsset: jest.Mock<(...args: any[]) => Promise<any>>;
  let discard: jest.Mock<(...args: any[]) => Promise<any>>;
  let findByAssetId: jest.Mock<(...args: any[]) => Promise<any>>;
  let activate: jest.Mock<(...args: any[]) => Promise<any>>;
  let settle: jest.Mock<(...args: any[]) => Promise<any>>;
  let reject: jest.Mock<(...args: any[]) => Promise<any>>;
  let require_: jest.Mock;
  let requireRestricted: jest.Mock;
  let receive: jest.Mock<(...args: any[]) => Promise<any>>;
  let attach: jest.Mock<(...args: any[]) => Promise<any>>;
  let getStream: jest.Mock<(...args: any[]) => Promise<any>>;
  let remove: jest.Mock<(...args: any[]) => Promise<any>>;
  let publishImageToCloudflareImages: jest.Mock<
    (...args: any[]) => Promise<any>
  >;
  let withdrawByReference: jest.Mock<(...args: any[]) => Promise<any>>;
  let service: AssetPublicationService;

  beforeEach(() => {
    findById = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue(asset());
    publishAsset = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue({});
    discard = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({});
    findByAssetId = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue(placement());
    activate = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue({ active: placement(), replaced: null });
    attach = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue(null);
    settle = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({});
    reject = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({});
    receive = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue({ accepted: true });
    requireRestricted = jest.fn(() => ({
      subject: FileAssetSubject.ROSTER_IMPORT,
      receive,
    }));
    require_ = jest.fn(() => ({
      subject: FileAssetSubject.STORYTIME_STORY,
      attach,
    }));
    getStream = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue(Readable.from([Buffer.from('a picture')]));
    remove = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue(undefined);
    publishImageToCloudflareImages = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue('cf-image-1');
    withdrawByReference = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue({ deleted: true, revoked: true });

    service = new AssetPublicationService(
      {
        findById,
        publish: publishAsset,
        discard,
        reject,
      } as unknown as FileAssetService,
      {
        findByAssetId,
        activate,
        settle,
      } as unknown as FileAssetPlacementService,
      {
        require: require_,
        requireRestricted,
      } as unknown as AssetPublisherRegistry,
      { getStream, remove } as unknown as QuarantineStorageService,
      { publishImageToCloudflareImages } as unknown as ImageUploadsService,
      { withdrawByReference } as unknown as AssetWithdrawalService,
    );

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('publishes cleared bytes into the slot waiting for them', async () => {
    await expect(service.publish('asset-1')).resolves.toEqual({
      published: true,
      refusal: null,
      deliveryReference: 'cf-image-1',
    });

    expect(publishImageToCloudflareImages).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        buffer: Buffer.from('a picture'),
        filename: 'banner.jpg',
        contentType: 'image/jpeg',
        entityType: 'storytime-story-banner',
        entityId: 'story-1',
      }),
    );
    expect(publishAsset).toHaveBeenCalledWith(
      'asset-1',
      FileAssetStorage.PUBLIC_IMAGES,
      'cf-image-1',
    );
  });

  it('hands the feature its own detail and nothing else', async () => {
    await service.publish('asset-1');

    expect(attach).toHaveBeenCalledWith({
      subjectId: 'story-1',
      slot: FileAssetSlot.BANNER,
      deliveryReference: 'cf-image-1',
      uploadedByUserId: 'user-1',
      detail: { altText: 'A ship' },
    });
  });

  // The third acceptance criterion in the only order that can satisfy it:
  // nothing points at the new picture until the registry says it may be
  // served.
  it('publishes the asset before the record is pointed at it', async () => {
    const order: string[] = [];

    publishAsset.mockImplementation(() => {
      order.push('publish');

      return Promise.resolve({});
    });
    attach.mockImplementation(() => {
      order.push('attach');

      return Promise.resolve(null);
    });

    await service.publish('asset-1');

    expect(order).toEqual(['publish', 'attach']);
  });

  it('withdraws what the record pointed at before', async () => {
    attach.mockResolvedValue('older-image');

    await service.publish('asset-1');

    expect(withdrawByReference).toHaveBeenCalledWith(
      'older-image',
      'Replaced by a new upload',
    );
  });

  it('withdraws nothing when the slot was empty', async () => {
    await service.publish('asset-1');

    expect(withdrawByReference).not.toHaveBeenCalled();
  });

  // Published bytes live in Cloudflare Images from here on; keeping the
  // quarantined copy would mean holding two of every picture the site shows.
  it('drops the quarantined copy once the picture is published', async () => {
    await service.publish('asset-1');

    expect(remove).toHaveBeenCalledWith('test/assets/asset-1');
  });

  it.each([
    ['an error', new Error('the bucket said no')],
    ['something that is not an error', 'the bucket said no'],
  ])(
    'publishes when the quarantined copy cannot be dropped with %s',
    async (_name, failure) => {
      remove.mockRejectedValue(failure);

      await expect(service.publish('asset-1')).resolves.toEqual(
        expect.objectContaining({ published: true }),
      );
    },
  );

  // An asset published before FC-012 stored anything for it, and one whose
  // bytes a sweep already dropped, both reach here with nothing to remove.
  it('has nothing to drop for an asset with no object', async () => {
    findById.mockResolvedValue(
      asset({
        state: FileAssetState.AVAILABLE,
        deliveryReference: 'cf-image-1',
        objectKey: null,
      }),
    );

    await service.publish('asset-1');

    expect(remove).not.toHaveBeenCalled();
  });

  // An interruption between publication and attachment leaves a published
  // asset nothing points at, and the retry picks it up from there.
  it('resumes an asset that was published but never attached', async () => {
    findById.mockResolvedValue(
      asset({
        state: FileAssetState.AVAILABLE,
        deliveryReference: 'cf-image-1',
      }),
    );

    await expect(service.publish('asset-1')).resolves.toEqual(
      expect.objectContaining({ published: true }),
    );

    expect(publishImageToCloudflareImages).not.toHaveBeenCalled();
    expect(publishAsset).not.toHaveBeenCalled();
    expect(attach).toHaveBeenCalled();
  });

  describe('refusals', () => {
    it('refuses an asset that does not exist', async () => {
      findById.mockResolvedValue(null);

      await expect(service.publish('asset-1')).resolves.toEqual({
        published: false,
        refusal: 'NO_SUCH_ASSET',
        deliveryReference: null,
      });
    });

    it.each([
      FileAssetState.SCANNING,
      FileAssetState.REJECTED,
      FileAssetState.REVOKED,
    ])('refuses an asset in %s', async state => {
      findById.mockResolvedValue(asset({ state }));

      await expect(service.publish('asset-1')).resolves.toEqual(
        expect.objectContaining({ refusal: 'NOT_PUBLISHABLE' }),
      );
    });

    // Placed by the feature at ingress, so a missing placement is an upload
    // interrupted before it claimed one.
    it('refuses an asset no slot is waiting for', async () => {
      findByAssetId.mockResolvedValue(null);

      await expect(service.publish('asset-1')).resolves.toEqual(
        expect.objectContaining({ refusal: 'NOT_PLACED' }),
      );
    });

    // Somebody who uploads twice gets the second picture.
    it('refuses, and cleans up after, an upload that lost its slot', async () => {
      findByAssetId.mockResolvedValue(
        placement({ state: FileAssetPlacementState.SUPERSEDED }),
      );

      await expect(service.publish('asset-1')).resolves.toEqual(
        expect.objectContaining({ refusal: 'NOT_PENDING' }),
      );

      expect(remove).toHaveBeenCalledWith('test/assets/asset-1');
      expect(discard).toHaveBeenCalledWith(
        'asset-1',
        'Superseded before publication',
      );
      expect(publishImageToCloudflareImages).not.toHaveBeenCalled();
    });

    it('does not discard an already published asset that lost its slot', async () => {
      findById.mockResolvedValue(
        asset({
          state: FileAssetState.AVAILABLE,
          deliveryReference: 'cf-image-1',
        }),
      );
      findByAssetId.mockResolvedValue(
        placement({ state: FileAssetPlacementState.ABANDONED }),
      );

      await service.publish('asset-1');

      expect(discard).not.toHaveBeenCalled();
    });

    // The sweep and a superseding upload both delete quarantined bytes, so
    // an absent object means this upload was already abandoned.
    it.each([
      ['an error', new Error('no such key')],
      ['something that is not an error', 'no such key'],
    ])(
      'refuses an asset whose bytes have gone, given %s',
      async (_name, failure) => {
        getStream.mockRejectedValue(failure);

        await expect(service.publish('asset-1')).resolves.toEqual(
          expect.objectContaining({ refusal: 'NO_BYTES' }),
        );
      },
    );

    it('refuses an asset that never stored anything', async () => {
      findById.mockResolvedValue(asset({ objectKey: null }));

      await expect(service.publish('asset-1')).resolves.toEqual(
        expect.objectContaining({ refusal: 'NO_BYTES' }),
      );
    });
  });

  describe('a restricted asset', () => {
    const ROSTER = Buffer.from('Character Name,Account Handle\r\n', 'utf8');
    const ROSTER_SHA256 = createHash('sha256').update(ROSTER).digest('hex');

    /**
     * Builds a cleared roster export.
     *
     * @param overrides - Whatever the case is actually about.
     * @returns The asset.
     */
    const rosterAsset = (
      overrides: Partial<FileAssetEntity> = {},
    ): FileAssetEntity =>
      asset({
        audience: FileAssetAudience.RESTRICTED,
        originalFilename: 'Fixture Fleet_20240101-120000.Csv',
        declaredContentType: 'text/csv',
        detectedContentType: 'text/csv',
        sha256: ROSTER_SHA256,
        ...overrides,
      });

    const rosterPlacement = (
      overrides: Partial<FileAssetPlacementEntity> = {},
    ): FileAssetPlacementEntity =>
      placement({
        subject: FileAssetSubject.ROSTER_IMPORT,
        subjectId: 'import-1',
        slot: FileAssetSlot.SOURCE,
        detail: null,
        ...overrides,
      });

    beforeEach(() => {
      findById.mockResolvedValue(rosterAsset());
      findByAssetId.mockResolvedValue(rosterPlacement());
      getStream.mockImplementation(() =>
        Promise.resolve(Readable.from([Buffer.from(ROSTER)])),
      );
    });

    it('puts the placement in force without a delivery reference', async () => {
      await expect(service.publish('asset-1')).resolves.toEqual({
        published: true,
        refusal: null,
        deliveryReference: null,
      });

      expect(publishAsset).toHaveBeenCalledWith('asset-1');
      expect(activate).toHaveBeenCalledWith(rosterPlacement());
    });

    it('never goes near Cloudflare, and never asks for a picture publisher', async () => {
      await service.publish('asset-1');

      expect(publishImageToCloudflareImages).not.toHaveBeenCalled();
      expect(require_).not.toHaveBeenCalled();
      expect(attach).not.toHaveBeenCalled();
      expect(withdrawByReference).not.toHaveBeenCalled();
    });

    // They are the evidence the feature's rows were read from.
    it('keeps the quarantined bytes', async () => {
      await service.publish('asset-1');

      expect(remove).not.toHaveBeenCalled();
    });

    it('hands the feature the cleared bytes and the record they are for', async () => {
      let handed: Buffer | undefined;

      receive.mockImplementation((attachment: { bytes: Buffer }) => {
        handed = Buffer.from(attachment.bytes);

        return Promise.resolve({ accepted: true });
      });

      await service.publish('asset-1');

      expect(requireRestricted).toHaveBeenCalledWith(
        FileAssetSubject.ROSTER_IMPORT,
      );
      expect(receive).toHaveBeenCalledWith(
        expect.objectContaining({
          subjectId: 'import-1',
          slot: FileAssetSlot.SOURCE,
          assetId: 'asset-1',
          uploadedByUserId: 'user-1',
          detail: null,
        }),
      );
      expect(handed).toEqual(ROSTER);
    });

    it('overwrites the bytes once the feature has them', async () => {
      await service.publish('asset-1');

      const [[attachment]] = receive.mock.calls as [[{ bytes: Buffer }]];

      expect(attachment.bytes.every(byte => byte === 0)).toBe(true);
    });

    it('overwrites the bytes when the feature fails', async () => {
      receive.mockRejectedValue(new Error('the database said no'));

      await expect(service.publish('asset-1')).rejects.toThrow(
        'the database said no',
      );

      const [[attachment]] = receive.mock.calls as [[{ bytes: Buffer }]];

      expect(attachment.bytes.every(byte => byte === 0)).toBe(true);
      expect(activate).not.toHaveBeenCalled();
    });

    // Rows written against a pending placement are not in force, so the
    // order is what keeps an interruption invisible.
    it('lets the feature write its rows before anything is put in force', async () => {
      const order: string[] = [];

      receive.mockImplementation(() => {
        order.push('receive');

        return Promise.resolve({ accepted: true });
      });
      publishAsset.mockImplementation(() => {
        order.push('publish');

        return Promise.resolve({});
      });
      activate.mockImplementation(() => {
        order.push('activate');

        return Promise.resolve({ active: rosterPlacement(), replaced: null });
      });

      await service.publish('asset-1');

      expect(order).toEqual(['receive', 'publish', 'activate']);
    });

    it('resumes an asset the feature already accepted', async () => {
      findById.mockResolvedValue(
        rosterAsset({ state: FileAssetState.AVAILABLE }),
      );

      await expect(service.publish('asset-1')).resolves.toEqual(
        expect.objectContaining({ published: true }),
      );

      expect(getStream).not.toHaveBeenCalled();
      expect(receive).not.toHaveBeenCalled();
      expect(publishAsset).not.toHaveBeenCalled();
      expect(activate).toHaveBeenCalled();
    });

    it('refuses bytes that are not the ones the scanner cleared', async () => {
      findById.mockResolvedValue(rosterAsset({ sha256: 'f'.repeat(64) }));

      await expect(service.publish('asset-1')).resolves.toEqual({
        published: false,
        refusal: 'NOT_THESE_BYTES',
        deliveryReference: null,
      });

      expect(receive).not.toHaveBeenCalled();
      expect(publishAsset).not.toHaveBeenCalled();
      expect(activate).not.toHaveBeenCalled();
    });

    it('refuses an asset whose bytes have gone', async () => {
      getStream.mockRejectedValue(new Error('no such key'));

      await expect(service.publish('asset-1')).resolves.toEqual(
        expect.objectContaining({ refusal: 'NO_BYTES' }),
      );

      expect(receive).not.toHaveBeenCalled();
    });

    it('refuses an asset that never stored anything', async () => {
      findById.mockResolvedValue(rosterAsset({ objectKey: null }));

      await expect(service.publish('asset-1')).resolves.toEqual(
        expect.objectContaining({ refusal: 'NO_BYTES' }),
      );
    });

    describe('that the feature will not use', () => {
      beforeEach(() => {
        receive.mockResolvedValue({
          accepted: false,
          rejectionCode: 'ROWS_UNREADABLE',
        });
      });

      it("refuses the asset with the feature's code", async () => {
        await expect(service.publish('asset-1')).resolves.toEqual({
          published: false,
          refusal: 'REFUSED_BY_FEATURE',
          deliveryReference: null,
        });

        expect(reject).toHaveBeenCalledWith('asset-1', 'ROWS_UNREADABLE');
      });

      it('settles the placement as rejected rather than putting it in force', async () => {
        await service.publish('asset-1');

        expect(settle).toHaveBeenCalledWith(
          rosterPlacement(),
          FileAssetPlacementState.REJECTED,
        );
        expect(publishAsset).not.toHaveBeenCalled();
        expect(activate).not.toHaveBeenCalled();
      });

      it('drops the bytes, which are evidence of nothing', async () => {
        await service.publish('asset-1');

        expect(remove).toHaveBeenCalledWith('test/assets/asset-1');
      });
    });

    it.each([
      FileAssetPlacementState.ACTIVE,
      FileAssetPlacementState.REJECTED,
      FileAssetPlacementState.ABANDONED,
    ])(
      'leaves the bytes alone when the placement is already %s',
      async state => {
        findById.mockResolvedValue(
          rosterAsset({ state: FileAssetState.AVAILABLE }),
        );
        findByAssetId.mockResolvedValue(rosterPlacement({ state }));

        await expect(service.publish('asset-1')).resolves.toEqual(
          expect.objectContaining({ refusal: 'NOT_PENDING' }),
        );

        expect(remove).not.toHaveBeenCalled();
        expect(discard).not.toHaveBeenCalled();
      },
    );
  });

  describe('when a placement lost its detail', () => {
    it('publishes without Cloudflare bookkeeping rather than guessing', async () => {
      findByAssetId.mockResolvedValue(placement({ detail: null }));

      await service.publish('asset-1');

      expect(publishImageToCloudflareImages).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: null, entityId: null }),
      );
      expect(attach).toHaveBeenCalledWith(
        expect.objectContaining({ detail: null }),
      );
    });

    it('falls back to the declared type when nothing was detected', async () => {
      findById.mockResolvedValue(asset({ detectedContentType: null }));

      await service.publish('asset-1');

      expect(publishImageToCloudflareImages).toHaveBeenCalledWith(
        expect.objectContaining({ contentType: 'image/jpeg' }),
      );
    });
  });
});
