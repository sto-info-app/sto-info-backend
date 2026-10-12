import * as bcrypt from 'bcrypt';

import { EnsureSeedUser1790000550000 } from '../1790000550000-EnsureSeedUser';

const SEED_VARIABLES = [
  'DATASEED_USER_EMAIL',
  'DATASEED_USER_USERNAME',
  'DATASEED_USER_FIRSTNAME',
  'DATASEED_USER_LASTNAME',
  'DATASEED_USER_PASSWORD',
] as const;

describe('EnsureSeedUser1790000550000', () => {
  const original: Record<string, string | undefined> = {};
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    for (const name of ['NODE_ENV', 'AUTH_SALT_ROUNDS', ...SEED_VARIABLES]) {
      original[name] = process.env[name];
    }

    process.env.NODE_ENV = 'e2etest';
    process.env.AUTH_SALT_ROUNDS = '4';
    process.env.DATASEED_USER_EMAIL = 'seed@example.com';
    process.env.DATASEED_USER_USERNAME = 'seed-user';
    process.env.DATASEED_USER_FIRSTNAME = 'Seed';
    process.env.DATASEED_USER_LASTNAME = 'User';
    process.env.DATASEED_USER_PASSWORD = '"Seed1234!"';

    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }

    jest.restoreAllMocks();
  });

  function runner(existing: Array<{ id: string }> = []) {
    const query = jest
      .fn<Promise<unknown>, [string, unknown[]?]>()
      .mockResolvedValueOnce(existing)
      .mockResolvedValue([]);

    return { query };
  }

  it('does nothing in production', async () => {
    process.env.NODE_ENV = 'prod';
    const queryRunner = runner();

    await new EnsureSeedUser1790000550000().up(queryRunner as never);

    expect(queryRunner.query).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it.each(SEED_VARIABLES)(
    'skips with a notice when %s is unset',
    async name => {
      delete process.env[name];
      const queryRunner = runner();

      await new EnsureSeedUser1790000550000().up(queryRunner as never);

      expect(queryRunner.query).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`${name} is not set`),
      );
    },
  );

  it('treats a blank variable as unset', async () => {
    process.env.DATASEED_USER_LASTNAME = '   ';
    const queryRunner = runner();

    await new EnsureSeedUser1790000550000().up(queryRunner as never);

    expect(queryRunner.query).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('DATASEED_USER_LASTNAME is not set'),
    );
  });

  it('leaves an existing seed user alone', async () => {
    const queryRunner = runner([{ id: 'existing-id' }]);

    await new EnsureSeedUser1790000550000().up(queryRunner as never);

    expect(queryRunner.query).toHaveBeenCalledTimes(1);
    expect(queryRunner.query.mock.calls[0][1]).toEqual(['seed@example.com']);
  });

  it('creates the user and profile when the seed user is missing', async () => {
    const queryRunner = runner();

    await new EnsureSeedUser1790000550000().up(queryRunner as never);

    expect(queryRunner.query).toHaveBeenCalledTimes(3);

    const [, userInsert, profileInsert] = queryRunner.query.mock.calls;
    const [userId, email, passwordHash] = userInsert[1] as string[];

    expect(userInsert[0]).toContain('INSERT INTO "sto_info_app"."user"');
    expect(email).toBe('seed@example.com');
    await expect(bcrypt.compare('Seed1234!', passwordHash)).resolves.toBe(true);

    expect(profileInsert[0]).toContain(
      'INSERT INTO "sto_info_app"."user_profile"',
    );
    expect(profileInsert[1]).toEqual([userId, 'seed-user', 'Seed', 'User']);
  });

  it('leaves the seed user in place on revert', async () => {
    await expect(
      new EnsureSeedUser1790000550000().down(),
    ).resolves.toBeUndefined();
  });
});
