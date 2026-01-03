import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { NextFunction, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { CurrentContextHelper } from 'src/shared/context/current-context.helper';
import { SecretsService } from 'src/shared/secrets/secrets.service';

import { UserIdMiddleware } from './user-id.middleware';

jest.mock('jsonwebtoken');

describe('UserIdMiddleware', () => {
  let middleware: UserIdMiddleware;
  let secretsService: SecretsService;
  let loggerErrorSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserIdMiddleware,
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
              .fn()
              .mockResolvedValue({ jwtSecret: 'dummy-secret' }),
          },
        },
      ],
    }).compile();

    middleware = module.get<UserIdMiddleware>(UserIdMiddleware);
    secretsService = module.get<SecretsService>(SecretsService);

    loggerErrorSpy = jest
      .spyOn(Logger, 'error')
      .mockImplementation(() => undefined);
    loggerWarnSpy = jest
      .spyOn(Logger, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
    loggerErrorSpy.mockRestore();
    loggerWarnSpy.mockRestore();
  });

  it('should be defined', () => {
    expect(middleware).toBeDefined();
  });

  describe('use', () => {
    type RequestStub = {
      headers?: {
        authorization?: string;
      };
      ip?: string;
      userUuid?: string;
      user?: { id?: string };
    };

    type ResponseStub = Partial<Response>;

    let req: RequestStub;
    let res: Response;
    let next: NextFunction;

    beforeEach(() => {
      req = {
        headers: {},
        ip: '127.0.0.1',
      };
      res = {} as ResponseStub as Response;
      next = jest.fn();
    });

    it('should set IP in CurrentContextHelper', async () => {
      const spy = jest.spyOn(CurrentContextHelper, 'ip', 'set');
      await middleware.use(req as unknown as Request, res, next);
      expect(spy).toHaveBeenCalledWith('127.0.0.1');
      spy.mockRestore();
    });

    it('should not try to extract token if userUuid is already set', async () => {
      const spyGet = jest
        .spyOn(CurrentContextHelper, 'userUuid', 'get')
        .mockReturnValue('existing-uuid');

      const extractTokenSpy = jest.spyOn(
        middleware as unknown as { extractToken: (req: RequestStub) => string },
        'extractToken',
      );

      await middleware.use(req as unknown as Request, res, next);

      expect(extractTokenSpy).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
      spyGet.mockRestore();
    });

    it('should extract and verify token if userUuid is NOT set', async () => {
      const spyGet = jest
        .spyOn(CurrentContextHelper, 'userUuid', 'get')
        .mockReturnValue(null);
      req.headers.authorization = 'Bearer valid-token';
      (jwt.verify as jest.Mock).mockReturnValue({ sub: 'user-uuid' });
      const spySet = jest.spyOn(CurrentContextHelper, 'userUuid', 'set');

      await middleware.use(req as unknown as Request, res, next);

      expect(jwt.verify).toHaveBeenCalledWith('valid-token', 'dummy-secret');
      expect(spySet).toHaveBeenCalledWith('user-uuid');
      expect(req.userUuid).toBe('user-uuid');
      expect(next).toHaveBeenCalled();

      spyGet.mockRestore();
      spySet.mockRestore();
    });

    it('should set IP to null if req.ip is missing', async () => {
      req.ip = undefined;
      const spy = jest.spyOn(CurrentContextHelper, 'ip', 'set');
      await middleware.use(req as unknown as Request, res, next);
      expect(spy).toHaveBeenCalledWith(null);
      spy.mockRestore();
    });

    describe('extractToken branches', () => {
      it.each([
        ['missing headers', { headers: undefined }],
        ['missing authorization', { headers: {} }],
        ['non-bearer token', { headers: { authorization: 'Basic data' } }],
        ['bearer with empty token', { headers: { authorization: 'Bearer ' } }],
      ])(
        'should return null for %s',
        async (_name, reqMock: Partial<RequestStub>) => {
          const spyGet = jest
            .spyOn(CurrentContextHelper, 'userUuid', 'get')
            .mockReturnValue(null);

          await middleware.use(
            { ...req, ...reqMock } as unknown as Request,
            res,
            next,
          );

          expect(jwt.verify).not.toHaveBeenCalled();
          expect(next).toHaveBeenCalled();
          spyGet.mockRestore();
        },
      );
    });

    it('should log error if jwtSecret is missing from secretObject', async () => {
      const spyGet = jest
        .spyOn(CurrentContextHelper, 'userUuid', 'get')
        .mockReturnValue(null);
      req.headers.authorization = 'Bearer valid-token';
      (secretsService.getSecret as jest.Mock).mockResolvedValue({});

      await middleware.use(req as unknown as Request, res, next);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Secret object or jwtSecret is undefined',
        'UserIdMiddleware',
      );
      expect(next).toHaveBeenCalled();
      spyGet.mockRestore();
    });

    it('should log error if secretObject is null', async () => {
      const spyGet = jest
        .spyOn(CurrentContextHelper, 'userUuid', 'get')
        .mockReturnValue(null);
      req.headers.authorization = 'Bearer valid-token';
      (secretsService.getSecret as jest.Mock).mockResolvedValue(null);

      await middleware.use(req as unknown as Request, res, next);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Secret object or jwtSecret is undefined',
        'UserIdMiddleware',
      );
      expect(next).toHaveBeenCalled();
      spyGet.mockRestore();
    });

    it('should handle TokenExpiredError', async () => {
      const spyGet = jest
        .spyOn(CurrentContextHelper, 'userUuid', 'get')
        .mockReturnValue(null);
      req.headers.authorization = 'Bearer expired-token';
      const error = new Error('jwt expired') as Error & { name: string };
      error.name = 'TokenExpiredError';
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw error;
      });

      await middleware.use(req as unknown as Request, res, next);

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'Token has expired: jwt expired',
        'UserIdMiddleware',
      );
      expect(next).toHaveBeenCalled();
      spyGet.mockRestore();
    });

    it('should handle other JWT errors', async () => {
      const spyGet = jest
        .spyOn(CurrentContextHelper, 'userUuid', 'get')
        .mockReturnValue(null);
      req.headers.authorization = 'Bearer bad-token';
      const error = new Error('Bad');
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw error;
      });

      await middleware.use(req as unknown as Request, res, next);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Invalid token:',
        error,
        'UserIdMiddleware',
      );
      expect(next).toHaveBeenCalled();
      spyGet.mockRestore();
    });
  });
});
