import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { UserRole } from 'src/user/enums/user-role.enum';

import { ROLES_KEY } from './roles.decorator';

/**
 * Authorization guard that enforces the roles declared via {@link Roles}.
 *
 * It expects an authenticated user to already be present on the request (i.e.
 * it should run after {@link JwtAuthGuard}). When no roles are declared on the
 * handler the guard is a no-op and access is granted.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  /**
   * Creates an instance of RolesGuard.
   *
   * @param _reflector - Used to read role metadata from handlers/controllers.
   */
  constructor(private readonly _reflector: Reflector) {}

  /**
   * Determines whether the current request satisfies the required roles.
   *
   * @param context - The execution context.
   * @returns True when access is permitted.
   * @throws ForbiddenException when the user lacks a required role.
   */
  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this._reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const userRole: UserRole | undefined = request?.user?.role;

    if (!userRole || !requiredRoles.includes(userRole)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
