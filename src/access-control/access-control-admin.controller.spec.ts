import { Test, TestingModule } from '@nestjs/testing';

import { UserRole } from '../user/enums/user-role.enum';
import { AccessControlAdminController } from './access-control-admin.controller';
import { AccessControlAdminService } from './access-control-admin.service';
import { PERMISSION_CODES } from './constants/permission-codes.constants';
import { PermissionEffect } from './enums/permission-effect.enum';

describe('AccessControlAdminController', () => {
  let controller: AccessControlAdminController;
  let adminService: {
    listPermissions: jest.Mock;
    getUserAccessSummary: jest.Mock;
    setPermissionOverride: jest.Mock;
    removePermissionOverride: jest.Mock;
    setUserRole: jest.Mock;
    listLimitOverrides: jest.Mock;
    setLimitOverride: jest.Mock;
    removeLimitOverride: jest.Mock;
  };

  const userId = 'e6d3a1b2-0000-4000-8000-000000000001';
  const adminId = 'e6d3a1b2-0000-4000-8000-0000000000ad';

  beforeEach(async () => {
    adminService = {
      listPermissions: jest.fn().mockResolvedValue([]),
      getUserAccessSummary: jest.fn().mockResolvedValue({ userId }),
      setPermissionOverride: jest.fn().mockResolvedValue({ userId }),
      removePermissionOverride: jest.fn().mockResolvedValue({ userId }),
      setUserRole: jest.fn().mockResolvedValue({ userId }),
      listLimitOverrides: jest.fn().mockResolvedValue([]),
      setLimitOverride: jest.fn().mockResolvedValue(undefined),
      removeLimitOverride: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccessControlAdminController],
      providers: [
        { provide: AccessControlAdminService, useValue: adminService },
      ],
    }).compile();

    controller = module.get<AccessControlAdminController>(
      AccessControlAdminController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('lists permissions', async () => {
    await expect(controller.listPermissions()).resolves.toEqual([]);
    expect(adminService.listPermissions).toHaveBeenCalled();
  });

  it('reports a user access summary', async () => {
    await expect(controller.getUserAccessSummary(userId)).resolves.toEqual({
      userId,
    });
    expect(adminService.getUserAccessSummary).toHaveBeenCalledWith(userId);
  });

  it('applies a permission override on behalf of the acting administrator', async () => {
    const dto = {
      permissionCode: PERMISSION_CODES.STORYTIME_STORY_CREATE,
      effect: PermissionEffect.DENY,
      reason: 'Repeated policy breaches',
    };

    await controller.setPermissionOverride(userId, dto, adminId);

    expect(adminService.setPermissionOverride).toHaveBeenCalledWith(
      userId,
      dto,
      adminId,
    );
  });

  it('withdraws a permission override', async () => {
    await controller.removePermissionOverride(
      userId,
      PERMISSION_CODES.STORYTIME_STORY_CREATE,
      adminId,
    );

    expect(adminService.removePermissionOverride).toHaveBeenCalledWith(
      userId,
      PERMISSION_CODES.STORYTIME_STORY_CREATE,
      adminId,
    );
  });

  it("sets a member's role on behalf of the acting administrator", async () => {
    const dto = { role: UserRole.STORYTIME_CURATOR };

    await controller.setUserRole(userId, dto, adminId);

    expect(adminService.setUserRole).toHaveBeenCalledWith(userId, dto, adminId);
  });

  it('lists limit exemptions', async () => {
    await expect(controller.listLimitOverrides(userId)).resolves.toEqual([]);
    expect(adminService.listLimitOverrides).toHaveBeenCalledWith(userId);
  });

  it('applies a limit exemption', async () => {
    const dto = {
      limitKey: 'STORYTIME_MAX_STORIES_PER_USER',
      limitValue: 500,
      reason: 'Prolific creator',
    };

    await controller.setLimitOverride(userId, dto, adminId);

    expect(adminService.setLimitOverride).toHaveBeenCalledWith(
      userId,
      dto,
      adminId,
    );
  });

  it('withdraws a limit exemption', async () => {
    await controller.removeLimitOverride(
      userId,
      'STORYTIME_MAX_STORIES_PER_USER',
      adminId,
    );

    expect(adminService.removeLimitOverride).toHaveBeenCalledWith(
      userId,
      'STORYTIME_MAX_STORIES_PER_USER',
      adminId,
    );
  });
});
