import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { jest } from '@jest/globals';
import { Repository } from 'typeorm';

import { CustomTrackingPurgeService } from 'src/custom-tracking/retention/custom-tracking-purge.service';
import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { AssetWithdrawalService } from 'src/file-assets/services/asset-withdrawal.service';
import { ModerationHoldEntity } from 'src/fleet/chat/holds/moderation-hold.entity';
import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { UserRefreshTokenEntity } from 'src/user-refresh-token/entities/user-refresh-token.entity';
import { ACCOUNT_DEPARTURE } from 'src/user/account-departure';
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
  let managerFind: jest.Mock<(entity: unknown) => Promise<unknown[]>>;
  let depart: jest.Mock<(userId: string) => Promise<unknown[]>>;
  let withdrawByReference: jest.Mock<
    (reference: string, reason: string) => Promise<unknown>
  >;

  const createDeleteQueryBuilder = () => {
    const queryBuilder = {
      delete: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn(async () => undefined),
    };

    return queryBuilder;
  };

  beforeEach(async () => {
    managerFind = jest.fn(async () => []);
    depart = jest.fn(async () => []);
    withdrawByReference = jest.fn(async () => ({
      deleted: true,
      revoked: true,
    }));
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
          provide: AssetWithdrawalService,
          useValue: { withdrawByReference },
        },
        { provide: ACCOUNT_DEPARTURE, useValue: { depart } },
        {
          provide: getRepositoryToken(UserEntity),
          useValue: {
            find: jest.fn(),
            createQueryBuilder: jest.fn(),
            manager: { find: managerFind },
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

    /**
     * Makes every delete succeed.
     */
    const deletable = (): void => {
      for (const repository of [
        userRefreshTokenRepository,
        userProfileRepository,
        accountRepository,
        userRepository,
      ]) {
        (
          repository.createQueryBuilder as jest.Mock<(...args: any[]) => any>
        ).mockReturnValue(createDeleteQueryBuilder());
      }
    };

    // FC-037 and FC-038: a held member's messages would go with the next
    // chat purge, so they wait for the hold.
    it('keeps accounts whose messages are held until the hold ends', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      (
        userRepository.find as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
      managerFind.mockImplementation(async entity =>
        entity === ModerationHoldEntity
          ? [{ id: 'h1', subjectUserId: 'u2' }]
          : [],
      );
      deletable();

      await service.cleanup();

      expect(purgeUsers).toHaveBeenCalledWith(['u1']);
      expect(depart).toHaveBeenCalledWith('u1');
      expect(depart).not.toHaveBeenCalledWith('u2');
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Kept 1 closed account(s)'),
      );
      warn.mockRestore();
    });

    // FC-038: an account closed before its Communities were handed on has
    // them handed on, or closed, before it goes.
    it('hands on any Community an account still owns, keeping it when that fails', async () => {
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      (
        userRepository.find as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }]);
      depart
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('owner limit'))
        .mockRejectedValueOnce('down');
      deletable();

      await service.cleanup();

      expect(depart).toHaveBeenCalledTimes(3);
      expect(purgeUsers).toHaveBeenCalledWith(['u1']);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('UserId: u2'),
        expect.any(String),
      );
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('UserId: u3'),
        'down',
      );
      error.mockRestore();
    });

    it('deletes nothing when every account due is kept', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      (
        userRepository.find as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue([{ id: 'u1' }]);
      managerFind.mockImplementation(async entity =>
        entity === ModerationHoldEntity
          ? [{ id: 'h1', subjectUserId: 'u1' }]
          : [],
      );

      await service.cleanup();

      expect(purgeUsers).not.toHaveBeenCalled();
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('No closed accounts eligible'),
      );
    });

    // FC-038: the objects their own pictures were served from go too.
    it('withdraws their own pictures, reporting one it cannot', async () => {
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      (
        userRepository.find as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue([{ id: 'u1' }]);
      managerFind.mockImplementation(async entity =>
        entity === FileAssetEntity
          ? [
              { id: 'a1', deliveryReference: 'r1' },
              { id: 'a2', deliveryReference: 'r2' },
              { id: 'a3', deliveryReference: 'r3' },
            ]
          : [],
      );
      withdrawByReference
        .mockResolvedValueOnce({ deleted: true, revoked: true })
        .mockRejectedValueOnce(new Error('Cloudflare down'))
        .mockRejectedValueOnce('down');
      deletable();

      await service.cleanup();

      expect(withdrawByReference).toHaveBeenCalledWith(
        'r1',
        'The account was erased',
      );
      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Withdrew 1 of 3 picture(s) of closed account(s).',
      );
      expect(error).toHaveBeenCalledWith(
        'Picture not withdrawn - AssetId: a3',
        'down',
      );
      error.mockRestore();
    });

    it('erases without the Fleet when it is not there to ask', async () => {
      const bare = new UserAccountCleanupService(
        userRepository,
        userProfileRepository,
        userRefreshTokenRepository,
        accountRepository,
        { purgeUsers } as unknown as CustomTrackingPurgeService,
        { withdrawByReference } as unknown as AssetWithdrawalService,
      );

      (
        userRepository.find as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue([{ id: 'u1' }]);
      deletable();

      await bare.cleanup();

      expect(purgeUsers).toHaveBeenCalledWith(['u1']);
      expect(depart).not.toHaveBeenCalled();
    });

    it('asks for no purge when nothing is eligible', async () => {
      (
        userRepository.find as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue([]);

      await service.cleanup();

      expect(purgeUsers).not.toHaveBeenCalled();
      expect(managerFind).not.toHaveBeenCalled();
    });
  });
});
