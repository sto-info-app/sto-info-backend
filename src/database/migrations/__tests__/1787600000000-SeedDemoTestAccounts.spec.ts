import { SeedDemoTestAccounts1787600000000 } from '../1787600000000-SeedDemoTestAccounts';

describe('SeedDemoTestAccounts1787600000000', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSeedPassword = process.env.DATASEED_USER_PASSWORD;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }

    if (originalSeedPassword === undefined) {
      delete process.env.DATASEED_USER_PASSWORD;
    } else {
      process.env.DATASEED_USER_PASSWORD = originalSeedPassword;
    }

    jest.restoreAllMocks();
  });

  it('still seeds basic user and account data when lookup tables are unavailable', async () => {
    process.env.NODE_ENV = 'local';
    process.env.DATASEED_USER_PASSWORD = 'Test1234!';

    const queryRunner = {
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      hasTable: jest.fn().mockResolvedValue(false),
      query: jest.fn().mockResolvedValue(undefined),
    };

    const migration = new SeedDemoTestAccounts1787600000000();
    await migration.up(queryRunner as never);

    const userInsert = queryRunner.query.mock.calls.find((call: unknown[]) =>
      String(call[0]).includes('INSERT INTO "sto_info_app"."user"'),
    );
    const accountInsert = queryRunner.query.mock.calls.find((call: unknown[]) =>
      String(call[0]).includes('INSERT INTO "sto_info_app"."account"'),
    );

    expect(userInsert).toBeDefined();
    expect(accountInsert).toBeDefined();
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
  });
});
