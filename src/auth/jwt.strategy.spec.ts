import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';
import * as jwt from 'jsonwebtoken';

import { CurrentContextHelper } from 'src/shared/context/current-context.helper';
import { SecretsService } from 'src/shared/secrets/secrets.service';

import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let authService: AuthService;
  let configService: ConfigService;
  let secretsService: SecretsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: AuthService,
          useValue: {
            validateUserFromPayload: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('dummy-secret-name'),
          },
        },
        {
          provide: SecretsService,
          useValue: {
            getSecret: jest
              .fn<(...args: any[]) => Promise<any>>()
              .mockResolvedValue({ jwtSecret: 'dummy-secret' }),
          },
        },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
    authService = module.get<AuthService>(AuthService);
    configService = module.get<ConfigService>(ConfigService);
    secretsService = module.get<SecretsService>(SecretsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  it.each([
    ['access', 'access', 'dummy-secret', 300, true],
    ['refresh', 'refresh', 'dummy-secret', 300, false],
    ['legacy refresh', undefined, 'dummy-secret', 300, false],
    ['wrong signature', 'access', 'wrong-secret', 300, false],
    ['expired', 'access', 'dummy-secret', -120, false],
  ] as const)(
    'authenticates signed %s tokens correctly',
    async (_name, tokenUse, secret, expiresIn, accepted) => {
      (
        authService.validateUserFromPayload as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({ id: 'user-uuid' });
      const token = jwt.sign(
        { sub: 'user-uuid', email: 'test@example.com', tokenUse },
        secret,
        { expiresIn, jwtid: 'test-session' },
      );
      // Exercise Passport's signature/expiry verification and our validation hook.
      const result = await new Promise<boolean>((resolve, reject) => {
        const passportStrategy = strategy as any;
        passportStrategy.success = () => resolve(true);
        passportStrategy.fail = () => resolve(false);
        passportStrategy.error = (error: Error) => {
          if (error instanceof UnauthorizedException) resolve(false);
          else reject(error);
        };
        passportStrategy.authenticate({
          headers: { authorization: 'Bearer ' + token },
        });
      });
      expect(result).toBe(accepted);
      if (!accepted)
        expect(authService.validateUserFromPayload).not.toHaveBeenCalled();
    },
  );

  describe('secretOrKeyProvider', () => {
    it('should call done with secret on success', async () => {
      const done = jest.fn();
      // In passport-jwt, it's stored on the instance as _secretOrKeyProvider
      const secretOrKeyProvider = (strategy as any)._secretOrKeyProvider;

      expect(typeof secretOrKeyProvider).toBe('function');

      await new Promise<void>(resolve => {
        secretOrKeyProvider(null, null, (...args: unknown[]) => {
          done(...args);
          resolve();
        });
      });

      expect(configService.get).toHaveBeenCalledWith('AWS_SECRET_NAME');
      expect(secretsService.getSecret).toHaveBeenCalledWith(
        'dummy-secret-name',
      );
      expect(done).toHaveBeenCalledWith(null, 'dummy-secret');
    });

    it('should call done with error on failure', async () => {
      const done = jest.fn();
      const error = new Error('Secret not found');
      (
        secretsService.getSecret as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockRejectedValue(error);
      const secretOrKeyProvider = (strategy as any)._secretOrKeyProvider;

      expect(typeof secretOrKeyProvider).toBe('function');

      await new Promise<void>(resolve => {
        secretOrKeyProvider(null, null, (...args: unknown[]) => {
          done(...args);
          resolve();
        });
      });

      expect(done).toHaveBeenCalledWith(error);
    });
  });

  describe('validate', () => {
    it.each(['refresh', undefined, 'unknown'])(
      'rejects token purpose %s before looking up the user',
      async tokenUse => {
        await expect(
          strategy.validate({
            sub: 'user-uuid',
            email: 'test@example.com',
            tokenUse,
          } as any),
        ).rejects.toThrow(UnauthorizedException);
        expect(authService.validateUserFromPayload).not.toHaveBeenCalled();
      },
    );
    it('should return plain user object when validation succeeds', async () => {
      const payload = {
        tokenUse: 'access',
        sub: 'user-uuid',
        email: 'test@example.com',
      };
      const user = { id: 'user-uuid', email: 'test@example.com' };
      (
        authService.validateUserFromPayload as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(user);

      const result = await strategy.validate(payload as any);

      expect(result).toEqual(user);
    });

    it('should throw UnauthorizedException when user not found', async () => {
      (
        authService.validateUserFromPayload as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(null);
      const payload = {
        tokenUse: 'access',
        sub: 'user-uuid',
        email: 'test@example.com',
      };

      await expect(strategy.validate(payload as any)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should set CurrentContextHelper.userUuid if not already set', async () => {
      const payload = {
        tokenUse: 'access',
        sub: 'new-uuid',
        email: 'test@example.com',
      };
      const user = { id: 'new-uuid', email: 'test@example.com' };
      (
        authService.validateUserFromPayload as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(user);

      const spySet = jest.spyOn(CurrentContextHelper, 'userUuid', 'set');
      const spyGet = jest
        .spyOn(CurrentContextHelper, 'userUuid', 'get')
        .mockReturnValue(null);

      await strategy.validate(payload as any);

      expect(spySet).toHaveBeenCalledWith('new-uuid');

      spySet.mockRestore();
      spyGet.mockRestore();
    });

    it('should NOT set CurrentContextHelper.userUuid if already set', async () => {
      const payload = {
        tokenUse: 'access',
        sub: 'new-uuid',
        email: 'test@example.com',
      };
      const user = { id: 'new-uuid', email: 'test@example.com' };
      (
        authService.validateUserFromPayload as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(user);

      const spySet = jest.spyOn(CurrentContextHelper, 'userUuid', 'set');
      const spyGet = jest
        .spyOn(CurrentContextHelper, 'userUuid', 'get')
        .mockReturnValue('already-set');

      await strategy.validate(payload as any);

      expect(spySet).not.toHaveBeenCalled();

      spySet.mockRestore();
      spyGet.mockRestore();
    });
  });
});
