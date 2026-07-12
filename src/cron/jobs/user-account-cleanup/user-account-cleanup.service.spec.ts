import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserRefreshTokenEntity } from 'src/user-refresh-token/entities/user-refresh-token.entity';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';
import { UserEntity } from 'src/user/entities/user.entity';
import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { Repository } from 'typeorm';
import { UserAccountCleanupService } from './user-account-cleanup.service';

describe('UserAccountCleanupService', () => {
  let service: UserAccountCleanupService;
  let userRepository: Repository<UserEntity>;
  let userProfileRepository: Repository<UserProfileEntity>;
  let userRefreshTokenRepository: Repository<UserRefreshTokenEntity>;
  let accountRepository: Repository<AccountEntity>;
  let loggerLogSpy: jest.SpiedFunction<(...args: any[]) => any>;

  const createDeleteQueryBuilder = () => {
    const queryBuilder = {
      delete: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn(async () => undefined),
    };

    return queryBuilder;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserAccountCleanupService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: {
            find: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(UserProfileEntity),
          useValue: {
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(UserRefreshTokenEntity),
          useValue: {
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(AccountEntity),
          useValue: {
            createQueryBuilder: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UserAccountCleanupService>(UserAccountCleanupService);
    userRepository = module.get<Repository<UserEntity>>(
      getRepositoryToken(UserEntity),
    );
    userProfileRepository = module.get<Repository<UserProfileEntity>>(
      getRepositoryToken(UserProfileEntity),
    );
    userRefreshTokenRepository = module.get<Repository<UserRefreshTokenEntity>>(
      getRepositoryToken(UserRefreshTokenEntity),
    );
    accountRepository = module.get<Repository<AccountEntity>>(
      getRepositoryToken(AccountEntity),
    );

    loggerLogSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
    loggerLogSpy.mockRestore();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('cleanup', () => {
    it('should log and return when no users are eligible', async () => {
      (
        userRepository.find as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue([]);

      await service.cleanup();

      expect(userRepository.find).toHaveBeenCalled();
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'No closed accounts eligible for hard deletion',
        ),
      );
    });

    it('should hard delete eligible users and dependencies', async () => {
      (
        userRepository.find as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);

      const refreshDeleteQb = createDeleteQueryBuilder();
      const profileDeleteQb = createDeleteQueryBuilder();
      const accountDeleteQb = createDeleteQueryBuilder();
      const userDeleteQb = createDeleteQueryBuilder();

      (
        userRefreshTokenRepository.createQueryBuilder as jest.Mock<
          (...args: any[]) => any
        >
      ).mockReturnValue(refreshDeleteQb);
      (
        userProfileRepository.createQueryBuilder as jest.Mock<
          (...args: any[]) => any
        >
      ).mockReturnValue(profileDeleteQb);
      (
        accountRepository.createQueryBuilder as jest.Mock<
          (...args: any[]) => any
        >
      ).mockReturnValue(accountDeleteQb);
      (
        userRepository.createQueryBuilder as jest.Mock<(...args: any[]) => any>
      ).mockReturnValue(userDeleteQb);

      await service.cleanup();

      expect(refreshDeleteQb.execute).toHaveBeenCalled();
      expect(profileDeleteQb.execute).toHaveBeenCalled();
      expect(accountDeleteQb.execute).toHaveBeenCalled();
      expect(userDeleteQb.execute).toHaveBeenCalled();
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Hard deleted 2 closed user account(s)'),
      );
    });
  });
});
