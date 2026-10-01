import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ROLES_KEY } from 'src/auth/roles.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';

import { ScanDiagnosticsDto } from './dto/scan-diagnostics.dto';
import { ScanDiagnosticsController } from './scan-diagnostics.controller';
import { ScanDiagnosticsService } from './services/scan-diagnostics.service';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

describe('ScanDiagnosticsController', () => {
  const diagnostics = {
    generatedAt: new Date('2026-09-26T12:00:00.000Z'),
    usage: null,
    engine: null,
    queue: null,
    awaiting: { quarantined: 0, scanning: 0, retryPending: 0 },
  } as ScanDiagnosticsDto;

  let read: jest.Mock<(adminUserId: string) => Promise<ScanDiagnosticsDto>>;
  let rejections: jest.Mock<
    (page: number, adminUserId: string) => Promise<unknown>
  >;
  let asset: jest.Mock<
    (assetId: string, adminUserId: string) => Promise<unknown>
  >;
  let controller: ScanDiagnosticsController;

  beforeEach(() => {
    read = jest.fn(() => Promise.resolve(diagnostics));
    rejections = jest.fn(() => Promise.resolve('page'));
    asset = jest.fn(() => Promise.resolve('detail'));
    controller = new ScanDiagnosticsController({
      read,
      rejections,
      asset,
    } as unknown as ScanDiagnosticsService);
  });

  // FC-039.
  it.each([
    [undefined, 1],
    [0, 1],
    [3, 3],
  ])('reads page %s of refused assets as page %s', async (page, asked) => {
    await expect(controller.rejections(ADMIN_ID, page)).resolves.toBe('page');
    expect(rejections).toHaveBeenCalledWith(asked, ADMIN_ID);
  });

  it('reads one asset’s outcome', async () => {
    await expect(controller.asset('asset-1', ADMIN_ID)).resolves.toBe('detail');
    expect(asset).toHaveBeenCalledWith('asset-1', ADMIN_ID);
  });

  it('answers with what the service read', async () => {
    await expect(controller.read(ADMIN_ID)).resolves.toBe(diagnostics);
    expect(read).toHaveBeenCalledWith(ADMIN_ID);
  });

  it('is for administrators only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ScanDiagnosticsController)).toEqual([
      UserRole.ADMIN,
    ]);
  });
});
