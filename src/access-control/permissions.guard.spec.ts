import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AccessControlService } from './access-control.service';
import { PERMISSION_CODES } from './constants/permission-codes.constants';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let accessControlService: { getPermissionCodes: jest.Mock };

  const userId = 'e6d3a1b2-0000-4000-8000-000000000001';

  /**
   * Builds an execution context carrying the supplied request user.
   *
   * @param user - The user to attach to the request.
   * @returns The stubbed execution context.
   */
  const createContext = (user?: Record<string, unknown>): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => undefined,
      getClass: () => undefined,
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    accessControlService = { getPermissionCodes: jest.fn() };
    guard = new PermissionsGuard(
      reflector as unknown as Reflector,
      accessControlService as unknown as AccessControlService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(guard).toBeDefined();
  });

  it('allows the request when no permissions are declared', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
    expect(accessControlService.getPermissionCodes).not.toHaveBeenCalled();
  });

  it('allows the request when an empty permission list is declared', async () => {
    reflector.getAllAndOverride.mockReturnValue([]);

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
  });

  it('rejects an unauthenticated request', async () => {
    reflector.getAllAndOverride.mockReturnValue([
      PERMISSION_CODES.STORYTIME_VIEW,
    ]);

    await expect(guard.canActivate(createContext())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows the request when every required permission is held', async () => {
    reflector.getAllAndOverride.mockReturnValue([
      PERMISSION_CODES.STORYTIME_VIEW,
      PERMISSION_CODES.STORYTIME_STORY_CREATE,
    ]);
    accessControlService.getPermissionCodes.mockResolvedValue(
      new Set([
        PERMISSION_CODES.STORYTIME_VIEW,
        PERMISSION_CODES.STORYTIME_STORY_CREATE,
      ]),
    );

    await expect(
      guard.canActivate(createContext({ id: userId })),
    ).resolves.toBe(true);
    expect(accessControlService.getPermissionCodes).toHaveBeenCalledWith(
      userId,
    );
  });

  it('rejects the request when only some required permissions are held', async () => {
    reflector.getAllAndOverride.mockReturnValue([
      PERMISSION_CODES.STORYTIME_VIEW,
      PERMISSION_CODES.STORYTIME_MODERATE,
    ]);
    accessControlService.getPermissionCodes.mockResolvedValue(
      new Set([PERMISSION_CODES.STORYTIME_VIEW]),
    );

    await expect(
      guard.canActivate(createContext({ id: userId })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('falls back to userId when the request user has no id', async () => {
    reflector.getAllAndOverride.mockReturnValue([
      PERMISSION_CODES.STORYTIME_VIEW,
    ]);
    accessControlService.getPermissionCodes.mockResolvedValue(
      new Set([PERMISSION_CODES.STORYTIME_VIEW]),
    );

    await expect(guard.canActivate(createContext({ userId }))).resolves.toBe(
      true,
    );
    expect(accessControlService.getPermissionCodes).toHaveBeenCalledWith(
      userId,
    );
  });
});
