import { BadRequestException, ExecutionContext } from '@nestjs/common';

import {
  getOptionalUserIdFromContext,
  getUserIdFromContext,
  OptionalUserId,
  UserId,
} from './user-id.decorator';

const contextWithRequest = (request: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  }) as unknown as ExecutionContext;

describe('UserId Decorator', () => {
  it('should be defined', () => {
    expect(UserId).toBeDefined();
  });

  it('should return userId from req.user.id', () => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 'user-123' },
        }),
      }),
    } as unknown as ExecutionContext;

    const result = getUserIdFromContext(null, mockContext);
    expect(result).toBe('user-123');
  });

  it('should return userId from req.user.userId', () => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { userId: 'user-456' },
        }),
      }),
    } as unknown as ExecutionContext;

    const result = getUserIdFromContext(null, mockContext);
    expect(result).toBe('user-456');
  });

  it('should throw BadRequestException if userId is missing', () => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: {},
        }),
      }),
    } as unknown as ExecutionContext;

    expect(() => getUserIdFromContext(null, mockContext)).toThrow(
      BadRequestException,
    );
  });

  it('should throw BadRequestException if req is missing', () => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => null,
      }),
    } as unknown as ExecutionContext;

    expect(() => getUserIdFromContext(null, mockContext)).toThrow(
      BadRequestException,
    );
  });

  it('should throw BadRequestException if user is null', () => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({ user: null }),
      }),
    } as unknown as ExecutionContext;

    expect(() => getUserIdFromContext(null, mockContext)).toThrow(
      BadRequestException,
    );
  });
});

describe('OptionalUserId Decorator', () => {
  it('should be defined', () => {
    expect(OptionalUserId).toBeDefined();
  });

  it('should return userId from req.user.id', () => {
    const result = getOptionalUserIdFromContext(
      null,
      contextWithRequest({ user: { id: 'user-123' } }),
    );
    expect(result).toBe('user-123');
  });

  it('should return userId from req.user.userId', () => {
    const result = getOptionalUserIdFromContext(
      null,
      contextWithRequest({ user: { userId: 'user-456' } }),
    );
    expect(result).toBe('user-456');
  });

  it('should return null when the user is missing', () => {
    const result = getOptionalUserIdFromContext(
      null,
      contextWithRequest({ user: {} }),
    );
    expect(result).toBeNull();
  });

  it('should return null when the request is missing', () => {
    const result = getOptionalUserIdFromContext(null, contextWithRequest(null));
    expect(result).toBeNull();
  });
});
