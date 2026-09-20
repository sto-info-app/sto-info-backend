import { ConflictException } from '@nestjs/common';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Queue } from 'bullmq';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetKind } from 'src/file-assets/enums/file-asset-kind.enum';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { FileAssetService } from 'src/file-assets/services/file-asset.service';

import { parseScanRequestMessage } from '../contract/file-scan-contract';
import { ScanRequestProducerService } from './scan-request-producer.service';

const ASSET_ID = '4f1a0e2c-8b3d-4a59-9c21-6f7e5d4c3b2a';

/**
 * Builds a quarantined asset.
 *
 * @param changes - Fields to override.
 * @returns The asset.
 */
function asset(changes: Partial<FileAssetEntity> = {}): FileAssetEntity {
  return {
    id: ASSET_ID,
    kind: FileAssetKind.ROSTER_IMPORT_SOURCE,
    state: FileAssetState.QUARANTINED,
    objectKey: `local/assets/${ASSET_ID}`,
    objectVersion: null,
    sha256: 'a'.repeat(64),
    declaredContentType: 'text/csv',
    policyVersion: 1,
    ...changes,
  } as FileAssetEntity;
}

describe('ScanRequestProducerService', () => {
  let add: jest.Mock;
  let markScanning: jest.Mock;
  let markRetryPending: jest.Mock;
  let service: ScanRequestProducerService;

  beforeEach(() => {
    add = jest.fn(() => Promise.resolve({}));
    markScanning = jest.fn(() =>
      Promise.resolve(asset({ state: FileAssetState.SCANNING })),
    );
    markRetryPending = jest.fn(() =>
      Promise.resolve(asset({ state: FileAssetState.RETRY_PENDING })),
    );

    service = new ScanRequestProducerService(
      { add } as unknown as Queue,
      { markScanning, markRetryPending } as unknown as FileAssetService,
    );
  });

  /** The message the producer put on the queue. */
  function sent(): unknown {
    return (add.mock.calls[0] as unknown[])[1];
  }

  describe('the message it sends', () => {
    it('matches the contract', async () => {
      await service.requestScan(asset());

      expect(() => parseScanRequestMessage(sent())).not.toThrow();
    });

    it('names the object the registry recorded', async () => {
      await service.requestScan(asset());

      expect(sent()).toEqual(
        expect.objectContaining({
          assetId: ASSET_ID,
          objectKey: `local/assets/${ASSET_ID}`,
          objectVersion: null,
          expectedSha256: 'a'.repeat(64),
          declaredContentType: 'text/csv',
          policyVersion: 1,
          campaignId: null,
        }),
      );
    });

    it('carries nothing that says where to fetch from', async () => {
      // The first acceptance criterion. No URL, no bucket, no endpoint, no
      // credentials, no filename and no row of anybody's data — the worker
      // resolves all of that from its own configuration, so no message can
      // point it anywhere else.
      await service.requestScan(asset());

      expect(Object.keys(sent() as object).sort()).toEqual([
        'assetId',
        'campaignId',
        'declaredContentType',
        'expectedSha256',
        'objectKey',
        'objectVersion',
        'policyVersion',
        'schemaVersion',
        'traceId',
      ]);
    });

    it('carries a fresh trace each time', async () => {
      await service.requestScan(asset());
      await service.requestScan(asset());

      const traces = add.mock.calls.map(
        call => (call[1] as { traceId: string }).traceId,
      );

      expect(new Set(traces).size).toBe(2);
    });

    it('names the campaign when it belongs to one', async () => {
      const campaignId = '5d2c1b0a-9e8f-4d7c-8b6a-5f4e3d2c1b0a';

      await service.requestScan(asset(), campaignId);

      expect(sent()).toEqual(expect.objectContaining({ campaignId }));
    });

    it('keys the job on the asset and the policy that applies to it', async () => {
      // Two requests for the same asset under the same policy collapse; a
      // policy change is a new question and gets its own job.
      await service.requestScan(asset());

      expect(add.mock.calls[0][2]).toEqual(
        expect.objectContaining({ jobId: `${ASSET_ID}:1` }),
      );
    });

    it('asks BullMQ to retry with backoff rather than giving up at once', async () => {
      await service.requestScan(asset());

      expect(add.mock.calls[0][2]).toEqual(
        expect.objectContaining({
          attempts: 5,
          backoff: { type: 'exponential', delay: 1_000 },
          removeOnFail: false,
        }),
      );
    });
  });

  describe('the order it does things in', () => {
    it('moves the asset to scanning before it sends anything', async () => {
      // A second request then fails the state check rather than queueing a
      // duplicate, and an asset stuck in SCANNING becomes the visible
      // symptom of a queue that is not moving.
      await service.requestScan(asset());

      expect(markScanning.mock.invocationCallOrder[0]).toBeLessThan(
        add.mock.invocationCallOrder[0],
      );
    });

    it('answers with the asset as it now stands', async () => {
      const requested = await service.requestScan(asset());

      expect(requested.asset.state).toBe(FileAssetState.SCANNING);
      expect(requested.traceId).toEqual(expect.any(String));
    });

    it('puts the asset back when the queue will not take it', async () => {
      // An asset left in SCANNING with nothing scanning it is the one
      // outcome nobody would notice.
      add.mockImplementationOnce(() => Promise.reject(new Error('no redis')));

      await expect(service.requestScan(asset())).rejects.toThrow('no redis');
      expect(markRetryPending).toHaveBeenCalledWith(ASSET_ID);
    });
  });

  describe('assets it will not send', () => {
    it('accepts one waiting for its first scan', async () => {
      await expect(service.requestScan(asset())).resolves.toBeDefined();
    });

    it('accepts one waiting for another go', async () => {
      await expect(
        service.requestScan(asset({ state: FileAssetState.RETRY_PENDING })),
      ).resolves.toBeDefined();
    });

    it.each([
      FileAssetState.UNVERIFIED,
      FileAssetState.RECEIVING,
      FileAssetState.SCANNING,
      FileAssetState.CLEAN,
      FileAssetState.AVAILABLE,
      FileAssetState.REJECTED,
      FileAssetState.REVOKED,
      FileAssetState.DELETED,
    ])('refuses one in %s', async state => {
      await expect(
        service.requestScan(asset({ state })),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(add).not.toHaveBeenCalled();
      expect(markScanning).not.toHaveBeenCalled();
    });

    it.each([
      ['no object key', { objectKey: null }],
      ['no hash', { sha256: null }],
    ])('refuses one with %s', async (_description, changes) => {
      await expect(service.requestScan(asset(changes))).rejects.toThrow(
        'has no stored object to scan',
      );
    });

    it('refuses one that declares no content type', async () => {
      // The worker checks the claim against the bytes, so an asset with no
      // claim cannot be checked. Refusing here means the check never
      // quietly stops applying to a subset of the estate — ADR-0020.
      await expect(
        service.requestScan(asset({ declaredContentType: null })),
      ).rejects.toThrow('has no declared content type to check against');

      expect(add).not.toHaveBeenCalled();
      expect(markScanning).not.toHaveBeenCalled();
    });
  });
});
