import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { DataSource } from 'typeorm';

import { SiteAdminActionEntity } from 'src/audit/site-admin/site-admin-action.entity';
import { SiteAdminActionKind } from 'src/audit/site-admin/site-admin-action.enum';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { AssetWithdrawalService } from 'src/file-assets/services/asset-withdrawal.service';
import { FileAssetService } from 'src/file-assets/services/file-asset.service';
import { NotificationService } from 'src/notification/notification.service';

import { ScanVerdictMessage } from '../contract/file-scan-contract';
import { FileRescanEntity } from './file-rescan.entity';
import { RescanCampaignService } from './rescan-campaign.service';
import { RescanVerdictService } from './rescan-verdict.service';
import { RescanDecision, RescanState } from './rescan.enums';

type Fn = jest.Mock<(...args: any[]) => any>;

const SHA = 'a'.repeat(64);

/**
 * A verdict for the staged copy.
 *
 * @param overrides - What differs.
 * @returns It.
 */
const verdictOf = (
  overrides: Partial<ScanVerdictMessage> = {},
): ScanVerdictMessage =>
  ({
    schemaVersion: 2,
    assetId: 'asset-1',
    attemptId: 'attempt-1',
    objectKey: 'test/rescans/rescan-1',
    objectVersion: null,
    expectedSha256: SHA,
    observedSha256: SHA,
    policyVersion: 1,
    definitionEpoch: '28138',
    outcome: 'CLEAN',
    rejectionCode: null,
    engine: 'clamav',
    engineVersion: '1.5.4',
    signatureVersion: '28138',
    scannedAt: '2026-09-29T12:00:00.000Z',
    traceId: 'trace-1',
    ...overrides,
  }) as ScanVerdictMessage;

const RESCAN = {
  id: 'rescan-1',
  campaignId: 'campaign-1',
  assetId: 'asset-1',
  state: RescanState.REQUESTED,
  stagingKey: 'test/rescans/rescan-1',
  sha256: SHA,
  declaredContentType: 'image/png',
} as FileRescanEntity;

