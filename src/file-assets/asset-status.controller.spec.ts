import { NotFoundException } from '@nestjs/common';

import { jest } from '@jest/globals';

import { AssetStatusController } from './asset-status.controller';
import { AssetStatusService } from './services/asset-status.service';

describe('AssetStatusController', () => {
  let report: jest.Mock<(...args: any[]) => Promise<any>>;
  let controller: AssetStatusController;

  beforeEach(() => {
    report = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue({ assetId: 'asset-1', status: 'SCANNING' });

    controller = new AssetStatusController({
      report,
    } as unknown as AssetStatusService);
  });

  it('reports how far along the caller’s upload is', async () => {
    await expect(controller.status('asset-1', 'user-1')).resolves.toEqual({
      assetId: 'asset-1',
      status: 'SCANNING',
    });

    expect(report).toHaveBeenCalledWith('asset-1', 'user-1');
  });

  it('passes a refusal through unchanged', async () => {
    report.mockRejectedValue(new NotFoundException('No such upload'));

    await expect(controller.status('asset-1', 'user-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
