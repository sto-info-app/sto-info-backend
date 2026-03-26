import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { DatabaseService } from './database.service';

describe('DatabaseService', () => {
  let service: DatabaseService;

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
});
