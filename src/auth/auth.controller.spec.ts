import { randomBytes } from 'node:crypto';

import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';

import { UserRefreshTokenService } from 'src/user-refresh-token/user-refresh-token.service';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;
  let refreshTokenService: UserRefreshTokenService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            register: jest.fn(),
            login: jest.fn(),
            verifyEmail: jest.fn(),
            resendVerificationEmail: jest.fn(),
            requestPasswordReset: jest.fn(),
            resetPassword: jest.fn(),
            refreshToken: jest.fn(),
            revokeToken: jest.fn(),
          },
        },
        {
          provide: UserRefreshTokenService,
          useValue: {
            revokeUserRefreshToken: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
    refreshTokenService = module.get<UserRefreshTokenService>(
      UserRefreshTokenService,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call authService.register', async () => {
    const dto = { email: 'test@test.com' } as any;
    await controller.register(dto);
    expect(authService.register).toHaveBeenCalledWith(dto);
  });

  it('should call authService.login', async () => {
    const dto = { email: 'test@test.com' } as any;
    await controller.login(dto);
    expect(authService.login).toHaveBeenCalledWith(dto);
  });

  it('should call refreshTokenService.revokeUserRefreshToken on logout', async () => {
    await controller.logout({ tokenId: '1' });
    expect(refreshTokenService.revokeUserRefreshToken).toHaveBeenCalledWith(
      '1',
    );
  });

  it('should call authService.verifyEmail', async () => {
    await controller.verifyEmail({ token: 't' });
    expect(authService.verifyEmail).toHaveBeenCalledWith('t');
  });

  it('should call authService.resendVerificationEmail', async () => {
    await controller.resendVerificationEmail({ token: 't' });
    expect(authService.resendVerificationEmail).toHaveBeenCalledWith('t');
  });

  it('should call authService.requestPasswordReset', async () => {
    await controller.requestPasswordReset({ email: 'e' });
    expect(authService.requestPasswordReset).toHaveBeenCalledWith('e');
  });

  it('should call authService.resetPassword', async () => {
    const password = randomBytes(16).toString('hex');
    await controller.resetPassword({ token: 't', password } as any);
    expect(authService.resetPassword).toHaveBeenCalledWith('t', password);
  });

  it('should call authService.refreshToken', async () => {
    await controller.refresh({ refresh_token: 't' });
    expect(authService.refreshToken).toHaveBeenCalledWith('t');
  });

  it('should call authService.revokeToken on revoke', async () => {
    const req = { user: { userId: '1', tokenId: '2' } };
    await controller.revoke('1', req as any);
    expect(authService.revokeToken).toHaveBeenCalledWith('1', '2');
  });

  it('should call authService.revokeToken with undefined tokenId if req.user missing', async () => {
    const req = {};
    await controller.revoke('1', req as any);
    expect(authService.revokeToken).toHaveBeenCalledWith('1', undefined);
  });
});
