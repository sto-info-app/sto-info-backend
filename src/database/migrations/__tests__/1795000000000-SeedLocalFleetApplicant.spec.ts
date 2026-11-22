import { jest } from '@jest/globals';
import * as bcrypt from 'bcrypt';
import { QueryRunner } from 'typeorm';

import {
  LOCAL_APPLICANT_ACCOUNT_ID,
  LOCAL_APPLICANT_CHARACTER_ID,
  LOCAL_APPLICANT_USER_ID,
  SeedLocalFleetApplicant1795000000000,
} from '../1795000000000-SeedLocalFleetApplicant';

/** One statement the migration sent, with what it was bound to. */
interface SentQuery {
  readonly sql: string;
  readonly parameters: unknown[];
}

const VARIABLES = [
  'NODE_ENV',
  'DATASEED_FLEET_APPLICANT_EMAIL',
  'DATASEED_FLEET_APPLICANT_USERNAME',
  'DATASEED_FLEET_APPLICANT_PASSWORD',
  'AUTH_SALT_ROUNDS',
] as const;

/**
 * Migrations are excluded from coverage and run against a real database only
 * locally, so this spec asserts the SQL the seed emits — and, most of all,
 * that anywhere but a developer's own database it sends nothing.
 */
describe('SeedLocalFleetApplicant1795000000000', () => {
  const original = Object.fromEntries(
    VARIABLES.map(name => [name, process.env[name]]),
  );

  beforeEach(() => {
    process.env.NODE_ENV = 'local';
    process.env.DATASEED_FLEET_APPLICANT_EMAIL = ' applicant@example.test ';
    process.env.DATASEED_FLEET_APPLICANT_USERNAME = ' FleetApplicant ';
    process.env.DATASEED_FLEET_APPLICANT_PASSWORD = 'not-a-real-secret';
    process.env.AUTH_SALT_ROUNDS = '4';
  });

  afterEach(() => {
    for (const name of VARIABLES) {
      if (original[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = original[name];
      }
    }
  });

  /**
   * Runs one direction against a query runner that records what it is sent.
   *
   * @param direction - Which way to run.
   * @param existing - The accounts the email lookup finds.
   * @returns What was sent, in order.
   */
  const run = async (
    direction: 'up' | 'down',
    existing: { id: string }[] = [],
  ): Promise<SentQuery[]> => {
    const sent: SentQuery[] = [];
    const queryRunner = {
      query: jest.fn((sql: string, parameters: unknown[] = []) => {
        sent.push({ sql, parameters });

        return Promise.resolve(
          sql.startsWith('SELECT "id" FROM "sto_info_app"."user"')
            ? existing
            : [],
        );
      }),
    } as unknown as QueryRunner;

    await new SeedLocalFleetApplicant1795000000000()[direction](queryRunner);

    return sent;
  };

  it('names the migration after its own class', () => {
    expect(new SeedLocalFleetApplicant1795000000000().name).toBe(
      'SeedLocalFleetApplicant1795000000000',
    );
  });

  it.each(['dev', 'staging', 'prod', undefined])(
    'sends nothing either way when NODE_ENV is %s',
    async nodeEnv => {
      if (nodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = nodeEnv;
      }

      await expect(run('up')).resolves.toEqual([]);
      await expect(run('down')).resolves.toEqual([]);
    },
  );

  it.each([
    'DATASEED_FLEET_APPLICANT_EMAIL',
    'DATASEED_FLEET_APPLICANT_USERNAME',
    'DATASEED_FLEET_APPLICANT_PASSWORD',
  ] as const)('seeds nothing without %s', async name => {
    delete process.env[name];

    await expect(run('up')).resolves.toEqual([]);
  });

  it('makes the applicant with a hashed password, verified, then their account and Character', async () => {
    const sent = await run('up');

    const user = sent.find(query =>
      query.sql.includes('INSERT INTO "sto_info_app"."user"'),
    );
    expect(user?.parameters.slice(0, 2)).toEqual([
      LOCAL_APPLICANT_USER_ID,
      'applicant@example.test',
    ]);
    await expect(
      bcrypt.compare('not-a-real-secret', user?.parameters[2] as string),
    ).resolves.toBe(true);
    expect(user?.sql).toContain('true)');

    expect(
      sent.find(query => query.sql.includes('"user_profile"'))?.parameters,
    ).toEqual([LOCAL_APPLICANT_USER_ID, 'FleetApplicant']);
    expect(
      sent.find(query => query.sql.includes('"sto_info_app"."account"'))
        ?.parameters,
    ).toEqual([
      LOCAL_APPLICANT_ACCOUNT_ID,
      LOCAL_APPLICANT_USER_ID,
      'fixture002',
    ]);

    const character = sent.find(query =>
      query.sql.includes('INSERT INTO "sto_info_app"."character"'),
    );
    expect(character?.parameters).toEqual([
      LOCAL_APPLICANT_CHARACTER_ID,
      LOCAL_APPLICANT_ACCOUNT_ID,
      'Dax Orlan',
      'Dax Orlan@fixture002',
    ]);
    expect(character?.sql).toContain(`"name" = 'Starfleet (2409)'`);
  });

  it('never writes the password itself', async () => {
    const sent = await run('up');

    for (const query of sent) {
      expect(query.parameters).not.toContain('not-a-real-secret');
    }
  });

  it('hashes with the default cost when none is configured', async () => {
    delete process.env.AUTH_SALT_ROUNDS;

    const sent = await run('up');

    expect(sent.some(query => query.sql.includes('"user_profile"'))).toBe(true);
  });

  it('gives an existing person the account and Character, making nobody new', async () => {
    const sent = await run('up', [{ id: 'existing-user' }]);

    expect(
      sent.some(query =>
        query.sql.includes('INSERT INTO "sto_info_app"."user"'),
      ),
    ).toBe(false);
    expect(
      sent.find(query => query.sql.includes('"sto_info_app"."account"'))
        ?.parameters[1],
    ).toBe('existing-user');
  });

  it('removes the Character, the account and the person it made, in that order', async () => {
    const sent = await run('down');

    expect(sent.map(query => query.parameters[0])).toEqual([
      LOCAL_APPLICANT_CHARACTER_ID,
      LOCAL_APPLICANT_ACCOUNT_ID,
      LOCAL_APPLICANT_USER_ID,
      LOCAL_APPLICANT_USER_ID,
    ]);
  });
});
