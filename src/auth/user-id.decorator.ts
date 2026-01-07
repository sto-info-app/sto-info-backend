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
