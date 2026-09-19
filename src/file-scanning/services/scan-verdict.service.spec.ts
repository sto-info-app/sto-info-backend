import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetKind } from 'src/file-assets/enums/file-asset-kind.enum';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { FileAssetService } from 'src/file-assets/services/file-asset.service';

import { ScanVerdictMessage } from '../contract/file-scan-contract';
import { ScanVerdictService } from './scan-verdict.service';

const ASSET_ID = '4f1a0e2c-8b3d-4a59-9c21-6f7e5d4c3b2a';
const OBJECT_KEY = `local/assets/${ASSET_ID}`;
const SHA = 'a'.repeat(64);

/**
 * Builds an asset that is waiting for a verdict.
 *
 * @param changes - Fields to override.
 * @returns The asset.
 */
function asset(changes: Partial<FileAssetEntity> = {}): FileAssetEntity {
  return {
    id: ASSET_ID,
    kind: FileAssetKind.ROSTER_IMPORT_SOURCE,
    state: FileAssetState.SCANNING,
    objectKey: OBJECT_KEY,
    objectVersion: null,
    sha256: SHA,
    policyVersion: 1,
    ...changes,
  } as FileAssetEntity;
}

/**
 * Builds a verdict about that asset.
 *
 * @param changes - Fields to override.
 * @returns The verdict.
 */
function verdict(
  changes: Partial<ScanVerdictMessage> = {},
): ScanVerdictMessage {
  return {
    schemaVersion: 1,
    assetId: ASSET_ID,
    attemptId: '7c9e1b2d-3a4f-4e5b-9c8d-1a2b3c4d5e6f',
    objectKey: OBJECT_KEY,
    objectVersion: null,
    expectedSha256: SHA,
    observedSha256: SHA,
    policyVersion: 1,
    definitionEpoch: '27412',
    outcome: 'CLEAN',
    rejectionCode: null,
    engine: 'clamav',
    engineVersion: '1.4.2',
    signatureVersion: '27412',
    scannedAt: '2026-09-19T12:00:00.000Z',
    traceId: '0b5d4f6a-1c2e-4d3b-8a7f-9e8d7c6b5a40',
    ...changes,
  };
}

describe('ScanVerdictService', () => {
  let findById: jest.Mock;
  let recordCleanVerdict: jest.Mock;
  let reject: jest.Mock;
  let markRetryPending: jest.Mock;
  let publish: jest.Mock;
  let service: ScanVerdictService;

  beforeEach(() => {
    findById = jest.fn(() => Promise.resolve(asset()));
    recordCleanVerdict = jest.fn(() => Promise.resolve(asset()));
    reject = jest.fn(() => Promise.resolve(asset()));
    markRetryPending = jest.fn(() => Promise.resolve(asset()));
    publish = jest.fn(() => Promise.resolve(asset()));

    service = new ScanVerdictService({
      findById,
      recordCleanVerdict,
      reject,
      markRetryPending,
      publish,
    } as unknown as FileAssetService);
  });

  describe('a clean verdict', () => {
    it('records it', async () => {
      await expect(service.apply(verdict())).resolves.toEqual({
        applied: true,
        refusal: null,
      });

      expect(recordCleanVerdict).toHaveBeenCalledWith(ASSET_ID, {
        engine: 'clamav',
        engineVersion: '1.4.2',
        signatureVersion: '27412',
        policyVersion: 1,
      });
    });

    it('does not publish anything', async () => {
      // The best a clean verdict achieves is CLEAN, which is not serveable.
      // Publication needs an allowed type, successful processing and an
      // audience, and a scanner knows none of those — ADR-0015 decision 3.
      await service.apply(verdict());

      expect(publish).not.toHaveBeenCalled();
    });

    it('refuses one whose observed hash is not the hash on the row', async () => {
      // The third check of the same thing, in the one place where being
      // wrong would mean publishing bytes nobody cleared.
      await expect(
        service.apply(verdict({ observedSha256: 'b'.repeat(64) })),
      ).resolves.toEqual({ applied: false, refusal: 'UNMEASURED_CLEAN' });

      expect(recordCleanVerdict).not.toHaveBeenCalled();
    });
  });

  describe('a refusal', () => {
    it('rejects the asset with the code the worker gave', async () => {
      await expect(
        service.apply(
          verdict({
            outcome: 'REJECTED',
            rejectionCode: 'INFECTED',
            observedSha256: SHA,
          }),
        ),
      ).resolves.toEqual({ applied: true, refusal: null });

      expect(reject).toHaveBeenCalledWith(
        ASSET_ID,
        'INFECTED',
        expect.objectContaining({ engine: 'clamav' }),
      );
    });

    it('does not check the hash first, because nothing is being published', async () => {
      await service.apply(
        verdict({
          outcome: 'REJECTED',
          rejectionCode: 'HASH_MISMATCH',
          observedSha256: 'b'.repeat(64),
        }),
      );

      expect(reject).toHaveBeenCalled();
    });
  });

  describe('a scanner that did not answer', () => {
    it('leaves the asset waiting for another go', async () => {
      await expect(
        service.apply(verdict({ outcome: 'RETRY', observedSha256: null })),
      ).resolves.toEqual({ applied: true, refusal: null });

      expect(markRetryPending).toHaveBeenCalledWith(ASSET_ID);
    });
  });

  describe('verdicts it will not act on', () => {
    it('ignores one about an asset that is gone', async () => {
      findById.mockImplementationOnce(() => Promise.resolve(null));

      await expect(service.apply(verdict())).resolves.toEqual({
        applied: false,
        refusal: 'NO_SUCH_ASSET',
      });
    });

    it.each([
      ['a different object key', { objectKey: 'local/assets/other' }],
      ['a different object version', { objectVersion: 'v7' }],
      ['a different hash', { expectedSha256: 'c'.repeat(64) }],
    ])('ignores one about %s', async (_description, changes) => {
      // ADR-0006 required publication to be performed "with a hash
      // recheck". This is it: the asset was replaced while the scanner was
      // working, and the answer belongs to a file that no longer exists.
      await expect(service.apply(verdict(changes))).resolves.toEqual({
        applied: false,
        refusal: 'NOT_THESE_BYTES',
      });

      expect(recordCleanVerdict).not.toHaveBeenCalled();
    });

    it.each([
      FileAssetState.QUARANTINED,
      FileAssetState.CLEAN,
      FileAssetState.AVAILABLE,
      FileAssetState.REJECTED,
      FileAssetState.RETRY_PENDING,
      FileAssetState.REVOKED,
      FileAssetState.DELETED,
    ])('ignores one about an asset in %s', async state => {
      findById.mockImplementationOnce(() => Promise.resolve(asset({ state })));

      await expect(service.apply(verdict())).resolves.toEqual({
        applied: false,
        refusal: 'NOT_SCANNING',
      });
    });

    it('applies the first of two identical deliveries and ignores the second', async () => {
      // What makes at-least-once delivery safe without a deduplication
      // table: the state machine has already moved, so the repeat finds an
      // asset that is no longer waiting.
      findById
        .mockImplementationOnce(() => Promise.resolve(asset()))
        .mockImplementationOnce(() =>
          Promise.resolve(asset({ state: FileAssetState.CLEAN })),
        );

      const first = await service.apply(verdict());
      const second = await service.apply(verdict());

      expect(first.applied).toBe(true);
      expect(second).toEqual({ applied: false, refusal: 'NOT_SCANNING' });
      expect(recordCleanVerdict).toHaveBeenCalledTimes(1);
    });
  });
});
