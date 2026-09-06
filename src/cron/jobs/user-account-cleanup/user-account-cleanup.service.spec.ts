import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { jest } from '@jest/globals';
import { Repository } from 'typeorm';

import { CustomTrackingPurgeService } from 'src/custom-tracking/retention/custom-tracking-purge.service';
import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { UserRefreshTokenEntity } from 'src/user-refresh-token/entities/user-refresh-token.entity';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';
import { UserEntity } from 'src/user/entities/user.entity';

import { UserAccountCleanupService } from './user-account-cleanup.service';

describe('UserAccountCleanupService', () => {
  let service: UserAccountCleanupService;
  let userRepository: Repository<UserEntity>;
  let userProfileRepository: Repository<UserProfileEntity>;
  let userRefreshTokenRepository: Repository<UserRefreshTokenEntity>;
  let accountRepository: Repository<AccountEntity>;
  let loggerLogSpy: jest.SpiedFunction<(...args: any[]) => any>;
  let purgeUsers: jest.Mock<(userIds: string[]) => Promise<unknown>>;

  const createDeleteQueryBuilder = () => {
    const queryBuilder = {
      delete: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn(async () => undefined),
    };

    return queryBuilder;
  };

  beforeEach(async () => {
    purgeUsers = jest.fn(async () => ({
      sections: 1,
      tabs: 1,
      fields: 2,
      options: 0,
      values: 3,
      images: 1,
      retained: 0,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserAccountCleanupService,
        {
          provide: CustomTrackingPurgeService,
          useValue: { purgeUsers },
        },
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

    // The database would take the rows with the user on its own. The pictures
    // those rows point at live in Cloudflare, which no cascade can reach, so
    // they have to be queued while something still knows they are there.
    it('removes their custom tracking data before the user row goes', async () => {
      (
        userRepository.find as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue([{ id: 'u1' }]);

      const userDeleteQb = createDeleteQueryBuilder();

      for (const repository of [
        userRefreshTokenRepository,
        userProfileRepository,
        accountRepository,
      ]) {
        (
          repository.createQueryBuilder as jest.Mock<(...args: any[]) => any>
        ).mockReturnValue(createDeleteQueryBuilder());
      }

      (
        userRepository.createQueryBuilder as jest.Mock<(...args: any[]) => any>
      ).mockReturnValue(userDeleteQb);

      await service.cleanup();

      expect(purgeUsers).toHaveBeenCalledWith(['u1']);
      expect(purgeUsers.mock.invocationCallOrder[0]).toBeLessThan(
        (userDeleteQb.execute as jest.Mock).mock.invocationCallOrder[0],
      );
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('1 image(s) queued'),
      );
    });

    it('asks for no purge when nothing is eligible', async () => {
      (
        userRepository.find as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue([]);

      await service.cleanup();

      expect(purgeUsers).not.toHaveBeenCalled();
    });
  });
});
