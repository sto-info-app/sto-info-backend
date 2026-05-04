import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { AccountSeederService } from './account-seeder/account-seeder.service';
import { DatabaseModule } from './database.module';
import { DatabaseService } from './database.service';
import { UserSeederService } from './user-seeder/user-seeder.service';

type MockedDatabaseService = {
  assertDatabaseReadyForSeeding: jest.Mock<(...args: any[]) => Promise<any>>;
  setDatabaseTimezone: jest.Mock<(...args: any[]) => Promise<any>>;
};

type MockedUserSeederService = {
  seed: jest.Mock<(...args: any[]) => Promise<any>>;
};

type MockedAccountSeederService = {
  seed: jest.Mock<(...args: any[]) => Promise<any>>;
};

describe('DatabaseModule', () => {
  let databaseModule: DatabaseModule;
  let databaseService: MockedDatabaseService;
  let userSeederService: MockedUserSeederService;
  let accountSeederService: MockedAccountSeederService;
  let logSpy: jest.SpiedFunction<(...args: any[]) => any>;
  let errorSpy: jest.SpiedFunction<(...args: any[]) => any>;

  beforeEach(() => {
    databaseService = {
      assertDatabaseReadyForSeeding: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue(undefined),
      setDatabaseTimezone: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue(undefined),
    };

    userSeederService = {
      seed: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue(undefined),
    };

    accountSeederService = {
      seed: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue(undefined),
    };

    logSpy = jest.spyOn(Logger, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger, 'error').mockImplementation(() => undefined);

    databaseModule = new DatabaseModule(
      databaseService as unknown as DatabaseService,
      userSeederService as unknown as UserSeederService,
      accountSeederService as unknown as AccountSeederService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(databaseModule).toBeDefined();
  });

  it('should set database timezone and run all seeders on module init', async () => {
    await databaseModule.onModuleInit();

    expect(databaseService.assertDatabaseReadyForSeeding).toHaveBeenCalledTimes(
      1,
    );
    expect(databaseService.setDatabaseTimezone).toHaveBeenCalledTimes(1);
    expect(userSeederService.seed).toHaveBeenCalledTimes(1);
    expect(accountSeederService.seed).toHaveBeenCalledTimes(1);

    expect(logSpy).toHaveBeenCalledWith(
      'Database readiness check passed.',
      'DatabaseModule',
    );
    expect(logSpy).toHaveBeenCalledWith(
      'Database timezone set successfully.',
      'DatabaseModule',
    );
    expect(logSpy).toHaveBeenCalledWith(
      'User seeding completed successfully.',
      'DatabaseModule',
    );
    expect(logSpy).toHaveBeenCalledWith(
      'Account seeding completed successfully.',
      'DatabaseModule',
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('should log an error if setting database timezone fails but continue with seeding', async () => {
    const timezoneError = new Error('timezone failed');
    databaseService.setDatabaseTimezone.mockRejectedValueOnce(timezoneError);

    await databaseModule.onModuleInit();

    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to set database timezone:',
      timezoneError,
      'DatabaseModule',
    );
    expect(userSeederService.seed).toHaveBeenCalledTimes(1);
    expect(accountSeederService.seed).toHaveBeenCalledTimes(1);
  });

  it('should stop startup if database is not ready for seeding', async () => {
    const readinessError = new Error('run migrations first');
    databaseService.assertDatabaseReadyForSeeding.mockRejectedValueOnce(
      readinessError,
    );

    await expect(databaseModule.onModuleInit()).rejects.toThrow(readinessError);

    expect(errorSpy).toHaveBeenCalledWith(
      'Database is not ready for seeding:',
      readinessError,
      'DatabaseModule',
    );
    expect(databaseService.setDatabaseTimezone).not.toHaveBeenCalled();
    expect(userSeederService.seed).not.toHaveBeenCalled();
    expect(accountSeederService.seed).not.toHaveBeenCalled();
  });

  it('should log an error if user seeding fails but continue with account seeding', async () => {
    const userSeedError = new Error('user seed failed');
    userSeederService.seed.mockRejectedValueOnce(userSeedError);

    await databaseModule.onModuleInit();

    expect(databaseService.setDatabaseTimezone).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to seed users:',
      userSeedError,
      'DatabaseModule',
    );
    expect(accountSeederService.seed).toHaveBeenCalledTimes(1);
  });

  it('should log an error if account seeding fails', async () => {
    const accountSeedError = new Error('account seed failed');
    accountSeederService.seed.mockRejectedValueOnce(accountSeedError);

    await databaseModule.onModuleInit();

    expect(databaseService.setDatabaseTimezone).toHaveBeenCalledTimes(1);
    expect(userSeederService.seed).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to seed accounts:',
      accountSeedError,
      'DatabaseModule',
    );
  });
});
