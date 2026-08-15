import { Test, TestingModule } from '@nestjs/testing';
import { AccessControlController } from './access-control.controller';
import { AccessControlService } from './access-control.service';
import { PERMISSION_CODES } from './constants/permission-codes.constants';

describe('AccessControlController', () => {
  let controller: AccessControlController;
  let accessControlService: { getPermissionCodes: jest.Mock };

  const userId = 'e6d3a1b2-0000-4000-8000-000000000001';

  beforeEach(async () => {
    accessControlService = {
      getPermissionCodes: jest.fn().mockResolvedValue(new Set<string>()),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccessControlController],
      providers: [
        { provide: AccessControlService, useValue: accessControlService },
      ],
    }).compile();

    controller = module.get<AccessControlController>(AccessControlController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('returns the caller permissions in a stable order', async () => {
    accessControlService.getPermissionCodes.mockResolvedValue(
      new Set([
        PERMISSION_CODES.STORYTIME_VIEW,
        PERMISSION_CODES.STORYTIME_ARC_CREATE,
      ]),
    );

    await expect(controller.getMyPermissions(userId)).resolves.toEqual({
      permissions: [
        PERMISSION_CODES.STORYTIME_ARC_CREATE,
        PERMISSION_CODES.STORYTIME_VIEW,
      ],
    });
  });

  it('resolves permissions for the authenticated caller only', async () => {
    await controller.getMyPermissions(userId);

    expect(accessControlService.getPermissionCodes).toHaveBeenCalledWith(
      userId,
    );
  });

  it('returns an empty list when the caller holds nothing', async () => {
    await expect(controller.getMyPermissions(userId)).resolves.toEqual({
      permissions: [],
    });
  });
});
