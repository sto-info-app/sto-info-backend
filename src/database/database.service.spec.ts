import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { DatabaseService } from './database.service';

describe('DatabaseService', () => {
  let service: DatabaseService;
  let dataSource: DataSource;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseService,
        {
          provide: DataSource,
          useValue: {
            query: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<DatabaseService>(DatabaseService);
    dataSource = module.get<DataSource>(DataSource);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('setDatabaseTimezone', () => {
    it('should set database timezone to UTC', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DatabaseService,
          {
            provide: DataSource,
            useValue: {
              query: jest
                .fn<(...args: any[]) => Promise<any>>()
                .mockResolvedValue(undefined),
            },
          },
        ],
      }).compile();

      const testService = module.get<DatabaseService>(DatabaseService);
      const dataSource = module.get<DataSource>(DataSource);

      await testService.setDatabaseTimezone();

      expect(dataSource.query).toHaveBeenCalledWith("SET TIME ZONE 'UTC'");
    });
  });

  describe('assertDatabaseReadyForSeeding', () => {
    it('should pass when database connection is available and required tables exist', async () => {
      (dataSource.query as jest.Mock<(...args: any[]) => Promise<any>>)
        .mockResolvedValueOnce([{ databaseName: 'sto_info_backend' }])
        .mockResolvedValueOnce([
          { tableName: 'user' },
          { tableName: 'platform' },
          { tableName: 'launcher' },
          { tableName: 'platform_launcher' },
        ]);

      await expect(
        service.assertDatabaseReadyForSeeding(),
      ).resolves.toBeUndefined();
    });

    it('should fail when database name cannot be resolved', async () => {
      (
        dataSource.query as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValueOnce([]);

      await expect(service.assertDatabaseReadyForSeeding()).rejects.toThrow(
        'Execute `npm run migration:run` before starting the application.',
      );
    });

    it('should fail when required tables are missing', async () => {
      (dataSource.query as jest.Mock<(...args: any[]) => Promise<any>>)
        .mockResolvedValueOnce([{ databaseName: 'sto_info_backend' }])
        .mockResolvedValueOnce([{ tableName: 'user' }]);

      await expect(service.assertDatabaseReadyForSeeding()).rejects.toThrow(
        'Missing tables in schema sto_info_app: platform, launcher, platform_launcher',
      );
    });
  });
});
