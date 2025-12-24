import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AppService } from './app.service';
import { SecretsService } from './shared/secrets/secrets.service';

jest.mock('fs');
jest.mock('path');

describe('AppService', () => {
  let service: AppService;
  let secretsServiceMock: { getSecret: jest.Mock };

  beforeEach(async () => {
    secretsServiceMock = {
      getSecret: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppService,
        {
          provide: SecretsService,
          useValue: secretsServiceMock,
        },
      ],
    }).compile();

    service = module.get<AppService>(AppService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('getJwtSecret should return the jwt secret on success', async () => {
    secretsServiceMock.getSecret.mockResolvedValue({
      jwtSecret: 'test-secret',
    });

    const result = await service.getJwtSecret();

    expect(secretsServiceMock.getSecret).toHaveBeenCalledWith('mySecret');
    expect(result).toBe('test-secret');
  });

  it('getJwtSecret should log and rethrow on error', async () => {
    const error = new Error('Failed');
    secretsServiceMock.getSecret.mockRejectedValue(error);

    const loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined as any);

    await expect(service.getJwtSecret()).rejects.toThrow(error);

    expect(loggerErrorSpy).toHaveBeenCalled();

    loggerErrorSpy.mockRestore();
  });

  it('getHello should return greeting with NODE_ENV when set', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test-env';

    const result = service.getHello();

    expect(result).toBe('Hello test-env!');

    process.env.NODE_ENV = originalNodeEnv;
  });

  it('getHello should default to "World" when NODE_ENV is not set', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    delete process.env.NODE_ENV;

    const result = service.getHello();

    expect(result).toBe('Hello World!');

    process.env.NODE_ENV = originalNodeEnv;
  });

  it('getAppVersion should return version from package.json', () => {
    (join as jest.Mock).mockReturnValue('/fake/path/package.json');
    (readFileSync as jest.Mock).mockReturnValue(
      JSON.stringify({ version: '1.2.3' }),
    );

    const version = service.getAppVersion();

    expect(join).toHaveBeenCalled();
    expect(readFileSync).toHaveBeenCalledWith(
      '/fake/path/package.json',
      'utf-8',
    );
    expect(version).toBe('1.2.3');
  });
});
