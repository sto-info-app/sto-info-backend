import { jest } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAppVersion } from './version.utility';

jest.mock('node:fs');
jest.mock('node:path');

describe('getAppVersion', () => {
  const mockReadFileSync = readFileSync as jest.MockedFunction<
    typeof readFileSync
  >;
  const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
  const mockJoin = join as jest.MockedFunction<typeof join>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExistsSync.mockReturnValue(true); // Default to exists for most tests
    jest.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return version from package.json', () => {
    const mockPackageJson = {
      name: 'test-app',
      version: '1.2.3',
      description: 'Test application',
    };

    mockJoin.mockReturnValue('/path/to/package.json');
    mockReadFileSync.mockReturnValue(JSON.stringify(mockPackageJson));

    const result = getAppVersion();

    expect(result).toBe('1.2.3');
    expect(mockJoin).toHaveBeenCalledWith(process.cwd(), 'package.json');
    expect(mockReadFileSync).toHaveBeenCalledWith(
      '/path/to/package.json',
      'utf-8',
    );
  });

  it('should handle semantic versioning format', () => {
    const testCases = [
      '1.0.0',
      '2.5.10',
      '10.20.30',
      '1.0.0-alpha',
      '1.0.0-beta.1',
      '1.0.0+build123',
    ];

    testCases.forEach(version => {
      const mockPackageJson = { version };
      mockJoin.mockReturnValue('/path/to/package.json');
      mockReadFileSync.mockReturnValue(JSON.stringify(mockPackageJson));

      const result = getAppVersion();

      expect(result).toBe(version);
    });
  });

  it('should throw error if package.json cannot be read/found', () => {
    mockJoin.mockReturnValue('/path/to/package.json');
    mockExistsSync.mockReturnValue(false); // File doesn't exist

    expect(() => getAppVersion()).toThrow(
      'Unable to find or parse package.json',
    );
  });

  it('should throw error if package.json is invalid JSON', () => {
    mockJoin.mockReturnValue('/path/to/package.json');
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{ invalid json');

    expect(() => getAppVersion()).toThrow(
      'Unable to find or parse package.json',
    );
  });

  it('should return version even if package.json has minimal fields', () => {
    const mockPackageJson = {
      version: '5.0.0',
    };

    mockJoin.mockReturnValue('/path/to/package.json');
    mockReadFileSync.mockReturnValue(JSON.stringify(mockPackageJson));

    const result = getAppVersion();

    expect(result).toBe('5.0.0');
  });

  it('should handle version with various formats', () => {
    const versions = ['0.0.1', '999.999.999', '1.0.0-rc.1+20240101'];

    versions.forEach(version => {
      const mockPackageJson = { version };
      mockJoin.mockReturnValue('/path/to/package.json');
      mockReadFileSync.mockReturnValue(JSON.stringify(mockPackageJson));

      const result = getAppVersion();

      expect(result).toBe(version);
    });
  });
  it('should handle package.json missing version field by trying next path', () => {
    mockJoin
      .mockReturnValueOnce('/first/package.json')
      .mockReturnValueOnce('/second/package.json');
    mockExistsSync.mockReturnValue(true);

    // First one missing version, second one has it
    mockReadFileSync
      .mockReturnValueOnce(JSON.stringify({ name: 'no-version' }))
      .mockReturnValueOnce(JSON.stringify({ version: '2.0.0' }));

    const result = getAppVersion();

    expect(result).toBe('2.0.0');
    expect(mockReadFileSync).toHaveBeenCalledTimes(2);
  });

  it('should continue to next path if parsing fails for one package.json', () => {
    mockJoin
      .mockReturnValueOnce('/invalid/package.json')
      .mockReturnValueOnce('/valid/package.json');
    mockExistsSync.mockReturnValue(true);

    // First one is invalid JSON, second one is valid
    mockReadFileSync
      .mockReturnValueOnce('invalid-json')
      .mockReturnValueOnce(JSON.stringify({ version: '3.0.0' }));

    const result = getAppVersion();

    expect(result).toBe('3.0.0');
    expect(console.debug).toHaveBeenCalledWith(
      expect.stringContaining('Found package.json at /invalid/package.json'),
      expect.any(Error),
    );
    expect(mockReadFileSync).toHaveBeenCalledTimes(2);
  });
});
