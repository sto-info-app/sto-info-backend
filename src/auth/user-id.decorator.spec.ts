import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { getUserIdFromContext } from './user-id.decorator';

describe('UserId Decorator', () => {
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
