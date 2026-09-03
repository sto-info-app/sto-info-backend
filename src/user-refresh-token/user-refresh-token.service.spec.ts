import { jest } from '@jest/globals';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { SecretsService } from 'src/shared/secrets/secrets.service';
import { Repository } from 'typeorm';
import { UserRefreshTokenEntity } from './entities/user-refresh-token.entity';
import { UserRefreshTokenService } from './user-refresh-token.service';

jest.mock('bcrypt');
jest.mock('jsonwebtoken');

describe('UserRefreshTokenService', () => {
  let service: UserRefreshTokenService;
  let repo: Repository<UserRefreshTokenEntity>;
  let secretsService: SecretsService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserRefreshTokenService,
        {
          provide: ConfigService,
          useValue: {
            get: jest
              .fn<(...args: any[]) => any>()
              .mockImplementation((key: string) => {
                if (key === 'AWS_SECRET_NAME') {
                  return 'test-secret-name';
                }
                return undefined;
              }),
          },
        },
        {
          provide: SecretsService,
          useValue: {
            getSecret: jest
              .fn<(...args: any[]) => Promise<any>>()
              .mockResolvedValue({ jwtSecret: 'test-secret' }),
          },
        },
        {
          provide: getRepositoryToken(UserRefreshTokenEntity),
          useValue: {
            create: jest.fn().mockImplementation(dto => dto),
            save: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue({
              delete: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              execute: jest.fn(),
            }),
          },
        },
      ],
    }).compile();

    service = module.get<UserRefreshTokenService>(UserRefreshTokenService);
    repo = module.get<Repository<UserRefreshTokenEntity>>(
      getRepositoryToken(UserRefreshTokenEntity),
    );
    secretsService = module.get<SecretsService>(SecretsService);
    configService = module.get<ConfigService>(ConfigService);
    process.env.AUTH_SALT_ROUNDS = '10';
    process.env.AUTH_REFRESH_TOKEN_EXPIRES_IN = '3600';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create and hash token', async () => {
      const dto = { tokenId: 'raw' };
      (
        bcrypt.hash as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue('hashed');
      (repo.save as jest.Mock).mockImplementation(val => val);

      const result = await service.create(dto as any);
      expect(result.tokenId).toBe('hashed');
      expect(result.expiresAt).toBeDefined();
      expect(repo.save).toHaveBeenCalled();
    });

    it('should handle missing tokenId in create', async () => {
      const dto = {};
      (repo.save as jest.Mock).mockImplementation(val => val);

      const result = await service.create(dto as any);
      expect(result.tokenId).toBeUndefined();
      expect(repo.save).toHaveBeenCalled();
    });

    it('should keep an expiry supplied by the caller', async () => {
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      (
        bcrypt.hash as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue('hashed');
      (repo.save as jest.Mock).mockImplementation(val => val);

      const result = await service.create({ tokenId: 'raw', expiresAt } as any);
      expect(result.expiresAt).toBe(expiresAt);
    });

    it('should fall back to four hours when the environment is unset', async () => {
      const original = process.env.AUTH_REFRESH_TOKEN_EXPIRES_IN;
      delete process.env.AUTH_REFRESH_TOKEN_EXPIRES_IN;
      (repo.save as jest.Mock).mockImplementation(val => val);
      const before = Date.now();

      const result = await service.create({} as any);

      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + 14400 * 1000,
      );
      process.env.AUTH_REFRESH_TOKEN_EXPIRES_IN = original;
    });

    it('should throw BadRequestException if dto is missing', async () => {
      await expect(service.create(null as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findByTokenId', () => {
    it('should find by tokenId', async () => {
      const token = { id: 1 };
      (
        repo.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(token);
      expect(await service.findByTokenId('tid')).toBe(token);
    });

    it('should throw BadRequestException if tokenId is missing', async () => {
      await expect(service.findByTokenId('')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('createUserRefreshToken', () => {
    it('should create from user and token string', async () => {
      const user = { id: 'u1' };
      (jwt.verify as jest.Mock).mockReturnValue({
        jti: 'jti',
        exp: 1234567890,
      });
      (
        bcrypt.hash as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue('hashed_token');
      (repo.save as jest.Mock).mockImplementation(val => val);

      const result = await service.createUserRefreshToken(user as any, 'token');
      expect(result.user).toBe(user);
      expect(result.userId).toBe('u1');
      expect(result.jwtId).toBe('jti');
      expect(result.tokenId).toBe('hashed_token');
      expect(result.expiresAt).toBeDefined();
      expect(configService.get).toHaveBeenCalledWith('AWS_SECRET_NAME');
      expect(secretsService.getSecret).toHaveBeenCalledWith('test-secret-name');
      expect(jwt.verify).toHaveBeenCalled();
    });

    it('should handle missing jti in createUserRefreshToken', async () => {
      const user = { id: 'u1' };
      (jwt.verify as jest.Mock).mockReturnValue({});
      (
        bcrypt.hash as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue('hashed_token');
      (repo.save as jest.Mock).mockImplementation(val => val);

      const result = await service.createUserRefreshToken(user as any, 'token');
      expect(result.jwtId).toBeUndefined();
    });

    it('should handle missing exp in createUserRefreshToken', async () => {
      const user = { id: 'u1' };
      (jwt.verify as jest.Mock).mockReturnValue({ jti: 'jti' });
      (
        bcrypt.hash as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue('hashed_token');
      (repo.save as jest.Mock).mockImplementation(val => val);

      const result = await service.createUserRefreshToken(user as any, 'token');
      expect(result.expiresAt).toBeDefined();
    });

    it('should throw BadRequestException if refresh token cannot be verified', async () => {
      const user = { id: 'u1' };
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('bad token');
      });

      await expect(
        service.createUserRefreshToken(user as any, 'token'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if AWS_SECRET_NAME is missing', async () => {
      const user = { id: 'u1' };
      (configService.get as jest.Mock).mockReturnValueOnce(undefined);

      await expect(
        service.createUserRefreshToken(user as any, 'token'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if jwtSecret is missing from secret', async () => {
      const user = { id: 'u1' };
      (
        secretsService.getSecret as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValueOnce({});

      await expect(
        service.createUserRefreshToken(user as any, 'token'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if secret service returns null', async () => {
      const user = { id: 'u1' };
      (
        secretsService.getSecret as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValueOnce(null);

      await expect(
        service.createUserRefreshToken(user as any, 'token'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if secret service throws', async () => {
      const user = { id: 'u1' };
      (
        secretsService.getSecret as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockRejectedValueOnce(new Error('secrets down'));

      await expect(
        service.createUserRefreshToken(user as any, 'token'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if jwt.verify returns string payload', async () => {
      const user = { id: 'u1' };
      (jwt.verify as jest.Mock).mockReturnValue('payload');

      await expect(
        service.createUserRefreshToken(user as any, 'token'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if jwt.verify returns null payload', async () => {
      const user = { id: 'u1' };
      (jwt.verify as jest.Mock).mockReturnValue(null);

      await expect(
        service.createUserRefreshToken(user as any, 'token'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if user is missing', async () => {
      await expect(
        service.createUserRefreshToken(null as any, 'token'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if token is missing', async () => {
      await expect(
        service.createUserRefreshToken({ id: 'u1' } as any, ''),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('revokeUserRefreshToken', () => {
    it('should revoke matching token by jti', async () => {
      (jwt.verify as jest.Mock).mockReturnValue({ jti: 'jti' });

      await service.revokeUserRefreshToken('raw_token');
      expect(repo.update).toHaveBeenCalledWith(
        { jwtId: 'jti', isRevoked: false },
        { isRevoked: true },
      );
    });

    it('should do nothing if token cannot be verified', async () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('bad token');
      });

      await service.revokeUserRefreshToken('invalid');
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('should do nothing if jti is missing', async () => {
      (jwt.verify as jest.Mock).mockReturnValue({});

      await service.revokeUserRefreshToken('no_jti');
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('should do nothing if jwt.verify returns string payload', async () => {
      (jwt.verify as jest.Mock).mockReturnValue('payload');

      await service.revokeUserRefreshToken('raw_token');
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if token is missing', async () => {
      await expect(service.revokeUserRefreshToken('')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('revokeToken', () => {
    it('should revoke for specific user by jti', async () => {
      (jwt.verify as jest.Mock).mockReturnValue({ jti: 'jti' });
      const tokenRecord: any = { jwtId: 'jti', userId: 'u1', isRevoked: false };
      (
        repo.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(tokenRecord);

      await service.revokeToken('u1', 'raw_token');
      expect(tokenRecord.isRevoked).toBe(true);
      expect(repo.save).toHaveBeenCalled();
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { jwtId: 'jti', userId: 'u1' },
      });
    });

    it('should throw if jti missing', async () => {
      (jwt.verify as jest.Mock).mockReturnValue({});

      await expect(service.revokeToken('u1', 'raw')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw if refresh token cannot be verified', async () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('bad token');
      });

      await expect(service.revokeToken('u1', 'raw')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw if token not found in db', async () => {
      (jwt.verify as jest.Mock).mockReturnValue({ jti: 'missing' });
      (
        repo.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(null);

      await expect(service.revokeToken('u1', 'raw')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw BadRequestException if userId is missing', async () => {
      await expect(service.revokeToken('', 'raw')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if token is missing', async () => {
      await expect(service.revokeToken('u1', '')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('revokeAllTokensForUser', () => {
    it('should update all tokens for user', async () => {
      await service.revokeAllTokensForUser('u1');
      expect(repo.update).toHaveBeenCalled();
      expect(repo.delete).toHaveBeenCalledWith({ userId: 'u1' });
    });

    it('should throw BadRequestException if userId is missing', async () => {
      await expect(service.revokeAllTokensForUser('')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('cleanupExpiredAndRevokedTokens', () => {
    it('should execute cleanup query', async () => {
      const queryBuilder = repo.createQueryBuilder();
      await service.cleanupExpiredAndRevokedTokens();
      expect(queryBuilder.execute).toHaveBeenCalled();
    });
  });
});
