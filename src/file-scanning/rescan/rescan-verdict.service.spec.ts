import { Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { DataSource } from 'typeorm';

import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { AssetWithdrawalService } from 'src/file-assets/services/asset-withdrawal.service';
import { FileAssetService } from 'src/file-assets/services/file-asset.service';
import { NotificationService } from 'src/notification/notification.service';

import { ScanVerdictMessage } from '../contract/file-scan-contract';
import { FileRescanEntity } from './file-rescan.entity';
import { RescanCampaignService } from './rescan-campaign.service';
import { RescanVerdictService } from './rescan-verdict.service';
import { RescanState } from './rescan.enums';

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
      { manager } as unknown as DataSource,
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
});
