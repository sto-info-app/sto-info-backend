import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAppVersion } from './version.utility';

jest.mock('node:fs');
jest.mock('node:path');

describe('getAppVersion', () => {
  const mockReadFileSync = readFileSync as jest.MockedFunction<
    typeof readFileSync
  >;
  const mockJoin = join as jest.MockedFunction<typeof join>;

  beforeEach(() => {
    jest.clearAllMocks();
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

  it('should throw error if package.json cannot be read', () => {
    mockJoin.mockReturnValue('/path/to/package.json');
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    expect(() => getAppVersion()).toThrow('ENOENT: no such file or directory');
  });

  it('should throw error if package.json is invalid JSON', () => {
    mockJoin.mockReturnValue('/path/to/package.json');
    mockReadFileSync.mockReturnValue('{ invalid json');

    expect(() => getAppVersion()).toThrow();
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
});
