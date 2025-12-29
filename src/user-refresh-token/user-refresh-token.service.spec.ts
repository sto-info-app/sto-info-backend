import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { Repository } from 'typeorm';
import { UserRefreshTokenEntity } from './entities/user-refresh-token.entity';
import { UserRefreshTokenService } from './user-refresh-token.service';

jest.mock('bcrypt');
jest.mock('jsonwebtoken');

describe('UserRefreshTokenService', () => {
  let service: UserRefreshTokenService;
  let repo: Repository<UserRefreshTokenEntity>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserRefreshTokenService,
        {
          provide: getRepositoryToken(UserRefreshTokenEntity),
          useValue: {
            create: jest.fn().mockImplementation(dto => dto),
            save: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
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
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');
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
  });

  describe('findByTokenId', () => {
    it('should find by tokenId', async () => {
      const token = { id: 1 };
      (repo.findOne as jest.Mock).mockResolvedValue(token);
      expect(await service.findByTokenId('tid')).toBe(token);
    });
  });

  describe('createUserRefreshToken', () => {
    it('should create from user and token string', async () => {
      const user = { id: 'u1' };
      (jwt.decode as jest.Mock).mockReturnValue({ jti: 'jti' });
      (repo.save as jest.Mock).mockImplementation(val => val);

      const result = await service.createUserRefreshToken(user as any, 'token');
      expect(result.user).toBe(user);
      expect(result.tokenId).toBe('jti');
    });

    it('should handle missing jti in createUserRefreshToken', async () => {
      const user = { id: 'u1' };
      (jwt.decode as jest.Mock).mockReturnValue({});
      (repo.save as jest.Mock).mockImplementation(val => val);

      const result = await service.createUserRefreshToken(user as any, 'token');
      expect(result.tokenId).toBeUndefined();
    });
  });

  describe('revokeUserRefreshToken', () => {
    it('should revoke matching token', async () => {
      const tokenRecord = { tokenId: 'h1', isRevoked: false };
      const tokens = [tokenRecord];
      (repo.find as jest.Mock).mockResolvedValue(tokens);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.revokeUserRefreshToken('raw');
      expect(tokenRecord.isRevoked).toBe(true);
      expect(repo.save).toHaveBeenCalledWith(tokenRecord);
    });

    it('should do nothing if no matches', async () => {
      const tokenRecord = { tokenId: 'h1', isRevoked: false };
      const tokens = [tokenRecord];
      (repo.find as jest.Mock).mockResolvedValue(tokens);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await service.revokeUserRefreshToken('raw');
      expect(tokenRecord.isRevoked).toBe(false);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('revokeToken', () => {
    it('should revoke for specific user', async () => {
      const tokenRecord: any = {
        tokenId: 'h1',
        user: { id: 'u1' },
        isRevoked: false,
      };
      const tokens = [tokenRecord];
      (repo.find as jest.Mock).mockResolvedValue(tokens);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.revokeToken('u1', 'raw');
      expect(tokenRecord.isRevoked).toBe(true);
      expect(repo.save).toHaveBeenCalled();
    });

    it('should throw if user mismatch', async () => {
      const tokenRecord: any = { tokenId: 'h1', user: { id: 'u2' } };
      const tokens = [tokenRecord];
      (repo.find as jest.Mock).mockResolvedValue(tokens);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(service.revokeToken('u1', 'raw')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw if token not found/no matches', async () => {
      (repo.find as jest.Mock).mockResolvedValue([{ tokenId: 'h1' }]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(service.revokeToken('u1', 'raw')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('revokeAllTokensForUser', () => {
    it('should update all tokens for user', async () => {
      await service.revokeAllTokensForUser('u1');
      expect(repo.update).toHaveBeenCalled();
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
