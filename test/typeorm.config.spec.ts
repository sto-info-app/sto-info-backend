import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { jest } from '@jest/globals';

import { getTypeOrmConfig } from '../config/typeorm.config';

jest.mock('src/shared/secrets/secrets.service', () => ({
  SecretsService: jest.fn().mockImplementation(() => ({
    getSecret: jest.fn<() => Promise<object>>().mockResolvedValue({}),
  })),
}));

describe('TypeORM migration discovery', () => {
  let migrationsDir: string;
  const originalEnv = process.env;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'sto-migrations-'));
    process.env = {
      ...originalEnv,
      DB_TYPE: 'postgres',
      TYPEORM_ENTITIES: 'src/**/*.entity.ts',
      TYPEORM_MIGRATIONS: join(migrationsDir, '**/*.{js,ts}'),
    };
    await mkdir(join(migrationsDir, 'nested'));
    await mkdir(join(migrationsDir, 'directory.ts'));
    await Promise.all(
      [
        'migration.ts',
        'nested/migration.js',
        'migration.spec.ts',
        'nested/migration.test.ts',
        'migration.d.ts',
      ].map(file => writeFile(join(migrationsDir, file), '')),
    );
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it('returns absolute JS and TS file paths, excluding tests, declarations, and directories', async () => {
    const config = await getTypeOrmConfig();

    expect(config.migrations).toEqual(
      expect.arrayContaining([
        join(migrationsDir, 'migration.ts'),
        join(migrationsDir, 'nested/migration.js'),
      ]),
    );
    expect(config.migrations).toHaveLength(2);
  });

  it('resolves relative patterns from the project root', async () => {
    process.env.TYPEORM_MIGRATIONS = 'test/typeorm.config.spec.{js,ts}';

    const config = await getTypeOrmConfig();

    expect(config.migrations).toEqual([]);
    process.env.TYPEORM_MIGRATIONS = 'config/typeorm.config.{js,ts}';

    const relativeConfig = await getTypeOrmConfig();

    expect(relativeConfig.migrations).toEqual([
      resolve(__dirname, '../config/typeorm.config.ts'),
    ]);
  });

  it('returns no migrations when the pattern has no matches', async () => {
    process.env.TYPEORM_MIGRATIONS = join(migrationsDir, 'missing/*.ts');

    const config = await getTypeOrmConfig();

    expect(config.migrations).toEqual([]);
  });
});
