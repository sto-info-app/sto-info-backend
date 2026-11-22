import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';

import { AppService } from './app.service';

jest.mock('fs');
jest.mock('path');

describe('AppService', () => {
  let service: AppService;
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AppService],
    }).compile();

    service = module.get<AppService>(AppService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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