describe('RescanVerdictService (FC-041)', () => {
  let manager: Record<string, Fn>;
  let fileAssets: Record<string, Fn>;
  let withdrawal: Record<string, Fn>;
  let createNotification: Fn;
  let campaigns: Record<string, Fn>;
  let service: RescanVerdictService;

  beforeEach(() => {
    manager = {
      findOne: jest.fn(() => Promise.resolve(RESCAN)),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
      find: jest.fn(() =>
        Promise.resolve([{ id: 'admin-1' }, { id: 'admin-2' }]),
      ),
      insert: jest.fn(() => Promise.resolve({})),
    };
    fileAssets = {
      recordRescanClean: jest.fn(() => Promise.resolve({})),
      recordRescanRejection: jest.fn(() => Promise.resolve()),
      findById: jest.fn(() =>
        Promise.resolve({
          id: 'asset-1',
          state: FileAssetState.AVAILABLE,
          deliveryReference: 'image-1',
          ownerUserId: 'owner-1',
        }),
      ),
    };
    withdrawal = { withdrawByReference: jest.fn(() => Promise.resolve({})) };
    createNotification = jest.fn(() => Promise.resolve({}));
    campaigns = {
      count: jest.fn(() => Promise.resolve()),
      dropCopy: jest.fn(() => Promise.resolve()),
    };
    service = new RescanVerdictService(
      {
        manager,
        transaction: (work: (inner: unknown) => Promise<unknown>) =>
          work(manager),
      } as unknown as DataSource,
      fileAssets as unknown as FileAssetService,
      withdrawal as unknown as AssetWithdrawalService,
      {
        get: () => ({ createNotification }) as unknown as NotificationService,
      } as unknown as ModuleRef,
      campaigns as unknown as RescanCampaignService,
    );
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  /** What the rescan was settled as. */
  const settledAs = () =>
    manager.update.mock.calls.find(
      ([entity]) => entity === FileRescanEntity,
    )?.[2];

  it('leaves a verdict that is not a rescan’s to the upload path', async () => {
    manager.findOne.mockResolvedValue(null);

    await expect(service.apply(verdictOf())).resolves.toBe(false);
  });

  it('settles nothing twice', async () => {
    manager.findOne.mockResolvedValue({ ...RESCAN, state: RescanState.CLEAN });

    await expect(service.apply(verdictOf())).resolves.toBe(true);
    expect(manager.update).not.toHaveBeenCalled();

    manager.findOne.mockResolvedValue(RESCAN);
    manager.update.mockResolvedValue({ affected: 0 });

    await expect(service.apply(verdictOf())).resolves.toBe(true);
    expect(campaigns.count).not.toHaveBeenCalled();
  });

  it('keeps a clean picture, records its verdict, and drops the copy', async () => {
    await expect(service.apply(verdictOf())).resolves.toBe(true);

    expect(settledAs()).toEqual(
      expect.objectContaining({
        state: RescanState.CLEAN,
        rejectionCode: null,
        engine: 'clamav',
        verdictAt: expect.any(Date),
      }),
    );
    expect(fileAssets.recordRescanClean).toHaveBeenCalledWith(
      'asset-1',
      expect.objectContaining({ engine: 'clamav', policyVersion: 1 }),
      { sha256: SHA, detectedContentType: 'image/png' },
    );
    expect(campaigns.count).toHaveBeenCalledWith('campaign-1', 'clean');
    expect(campaigns.dropCopy).toHaveBeenCalledWith('test/rescans/rescan-1');
  });

  it.each([
    ['a clean verdict for other bytes', { observedSha256: 'b'.repeat(64) }],
    ['a clean verdict about another hash', { expectedSha256: 'b'.repeat(64) }],
    ['a retry', { outcome: 'RETRY' as const }],
    [
      'a hash mismatch',
      { outcome: 'REJECTED' as const, rejectionCode: 'HASH_MISMATCH' as const },
    ],
    [
      'a missing object',
      {
        outcome: 'REJECTED' as const,
        rejectionCode: 'OBJECT_MISSING' as const,
      },
    ],
  ])('counts %s as no verdict', async (_case, overrides) => {
    await service.apply(verdictOf(overrides));

    expect(settledAs()).toEqual(
      expect.objectContaining({
        state: RescanState.FAILED,
        rejectionCode: null,
      }),
    );
    expect(fileAssets.recordRescanClean).not.toHaveBeenCalled();
    expect(campaigns.count).toHaveBeenCalledWith('campaign-1', 'failed');
  });

  it.each([
    'CONTENT_TYPE_MISMATCH',
    'SIZE_LIMIT_EXCEEDED',
    'UNSUPPORTED_PAYLOAD',
  ])(
    'leaves a picture refused for policy (%s) up, and reports it',
    async code => {
      await service.apply(
        verdictOf({ outcome: 'REJECTED', rejectionCode: code as never }),
      );

      expect(settledAs()).toEqual(
        expect.objectContaining({
          state: RescanState.REFUSED,
          rejectionCode: code,
        }),
      );
      expect(withdrawal.withdrawByReference).not.toHaveBeenCalled();
      expect(campaigns.count).toHaveBeenCalledWith('campaign-1', 'refused');
    },
  );

  it('counts a rejection with no code as a policy refusal', async () => {
    await service.apply(
      verdictOf({ outcome: 'REJECTED', rejectionCode: null }),
    );

    expect(settledAs()).toEqual(
      expect.objectContaining({ state: RescanState.REFUSED }),
    );
  });

  describe('an infected picture', () => {
    const infected = () =>
      service.apply(
        verdictOf({ outcome: 'REJECTED', rejectionCode: 'INFECTED' }),
      );

    it('refuses delivery, deletes it, records why, and tells the admins and the owner', async () => {
      await infected();

      expect(settledAs()).toEqual(
        expect.objectContaining({
          state: RescanState.INFECTED,
          rejectionCode: 'INFECTED',
        }),
      );
      expect(withdrawal.withdrawByReference).toHaveBeenCalledWith(
        'image-1',
        'Infected on rescan: INFECTED',
      );
      expect(fileAssets.recordRescanRejection).toHaveBeenCalledWith(
        'asset-1',
        'INFECTED',
        expect.objectContaining({ engine: 'clamav' }),
      );
      expect(createNotification.mock.calls.map(([notice]) => notice)).toEqual([
        expect.objectContaining({
          userId: 'admin-1',
          title: 'Infected picture taken down',
          body: expect.stringContaining('asset-1'),
          linkUrl: '/admin/scan-diagnostics',
        }),
        expect.objectContaining({ userId: 'admin-2' }),
        {
          target: 'USER',
          userId: 'owner-1',
          severity: 'WARNING',
          title: 'A picture was removed',
          body: expect.not.stringContaining('asset-1'),
          linkUrl: undefined,
        },
      ]);
      expect(campaigns.count).toHaveBeenCalledWith('campaign-1', 'infected');
    });

    it('takes down nothing already down, and tells no owner there is none of', async () => {
      fileAssets.findById.mockResolvedValue({
        id: 'asset-1',
        state: FileAssetState.REVOKED,
        deliveryReference: 'image-1',
        ownerUserId: null,
      });

      await infected();

      expect(withdrawal.withdrawByReference).not.toHaveBeenCalled();
      expect(createNotification).toHaveBeenCalledTimes(2);
    });

    it('does nothing more for a picture that has gone', async () => {
      fileAssets.findById.mockResolvedValue(null);

      await infected();

      expect(fileAssets.recordRescanRejection).not.toHaveBeenCalled();
      expect(createNotification).not.toHaveBeenCalled();
    });

    it('still settles when a notice cannot be sent', async () => {
      createNotification.mockRejectedValue(new Error('down'));

      await expect(infected()).resolves.toBe(true);
      expect(campaigns.count).toHaveBeenCalledWith('campaign-1', 'infected');
    });
  });

  // Steve's decision of 30 September 2026: a picture refused for policy on
  // rescan is taken down or kept by a site admin, with a reason (FC-050).
  describe('deciding a policy refusal', () => {
    const REFUSED = {
      ...RESCAN,
      state: RescanState.REFUSED,
      rejectionCode: 'DIMENSIONS_EXCEEDED',
      engine: 'clamav',
      engineVersion: '1.5.4',
      signatureVersion: '28138',
      policyVersion: 3,
      decision: null,
    } as unknown as FileRescanEntity;

    /** What the site admin log was given. */
    const logged = () =>
      manager.insert.mock.calls
        .filter(([entity]) => entity === SiteAdminActionEntity)
        .map(([, row]) => row);

    beforeEach(() => {
      manager.findOne.mockResolvedValue(REFUSED);
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    });

    it('takes it down, logs why, and tells its owner', async () => {
      await service.decide(
        'rescan-1',
        'admin-1',
        RescanDecision.TAKEN_DOWN,
        'Breaks the rules',
      );

      expect(withdrawal.withdrawByReference).toHaveBeenCalledWith(
        'image-1',
        expect.stringContaining('DIMENSIONS_EXCEEDED'),
      );
      expect(fileAssets.recordRescanRejection).toHaveBeenCalledWith(
        'asset-1',
        'DIMENSIONS_EXCEEDED',
        {
          engine: 'clamav',
          engineVersion: '1.5.4',
          signatureVersion: '28138',
          policyVersion: 3,
        },
      );
      expect(manager.update).toHaveBeenCalledWith(
        FileRescanEntity,
        expect.objectContaining({ id: 'rescan-1', state: RescanState.REFUSED }),
        {
          decision: RescanDecision.TAKEN_DOWN,
          decidedAt: expect.any(Date),
          decidedByUserId: 'admin-1',
        },
      );
      expect(logged()).toEqual([
        expect.objectContaining({
          action: SiteAdminActionKind.IMAGE_TAKEN_DOWN,
          actorUserId: 'admin-1',
          targetUserId: 'owner-1',
          subjectKind: 'FILE_ASSET',
          subjectId: 'asset-1',
          reason: 'Breaks the rules',
          detail: {
            rescanId: 'rescan-1',
            rejectionCode: 'DIMENSIONS_EXCEEDED',
          },
        }),
      ]);
      expect(createNotification).toHaveBeenCalledTimes(1);
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'owner-1',
          title: 'A picture was removed',
          body: expect.stringContaining('rules for pictures'),
        }),
      );
    });

    it('keeps it, logged, touching nothing else', async () => {
      await service.decide(
        'rescan-1',
        'admin-1',
        RescanDecision.KEPT,
        'Fine as it is',
      );

      expect(withdrawal.withdrawByReference).not.toHaveBeenCalled();
      expect(fileAssets.recordRescanRejection).not.toHaveBeenCalled();
      expect(createNotification).not.toHaveBeenCalled();
      expect(logged()).toEqual([
        expect.objectContaining({
          action: SiteAdminActionKind.IMAGE_KEPT,
          reason: 'Fine as it is',
        }),
      ]);
    });

    it('records a takedown of a picture no longer served, without withdrawing it again', async () => {
      fileAssets.findById.mockResolvedValue({
        id: 'asset-1',
        state: FileAssetState.REJECTED,
        deliveryReference: null,
        ownerUserId: null,
      });
      manager.findOne.mockResolvedValue({ ...REFUSED, engine: null });

      await service.decide(
        'rescan-1',
        'admin-1',
        RescanDecision.TAKEN_DOWN,
        'Breaks the rules',
      );

      expect(withdrawal.withdrawByReference).not.toHaveBeenCalled();
      expect(fileAssets.recordRescanRejection).toHaveBeenCalledWith(
        'asset-1',
        'DIMENSIONS_EXCEEDED',
        expect.objectContaining({ engine: 'unknown' }),
      );
      // Nobody to tell.
      expect(createNotification).not.toHaveBeenCalled();
      expect(logged()).toEqual([
        expect.objectContaining({ targetUserId: null }),
      ]);
    });

    it('decides a finding whose picture has gone from the registry', async () => {
      fileAssets.findById.mockResolvedValue(null);

      await service.decide(
        'rescan-1',
        'admin-1',
        RescanDecision.TAKEN_DOWN,
        'Breaks the rules',
      );

      expect(fileAssets.recordRescanRejection).not.toHaveBeenCalled();
      expect(createNotification).not.toHaveBeenCalled();
      expect(logged()).toHaveLength(1);
    });

    it('says there is no such rescan', async () => {
      manager.findOne.mockResolvedValue(null);

      await expect(
        service.decide('rescan-9', 'admin-1', RescanDecision.KEPT, 'Why'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([
      ['an infection', { state: RescanState.INFECTED }],
      ['a decided refusal', { decision: RescanDecision.KEPT }],
    ])('refuses to decide %s', async (_label, change) => {
      manager.findOne.mockResolvedValue({ ...REFUSED, ...change });

      await expect(
        service.decide('rescan-1', 'admin-1', RescanDecision.KEPT, 'Why'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(logged()).toEqual([]);
    });

    it('logs nothing when another site admin decided it first', async () => {
      manager.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.decide('rescan-1', 'admin-1', RescanDecision.KEPT, 'Why'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(logged()).toEqual([]);
    });
  });
});
