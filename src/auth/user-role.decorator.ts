import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { UserRole } from 'src/user/enums/user-role.enum';

/**
 * Reads the site-wide role off an authenticated request.
 *
 * Distinct from {@link Roles}, which is a guard declaring "only these roles
 * may reach this handler at all". This is for the narrower case where the
 * route is open to everybody and the role only widens what the caller may do
 * to something already there — an administrator taking down artwork somebody
 * else put on an unregistered Fleet, for instance.
 *
 * Returns null rather than throwing on an anonymous request, so it can be
 * used behind {@link OptionalJwtAuthGuard} as well.
 *
 * @param _data - Unused decorator data.
 * @param ctx - The execution context.
 * @returns The caller's role, or null when there is no authenticated user.
 */
export const getCallerRoleFromContext = (
  _data: unknown,
  ctx: ExecutionContext,
): UserRole | null => {
  const request = ctx.switchToHttp().getRequest();

  return request?.user?.role ?? null;
};

export const CallerRole = createParamDecorator(getCallerRoleFromContext);
