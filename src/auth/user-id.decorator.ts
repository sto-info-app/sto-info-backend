import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';

export const getUserIdFromContext = (
  _data: unknown,
  ctx: ExecutionContext,
): string => {
  const req = ctx.switchToHttp().getRequest();
  const userId = req?.user?.id ?? req?.user?.userId;

  if (!userId) {
    throw new BadRequestException('User not found');
  }

  return userId;
};

export const UserId = createParamDecorator(getUserIdFromContext);

/**
 * Resolves the authenticated user's ID, or `null` when the request is
 * anonymous.
 *
 * Pair with {@link OptionalJwtAuthGuard} on endpoints that serve public data
 * but enrich it for logged-in callers. Unlike {@link UserId}, a missing user
 * does not throw.
 *
 * @param _data - Unused decorator data.
 * @param ctx - The execution context.
 * @returns The user ID, or `null` when none is present.
 */
export const getOptionalUserIdFromContext = (
  _data: unknown,
  ctx: ExecutionContext,
): string | null => {
  const req = ctx.switchToHttp().getRequest();
  return req?.user?.id ?? req?.user?.userId ?? null;
};

export const OptionalUserId = createParamDecorator(
  getOptionalUserIdFromContext,
);
