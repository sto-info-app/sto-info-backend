import { ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { UserLimitOverrideEntity } from './entities/user-limit-override.entity';
import { LimitService } from './limit.service';

/** Chainable stub standing in for a TypeORM query builder. */
interface QueryBuilderStub {
  select: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  getRawOne: jest.Mock;
}

/**
 * Builds a chainable query-builder stub whose terminal `getRawOne` resolves to
 * the supplied row.
 *
 * @param row - The row the query should resolve to.
 * @returns The stubbed query builder.
 */
const createQueryBuilder = (row: unknown): QueryBuilderStub => {
  const builder: QueryBuilderStub = {
    select: jest.fn((): QueryBuilderStub => builder),
    where: jest.fn((): QueryBuilderStub => builder),
    andWhere: jest.fn((): QueryBuilderStub => builder),
    getRawOne: jest.fn().mockResolvedValue(row),
  };
  return builder;
};

describe('LimitService', () => {
  let service: LimitService;
  let overrideRepository: { createQueryBuilder: jest.Mock };
  let configService: { get: jest.Mock };

  const userId = 'e6d3a1b2-0000-4000-8000-000000000001';
  const key = 'STORYTIME_MAX_STORIES_PER_USER';

  beforeEach(async () => {
    overrideRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(createQueryBuilder(null)),
    };
    configService = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LimitService,
        {
          provide: getRepositoryToken(UserLimitOverrideEntity),
          useValue: overrideRepository,
        },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<LimitService>(LimitService);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('resolve', () => {
    it('returns a per-user override in preference to configuration', async () => {
      overrideRepository.createQueryBuilder.mockReturnValue(
        createQueryBuilder({ limitValue: 500 }),
      );
      configService.get.mockReturnValue(50);

      await expect(service.resolve(userId, key, 10)).resolves.toBe(500);
    });

    it('returns the configured value when no override applies', async () => {
      configService.get.mockReturnValue(75);

      await expect(service.resolve(userId, key, 50)).resolves.toBe(75);
    });

    it('parses a configured value supplied as a string', async () => {
      configService.get.mockReturnValue('120');

      await expect(service.resolve(userId, key, 50)).resolves.toBe(120);
    });

    it('returns the default when configuration is absent', async () => {
      configService.get.mockReturnValue(undefined);

      await expect(service.resolve(userId, key, 50)).resolves.toBe(50);
    });

    it('returns the default when configuration is null', async () => {
      configService.get.mockReturnValue(null);

      await expect(service.resolve(userId, key, 50)).resolves.toBe(50);
    });

    it('returns the default when configuration is not a number', async () => {
      configService.get.mockReturnValue('unlimited');

      await expect(service.resolve(userId, key, 50)).resolves.toBe(50);
    });

    it('returns the default when configuration is negative', async () => {
      configService.get.mockReturnValue(-1);

      await expect(service.resolve(userId, key, 50)).resolves.toBe(50);
    });

    it('returns the default when configuration is fractional', async () => {
      configService.get.mockReturnValue(2.5);

      await expect(service.resolve(userId, key, 50)).resolves.toBe(50);
    });

    it('accepts a configured limit of zero', async () => {
      configService.get.mockReturnValue(0);

      await expect(service.resolve(userId, key, 50)).resolves.toBe(0);
    });
  });

  describe('assertWithinLimit', () => {
    it('resolves when the user is below the limit', async () => {
      configService.get.mockReturnValue(50);

      await expect(
        service.assertWithinLimit(userId, key, 50, 49),
      ).resolves.toBeUndefined();
    });

    it('throws when the user has reached the limit', async () => {
      configService.get.mockReturnValue(50);

      await expect(
        service.assertWithinLimit(userId, key, 50, 50),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws when the user is somehow above the limit', async () => {
      configService.get.mockReturnValue(50);

      await expect(
        service.assertWithinLimit(userId, key, 50, 51),
      ).rejects.toThrow(ForbiddenException);
    });

    it('honours a per-user exemption that raises the ceiling', async () => {
      overrideRepository.createQueryBuilder.mockReturnValue(
        createQueryBuilder({ limitValue: 500 }),
      );
      configService.get.mockReturnValue(50);

      await expect(
        service.assertWithinLimit(userId, key, 50, 60),
      ).resolves.toBeUndefined();
    });
  });
});
