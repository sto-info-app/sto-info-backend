import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { jest } from '@jest/globals';

import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    it('should return true when super.canActivate returns true', async () => {
      const context = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue({}),
        }),
      } as unknown as ExecutionContext;

      // Mock super.canActivate
      // AuthGuard('jwt') returns a class, JwtAuthGuard extends it.
      const superCanActivateSpy = jest
        .spyOn(AuthGuard('jwt').prototype, 'canActivate')
        .mockResolvedValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(superCanActivateSpy).toHaveBeenCalledWith(context);
      expect(context.switchToHttp).toHaveBeenCalled();

      superCanActivateSpy.mockRestore();
    });

    it('should throw UnauthorizedException when super.canActivate returns false', async () => {
      const context = {} as ExecutionContext;

      const superCanActivateSpy = jest
        .spyOn(AuthGuard('jwt').prototype, 'canActivate')
        .mockResolvedValue(false);

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );

      superCanActivateSpy.mockRestore();
    });

    it('should throw UnauthorizedException when super.canActivate throws', async () => {
      const context = {} as ExecutionContext;

      const superCanActivateSpy = jest
        .spyOn(AuthGuard('jwt').prototype, 'canActivate')
        .mockRejectedValue(new Error('Auth failed'));

      await expect(guard.canActivate(context)).rejects.toThrow('Auth failed');

      superCanActivateSpy.mockRestore();
    });
  });
});
