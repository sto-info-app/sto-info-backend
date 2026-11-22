import { NotFoundException } from '@nestjs/common';

import { jest } from '@jest/globals';

import { FileAssetEntity } from '../entities/file-asset.entity';
import { FileAssetState } from '../enums/file-asset-state.enum';
import { AssetStatusService } from './asset-status.service';
import { FileAssetService } from './file-asset.service';

describe('AssetStatusService', () => {
  const viewerId = 'user-1';

  let findById: jest.Mock<(...args: any[]) => Promise<any>>;
  let service: AssetStatusService;

  /**
   * Arranges an asset in one state, owned by somebody.
   *
   * @param state - The registry state.
   * @param ownerUserId - Who uploaded it.
   */
  const arrange = (state: FileAssetState, ownerUserId = viewerId): void => {
    findById.mockResolvedValue({
      id: 'asset-1',
      state,
      ownerUserId,
    } as FileAssetEntity);
  };

  beforeEach(() => {
    findById = jest.fn<(...args: any[]) => Promise<any>>();
    service = new AssetStatusService({
      findById,
    } as unknown as FileAssetService);
  });

  it.each([
    [FileAssetState.RECEIVING, 'UPLOADING'],
    [FileAssetState.QUARANTINED, 'AWAITING_SCAN'],
    [FileAssetState.RETRY_PENDING, 'AWAITING_SCAN'],
    [FileAssetState.SCANNING, 'SCANNING'],
    // Scanned and not published yet. Of the five words a reader has, this
    // is the one that means "still working, nothing is wrong".
    [FileAssetState.CLEAN, 'SCANNING'],
    [FileAssetState.AVAILABLE, 'AVAILABLE'],
    [FileAssetState.UNVERIFIED, 'AVAILABLE'],
    [FileAssetState.REJECTED, 'REJECTED'],
    [FileAssetState.REVOKED, 'REJECTED'],
    [FileAssetState.DELETED, 'REJECTED'],
  ])('reports %s as %s', async (state, expected) => {
    arrange(state);

    await expect(service.report('asset-1', viewerId)).resolves.toEqual({
      assetId: 'asset-1',
      status: expected,
    });
  });

  // ADR-0016 decision 5: one refusal for an asset that does not exist, one
  // that was refused, and one the reader may not see.
  it('refuses an upload that is not the caller’s, as absent', async () => {
    arrange(FileAssetState.SCANNING, 'somebody-else');

    await expect(service.report('asset-1', viewerId)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('refuses an upload that does not exist, in the same words', async () => {
    findById.mockResolvedValue(null);

    await expect(service.report('asset-1', viewerId)).rejects.toThrow(
      'No such upload',
    );
  });

  // The fourth acceptance criterion is met by the shape of the answer
  // rather than by remembering to strip fields from it.
  it('discloses nothing but the asset and one word', async () => {
    findById.mockResolvedValue({
      id: 'asset-1',
      state: FileAssetState.REJECTED,
      ownerUserId: viewerId,
      rejectionCode: 'INFECTED',
      scanSignatureVersion: '28129',
      objectKey: 'test/assets/asset-1',
    } as FileAssetEntity);

    const report = await service.report('asset-1', viewerId);

    expect(Object.keys(report)).toEqual(['assetId', 'status']);
  });
});
