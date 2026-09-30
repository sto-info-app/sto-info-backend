import { ConflictException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Queue } from 'bullmq';
import { DataSource, IsNull, QueryFailedError } from 'typeorm';

import { SiteAdminActionEntity } from 'src/audit/site-admin/site-admin-action.entity';
import { SiteAdminActionKind } from 'src/audit/site-admin/site-admin-action.enum';
import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { FileAssetStorage } from 'src/file-assets/enums/file-asset-storage.enum';
import { QuarantineStorageService } from 'src/file-assets/services/quarantine-storage.service';
import { ImageUploadsService } from 'src/shared/utilities/image-uploads.service';

import { ScanDiagnosticsService } from '../services/scan-diagnostics.service';
import { ScanRequestProducerService } from '../services/scan-request-producer.service';
import { FileRescanCampaignEntity } from './file-rescan-campaign.entity';
import { FileRescanEntity } from './file-rescan.entity';
import { RescanCampaignService } from './rescan-campaign.service';
import {
  RESCAN_BATCH_SIZE,
  RESCAN_PRIORITIES,
  RESCAN_QUEUE_CEILING,
} from './rescan.constants';
import {
  RescanCampaignKind,
  RescanCampaignState,
  RescanState,
} from './rescan.enums';

type Fn = jest.Mock<(...args: any[]) => any>;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/**
 * A campaign.
 *
 * @param overrides - What differs.
 * @returns It.
 */
const campaignOf = (
  overrides: Partial<FileRescanCampaignEntity> = {},
): FileRescanCampaignEntity =>
  ({
    id: 'campaign-1',
    kind: RescanCampaignKind.MANUAL,
    state: RescanCampaignState.RUNNING,
    startedByUserId: 'admin-1',
    selection: {},
    cursor: null,
    counts: {},
    lastError: null,
    finishedAt: null,
    ...overrides,
  }) as FileRescanCampaignEntity;

/**
 * A published picture.
 *
 * @param overrides - What differs.
 * @returns It.
 */
const assetOf = (overrides: Partial<FileAssetEntity> = {}): FileAssetEntity =>
  ({
    id: 'asset-1',
    state: FileAssetState.AVAILABLE,
    storage: FileAssetStorage.PUBLIC_IMAGES,
    deliveryReference: 'image-1',
    policyVersion: 1,
    ...overrides,
  }) as FileAssetEntity;

