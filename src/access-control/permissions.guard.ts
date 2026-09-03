import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AccessControlService } from './access-control.service';
import { PermissionCode } from './constants/permission-codes.constants';
import { REQUIRES_PERMISSION_KEY } from './requires-permission.decorator';

/** Minimal shape of the authenticated user attached to the request. */
interface RequestWithUser {
  user?: { id?: string; userId?: string };
}

/**
 * Authorisation guard that enforces the permissions declared via
 * {@link RequiresPermission}.
 *
 * It expects an authenticated user to already be present on the request, so it
 * must run after the authentication guard. When no permissions are declared the
 * guard is a no-op, matching the behaviour of the existing roles guard.
 *
 * Permissions are resolved from the database rather than from the token, so
 * withdrawing a permission takes effect on the user's next request instead of
 * when their access token expires.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  /**
   * Creates an instance of PermissionsGuard.
   *
   * @param _reflector - Used to read permission metadata from handlers/controllers.
   * @param _accessControlService - Resolves the caller's permissions.
   */
  constructor(
    private readonly _reflector: Reflector,
    private readonly _accessControlService: AccessControlService,
  ) {}

  /**
   * Determines whether the current request satisfies the required permissions.
   *
   * @param context - The execution context.
   * @returns True when access is permitted.
   * @throws ForbiddenException when the request is unauthenticated or the user
   *   lacks any required permission.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this._reflector.getAllAndOverride<
      PermissionCode[]
    >(REQUIRES_PERMISSION_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    // Same precedence as the UserId decorator, so the guard and the handler
    // can never disagree about which user is acting.
    const userId = request?.user?.id ?? request?.user?.userId;

    if (!userId) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const heldPermissions =
      await this._accessControlService.getPermissionCodes(userId);

    const hasAll = requiredPermissions.every(permission =>
      heldPermissions.has(permission),
    );

    if (!hasAll) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
