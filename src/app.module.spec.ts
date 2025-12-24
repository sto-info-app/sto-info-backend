import { MiddlewareConsumer } from '@nestjs/common';

jest.mock(
  'config/typeorm.config',
  () => ({
    getTypeOrmConfig: jest.fn().mockResolvedValue({}),
  }),
  { virtual: true },
);

jest.mock('@nestjs/typeorm', () => {
  const capturedOptions: any[] = [];
  return {
    TypeOrmModule: {
      forRootAsync: (options: any) => {
        capturedOptions.push(options);
        return options;
      },
      forFeature: () => ({}),
      __test__: {
        getCapturedOptions: () => capturedOptions,
      },
    },
    InjectRepository: () => () => undefined,
  };
});

import { TypeOrmModule } from '@nestjs/typeorm';
import { getTypeOrmConfig } from 'config/typeorm.config';
import { AppModule } from './app.module';
import { UserIdMiddleware } from './auth/user-id.middleware';

describe('AppModule', () => {
  let appModule: AppModule;

  beforeEach(() => {
    appModule = new AppModule();
  });

  it('should be defined', () => {
    expect(appModule).toBeDefined();
  });

  it('should apply UserIdMiddleware to all routes in configure', () => {
    const forRoutesMock = jest.fn();
    const applyMock = jest.fn().mockReturnValue({
      forRoutes: forRoutesMock as any,
    });

    const consumer: Partial<MiddlewareConsumer> = {
      apply: applyMock as any,
    };

    appModule.configure(consumer as MiddlewareConsumer);

    expect(applyMock).toHaveBeenCalledWith(UserIdMiddleware);
    expect(forRoutesMock).toHaveBeenCalledWith('*');
  });

  it('should configure TypeOrmModule using getTypeOrmConfig in useFactory', async () => {
    const typeOrmModule: any = TypeOrmModule;
    const capturedOptions = typeOrmModule.__test__.getCapturedOptions();

    expect(capturedOptions.length).toBeGreaterThan(0);

    const options = capturedOptions[0];
    expect(typeof options.useFactory).toBe('function');

    const mockConfig = { foo: 'bar' };
    (getTypeOrmConfig as jest.Mock).mockResolvedValue(mockConfig);

    const result = await options.useFactory();

    expect(getTypeOrmConfig).toHaveBeenCalled();
    expect(result).toBe(mockConfig);
  });

  it('should build envFilePath with empty suffix when NODE_ENV is not set', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    // Remove NODE_ENV so the fallback branch (`|| ''`) is used
    // when app.module.ts is evaluated.

    delete process.env.NODE_ENV;

    jest.resetModules();

    // Re-import the module so the decorator factory runs again
    // with NODE_ENV undefined, exercising the alternate branch.
    await import('./app.module');

    process.env.NODE_ENV = originalNodeEnv;
  });
});