describe('RescanCampaignService (FC-041)', () => {
  let manager: Record<string, Fn>;
  let builder: Record<string, Fn>;
  let images: Record<string, Fn>;
  let quarantine: Record<string, Fn>;
  let producer: Record<string, Fn>;
  let query: Fn;
  let add: Fn;
  let service: RescanCampaignService;

  beforeEach(() => {
    builder = {};
    for (const method of ['where', 'andWhere', 'orderBy', 'take']) {
      builder[method] = jest.fn(() => builder);
    }
    builder.getMany = jest.fn(() => Promise.resolve([]));
    manager = {
      find: jest.fn(() => Promise.resolve([])),
      findOne: jest.fn(() => Promise.resolve(campaignOf())),
      count: jest.fn(() => Promise.resolve(0)),
      exists: jest.fn(() => Promise.resolve(false)),
      save: jest.fn((_entity: unknown, value: unknown) =>
        Promise.resolve({ id: 'campaign-new', ...(value as object) }),
      ),
      create: jest.fn((_entity: unknown, value: unknown) => ({
        ...(value as object),
      })),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
      insert: jest.fn(() => Promise.resolve({})),
      createQueryBuilder: jest.fn(() => builder),
    };
    query = jest.fn(() => Promise.resolve([]));
    images = {
      readImage: jest.fn(() => Promise.resolve(PNG)),
      readR2Object: jest.fn(() => Promise.resolve(PNG)),
    };
    quarantine = {
      put: jest.fn(() =>
        Promise.resolve({ objectKey: 'k', objectVersion: null }),
      ),
      remove: jest.fn(() => Promise.resolve()),
    };
    producer = {
      waiting: jest.fn(() => Promise.resolve(0)),
      requestRescan: jest.fn(() => Promise.resolve()),
    };
    add = jest.fn(() => Promise.resolve());
    service = new RescanCampaignService(
      {
        manager,
        query,
        transaction: (work: (m: unknown) => Promise<unknown>) => work(manager),
      } as unknown as DataSource,
      images as unknown as ImageUploadsService,
      quarantine as unknown as QuarantineStorageService,
      producer as unknown as ScanRequestProducerService,
      {
        currentDefinitionEpoch: () => Promise.resolve('28138'),
      } as unknown as ScanDiagnosticsService,
      { get: () => 'test' } as unknown as ConfigService,
      { add } as unknown as Queue,
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  /** Every count the campaigns were given, as [campaign, key]. */
  const counted = () =>
    query.mock.calls
      .filter(([sql]) => String(sql).includes('jsonb_set'))
      .map(([, params]) => params as string[]);

  /** Every row the site admin log was given. */
  const logged = () =>
    manager.insert.mock.calls
      .filter(([entity]) => entity === SiteAdminActionEntity)
      .map(([, row]) => row);

  it('reads the latest campaigns, what is waiting and the latest findings', async () => {
    manager.find
      .mockResolvedValueOnce([campaignOf()])
      .mockResolvedValueOnce([{ assetId: 'asset-1' }]);
    manager.count.mockResolvedValueOnce(2).mockResolvedValueOnce(7);

    await expect(service.overview()).resolves.toEqual({
      campaigns: [campaignOf()],
      waiting: 2,
      unverified: 7,
      findings: [{ assetId: 'asset-1' }],
    });

    // Infections stay listed; a policy refusal leaves once decided (FC-050).
    expect(manager.find).toHaveBeenCalledWith(
      FileRescanEntity,
      expect.objectContaining({
        where: [
          { state: RescanState.INFECTED },
          { state: RescanState.REFUSED, decision: IsNull() },
        ],
        select: expect.objectContaining({ id: true, assetId: true }),
      }),
    );
  });

  it('starts a campaign, logged with its selection, and queues it', async () => {
    const selection = { kinds: ['PROFILE_IMAGE'], priority: 'HIGH' as const };

    await expect(
      service.start(selection, 'admin-1', 'New signatures'),
    ).resolves.toEqual(expect.objectContaining({ id: 'campaign-new' }));
    expect(logged()).toEqual([
      expect.objectContaining({
        action: SiteAdminActionKind.RESCAN_STARTED,
        actorUserId: 'admin-1',
        subjectKind: 'RESCAN_CAMPAIGN',
        subjectId: 'campaign-new',
        reason: 'New signatures',
        detail: { selection },
      }),
    ]);
    expect(add).toHaveBeenCalledWith(
      'campaign-batch',
      { campaignId: 'campaign-new' },
      expect.objectContaining({ delay: 0 }),
    );
  });

  describe('startLegacyOnce', () => {
    it('starts the legacy campaign by the system, behind everything', async () => {
      manager.count.mockResolvedValue(5);

      await expect(service.startLegacyOnce()).resolves.toEqual(
        expect.objectContaining({
          kind: RescanCampaignKind.LEGACY,
          startedByUserId: null,
          selection: { unverifiedOnly: true, priority: 'LOW' },
        }),
      );
      expect(add).toHaveBeenCalled();
    });

    it('starts nothing once one has run, or with no legacy estate', async () => {
      manager.exists.mockResolvedValueOnce(true);

      await expect(service.startLegacyOnce()).resolves.toBeNull();
      await expect(service.startLegacyOnce()).resolves.toBeNull();
      expect(manager.save).not.toHaveBeenCalled();
    });
  });

  describe('pause, resume and cancel', () => {
    it('pauses a running campaign, logged', async () => {
      await expect(
        service.pause('campaign-1', 'admin-1', 'Busy night'),
      ).resolves.toEqual(
        expect.objectContaining({ state: RescanCampaignState.PAUSED }),
      );
      expect(logged()).toEqual([
        expect.objectContaining({ action: SiteAdminActionKind.RESCAN_PAUSED }),
      ]);
      expect(add).not.toHaveBeenCalled();
    });

    it('resumes one, logged, and queues it', async () => {
      await service.resume('campaign-1', 'admin-1', 'Quiet now');

      expect(logged()).toEqual([
        expect.objectContaining({ action: SiteAdminActionKind.RESCAN_RESUMED }),
      ]);
      expect(add).toHaveBeenCalled();
    });

    it('cancels one, finishing it, logged', async () => {
      await expect(
        service.cancel('campaign-1', 'admin-1', 'Wrong selection'),
      ).resolves.toEqual(
        expect.objectContaining({
          state: RescanCampaignState.CANCELLED,
          finishedAt: expect.any(Date),
        }),
      );
      expect(logged()).toEqual([
        expect.objectContaining({
          action: SiteAdminActionKind.RESCAN_CANCELLED,
        }),
      ]);
    });

    it('refuses a campaign that cannot', async () => {
      manager.findOne.mockResolvedValue(null);

      await expect(
        service.pause('campaign-1', 'admin-1', 'Why'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('processBatch', () => {
    it.each([
      ['a campaign that has gone', null],
      ['a paused campaign', campaignOf({ state: RescanCampaignState.PAUSED })],
    ])('does nothing for %s', async (_case, campaign) => {
      manager.findOne.mockResolvedValue(campaign);

      await service.processBatch('campaign-1');

      expect(producer.waiting).not.toHaveBeenCalled();
    });

    it('holds back behind a long queue, and looks again later', async () => {
      producer.waiting.mockResolvedValue(RESCAN_QUEUE_CEILING);

      await service.processBatch('campaign-1');

      expect(builder.getMany).not.toHaveBeenCalled();
      expect(add).toHaveBeenCalledWith(
        'campaign-batch',
        { campaignId: 'campaign-1' },
        expect.objectContaining({ delay: 30_000 }),
      );
    });

    it('selects by every filter it is given', async () => {
      manager.findOne.mockResolvedValue(
        campaignOf({
          cursor: 'asset-0',
          selection: {
            kinds: ['PROFILE_IMAGE'],
            uploadedFrom: '2026-01-01T00:00:00.000Z',
            uploadedBefore: '2026-06-01T00:00:00.000Z',
            notScannedForDays: 90,
            unverifiedOnly: true,
          },
        }),
      );

      await service.processBatch('campaign-1');

      const clauses = builder.andWhere.mock.calls.map(([clause]) =>
        typeof clause === 'string' ? clause : 'brackets',
      );
      const brackets = builder.andWhere.mock.calls.find(
        ([clause]) => typeof clause !== 'string',
      )?.[0] as { whereFactory: (query: unknown) => unknown };
      const inner: Record<string, Fn> = {};

      inner.where = jest.fn(() => inner);
      inner.orWhere = jest.fn(() => inner);

      brackets.whereFactory(inner);
      expect(inner.where).toHaveBeenCalledWith('asset.lastVerdictAt IS NULL');
      expect(inner.orWhere).toHaveBeenCalledWith(
        'asset.lastVerdictAt < :since',
        { since: expect.any(Date) },
      );

      expect(builder.andWhere).toHaveBeenCalledWith(
        'asset.state IN (:...states)',
        {
          states: [FileAssetState.UNVERIFIED],
        },
      );
      expect(clauses).toEqual(
        expect.arrayContaining([
          'asset.id > :cursor',
          'asset.kind IN (:...kinds)',
          'asset.createdAt >= :from',
          'asset.createdAt < :before',
          'brackets',
        ]),
      );
      expect(builder.take).toHaveBeenCalledWith(RESCAN_BATCH_SIZE);
    });

    it('selects every picture that may be shown, with no filter', async () => {
      await service.processBatch('campaign-1');

      expect(builder.andWhere).toHaveBeenCalledWith(
        'asset.state IN (:...states)',
        {
          states: [FileAssetState.AVAILABLE, FileAssetState.UNVERIFIED],
        },
      );
      expect(builder.andWhere).not.toHaveBeenCalledWith(
        'asset.id > :cursor',
        expect.anything(),
      );
    });

    it('stages a copy of each picture, asks for its scan, and finishes', async () => {
      builder.getMany.mockResolvedValue([
        assetOf(),
        assetOf({
          id: 'asset-2',
          storage: FileAssetStorage.LEGACY_PUBLIC_R2,
          deliveryReference: 'user-1/portrait.png',
        }),
      ]);
      manager.findOne.mockResolvedValue(
        campaignOf({ selection: { priority: 'HIGH' } }),
      );

      await service.processBatch('campaign-1');

      expect(images.readImage).toHaveBeenCalledWith('image-1');
      expect(images.readR2Object).toHaveBeenCalledWith('user-1/portrait.png');
      expect(quarantine.put).toHaveBeenCalledWith(
        expect.stringMatching(/^test\/rescans\/[0-9a-f-]{36}$/),
        PNG,
      );
      expect(manager.insert).toHaveBeenCalledWith(
        FileRescanEntity,
        expect.objectContaining({
          campaignId: 'campaign-1',
          assetId: 'asset-1',
          state: RescanState.REQUESTED,
          declaredContentType: 'image/png',
          definitionEpoch: '28138',
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      );
      expect(producer.requestRescan).toHaveBeenCalledWith(
        expect.objectContaining({
          assetId: 'asset-1',
          campaignId: 'campaign-1',
          priority: RESCAN_PRIORITIES.HIGH,
          objectVersion: null,
        }),
      );
      expect(counted()).toEqual([
        ['campaign-1', 'requested'],
        ['campaign-1', 'requested'],
      ]);
      expect(manager.update).toHaveBeenCalledWith(
        FileRescanCampaignEntity,
        { id: 'campaign-1', state: RescanCampaignState.RUNNING },
        expect.objectContaining({
          cursor: 'asset-2',
          state: RescanCampaignState.DONE,
          finishedAt: expect.any(Date),
        }),
      );
    });

    it('skips a picture rescanned against these signatures already', async () => {
      builder.getMany.mockResolvedValue([assetOf()]);
      manager.exists.mockResolvedValue(true);

      await service.processBatch('campaign-1');

      expect(manager.exists).toHaveBeenCalledWith(FileRescanEntity, {
        where: [
          expect.objectContaining({ definitionEpoch: '28138' }),
          expect.objectContaining({ signatureVersion: '28138' }),
        ],
      });
      expect(quarantine.put).not.toHaveBeenCalled();
      expect(counted()).toEqual([['campaign-1', 'skipped']]);
    });

    it('skips a picture another campaign staged between the check and the insert', async () => {
      builder.getMany.mockResolvedValue([assetOf()]);
      manager.insert.mockRejectedValue(
        Object.assign(new QueryFailedError('INSERT', [], new Error('dup')), {
          code: '23505',
        }),
      );

      await service.processBatch('campaign-1');

      expect(quarantine.remove).toHaveBeenCalled();
      expect(counted()).toEqual([['campaign-1', 'skipped']]);
    });

    it.each([
      ['reading the picture', 'read', new Error('Cloudflare is down')],
      ['queueing the scan', 'queue', 'Redis is down'],
    ])(
      'counts a picture it could not stage, failing on %s',
      async (_case, where, failure) => {
        builder.getMany.mockResolvedValue([assetOf()]);

        if (where === 'read') {
          images.readImage.mockRejectedValue(failure);
        } else {
          producer.requestRescan.mockRejectedValue(failure);
        }

        await service.processBatch('campaign-1');

        expect(quarantine.remove).toHaveBeenCalledTimes(
          where === 'read' ? 0 : 1,
        );
        expect(manager.update).toHaveBeenCalledWith(
          FileRescanEntity,
          expect.objectContaining({ state: RescanState.REQUESTED }),
          expect.objectContaining({ state: RescanState.FAILED }),
        );
        expect(counted()).toEqual([['campaign-1', 'failed']]);
      },
    );

    it('queues the next batch after a full one', async () => {
      builder.getMany.mockResolvedValue(
        Array.from({ length: RESCAN_BATCH_SIZE }, (_each, index) =>
          assetOf({ id: `asset-${index}` }),
        ),
      );
      manager.exists.mockResolvedValue(true);

      await service.processBatch('campaign-1');

      expect(add).toHaveBeenCalledWith(
        'campaign-batch',
        { campaignId: 'campaign-1' },
        expect.objectContaining({ delay: 0 }),
      );
    });

    it('keeps its progress and stops when a pause landed meanwhile', async () => {
      builder.getMany.mockResolvedValue(
        Array.from({ length: RESCAN_BATCH_SIZE }, (_each, index) =>
          assetOf({ id: `asset-${index}` }),
        ),
      );
      manager.exists.mockResolvedValue(true);
      manager.update.mockImplementation(
        (_entity: unknown, where: { state?: unknown }) =>
          Promise.resolve({ affected: where.state === undefined ? 1 : 0 }),
      );

      await service.processBatch('campaign-1');

      expect(manager.update).toHaveBeenLastCalledWith(
        FileRescanCampaignEntity,
        { id: 'campaign-1' },
        { cursor: `asset-${RESCAN_BATCH_SIZE - 1}` },
      );
      expect(add).not.toHaveBeenCalled();
    });

    it.each([
      ['an error', new Error('database gone')],
      ['something that is not an error', 'gone'],
    ])('fails the campaign on %s, to be resumed', async (_case, failure) => {
      builder.getMany.mockRejectedValue(failure);

      await service.processBatch('campaign-1');

      expect(manager.update).toHaveBeenCalledWith(
        FileRescanCampaignEntity,
        { id: 'campaign-1', state: RescanCampaignState.RUNNING },
        expect.objectContaining({
          state: RescanCampaignState.FAILED,
          lastError: expect.stringContaining('gone'),
        }),
      );
    });
  });

  it('gives up on rescans with no verdict after a day, once each', async () => {
    manager.find.mockResolvedValue([
      { id: 'rescan-1', campaignId: 'campaign-1', stagingKey: 'k1' },
      { id: 'rescan-2', campaignId: 'campaign-1', stagingKey: 'k2' },
    ]);
    manager.update
      .mockResolvedValueOnce({ affected: 1 })
      .mockResolvedValueOnce({ affected: 0 });

    await expect(
      service.sweepStale(new Date('2026-09-29T12:00:00.000Z')),
    ).resolves.toBe(2);
    expect(counted()).toEqual([['campaign-1', 'failed']]);
    expect(quarantine.remove).toHaveBeenCalledWith('k1');
    expect(quarantine.remove).not.toHaveBeenCalledWith('k2');
  });

  it('sweeps from now when not told otherwise', async () => {
    await expect(service.sweepStale()).resolves.toBe(0);
  });

  it('reports a staged copy it cannot delete', async () => {
    quarantine.remove.mockRejectedValue(new Error('down'));

    await expect(service.dropCopy('k1')).resolves.toBeUndefined();
  });
});
