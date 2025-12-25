import {
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorFunction,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: jest.Mocked<HealthCheckService>;
  let dbIndicator: jest.Mocked<TypeOrmHealthIndicator>;

  beforeEach(async () => {
    const healthCheckServiceMock: Partial<jest.Mocked<HealthCheckService>> = {
      check: jest.fn(),
    };

    const dbIndicatorMock: Partial<jest.Mocked<TypeOrmHealthIndicator>> = {
      pingCheck: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: healthCheckServiceMock,
        },
        {
          provide: TypeOrmHealthIndicator,
          useValue: dbIndicatorMock,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    healthCheckService = module.get(HealthCheckService);
    dbIndicator = module.get(TypeOrmHealthIndicator);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('live() should return app up status and call health check indicator', async () => {
    const expectedResult = { app: { status: 'up' } };

    healthCheckService.check.mockImplementation(
      async (
        indicators: HealthIndicatorFunction[],
      ): Promise<HealthCheckResult> => {
        const results = await Promise.all(
          indicators.map(i => Promise.resolve(i())),
        );
        return results[0] as unknown as HealthCheckResult;
      },
    );

    const result = await controller.live();

    expect(healthCheckService.check).toHaveBeenCalledTimes(1);
    const indicatorsArg = healthCheckService.check.mock.calls[0][0];
    expect(Array.isArray(indicatorsArg)).toBe(true);
    expect(indicatorsArg).toHaveLength(1);

    const indicatorResult = await indicatorsArg[0]();
    expect(indicatorResult).toEqual(expectedResult);
    expect(result).toEqual(expectedResult);
  });

  it('ready() should check database readiness via TypeOrmHealthIndicator', async () => {
    const dbHealthResult = { database: { status: 'up' } };

    dbIndicator.pingCheck.mockResolvedValue(dbHealthResult as never);
    healthCheckService.check.mockImplementation(
      async (
        indicators: HealthIndicatorFunction[],
      ): Promise<HealthCheckResult> => {
        const results = await Promise.all(
          indicators.map(i => Promise.resolve(i())),
        );
        return results[0] as unknown as HealthCheckResult;
      },
    );

    const result = await controller.ready();

    expect(healthCheckService.check).toHaveBeenCalledTimes(1);
    const indicatorsArg = healthCheckService.check.mock.calls[0][0];
    expect(Array.isArray(indicatorsArg)).toBe(true);
    expect(indicatorsArg).toHaveLength(1);

    expect(dbIndicator.pingCheck).toHaveBeenCalledTimes(1);
    expect(dbIndicator.pingCheck).toHaveBeenCalledWith('database');

    expect(result).toEqual(dbHealthResult);
  });
});
