import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ROLES_KEY } from 'src/auth/roles.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';

import { ScanDiagnosticsDto } from './dto/scan-diagnostics.dto';
import { ScanDiagnosticsController } from './scan-diagnostics.controller';
import { ScanDiagnosticsService } from './services/scan-diagnostics.service';

describe('ScanDiagnosticsController', () => {
  const diagnostics = {
    generatedAt: new Date('2026-09-26T12:00:00.000Z'),
    usage: null,
    engine: null,
    queue: null,
    awaiting: { quarantined: 0, scanning: 0, retryPending: 0 },
  } as ScanDiagnosticsDto;

  let read: jest.Mock<() => Promise<ScanDiagnosticsDto>>;
  let controller: ScanDiagnosticsController;

  beforeEach(() => {
    read = jest.fn(() => Promise.resolve(diagnostics));
    controller = new ScanDiagnosticsController({
      read,
    } as unknown as ScanDiagnosticsService);
  });

  it('answers with what the service read', async () => {
    await expect(controller.read()).resolves.toBe(diagnostics);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('is for administrators only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ScanDiagnosticsController)).toEqual([
      UserRole.ADMIN,
    ]);
  });
});
