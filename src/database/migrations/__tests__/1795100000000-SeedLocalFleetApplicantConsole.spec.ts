import { jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import {
  LOCAL_APPLICANT_CONSOLE_ACCOUNT_ID,
  LOCAL_APPLICANT_CONSOLE_CHARACTER_ID,
  SeedLocalFleetApplicantConsole1795100000000,
} from '../1795100000000-SeedLocalFleetApplicantConsole';

/** One statement the migration sent, with what it was bound to. */
interface SentQuery {
  readonly sql: string;
  readonly parameters: unknown[];
}

const VARIABLES = ['NODE_ENV', 'DATASEED_FLEET_APPLICANT_EMAIL'] as const;

/**
 * Migrations are excluded from coverage and run against a real database only
 * locally, so this spec asserts the SQL the seed emits — and, most of all,
 * that anywhere but a developer's own database it sends nothing.
 */
describe('SeedLocalFleetApplicantConsole1795100000000', () => {
  const original = Object.fromEntries(
    VARIABLES.map(name => [name, process.env[name]]),
  );

  beforeEach(() => {
    process.env.NODE_ENV = 'local';
    process.env.DATASEED_FLEET_APPLICANT_EMAIL = ' applicant@example.test ';
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
   * @param existing - The people the email lookup finds.
   * @returns What was sent, in order.
   */
  const run = async (
    direction: 'up' | 'down',
    existing: { id: string }[] = [{ id: 'applicant-1' }],
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

    await new SeedLocalFleetApplicantConsole1795100000000()[direction](
      queryRunner,
    );

    return sent;
  };

  it('names the migration after its own class', () => {
    expect(new SeedLocalFleetApplicantConsole1795100000000().name).toBe(
      'SeedLocalFleetApplicantConsole1795100000000',
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

  it('seeds nothing without the applicant’s address', async () => {
    delete process.env.DATASEED_FLEET_APPLICANT_EMAIL;

    await expect(run('up')).resolves.toEqual([]);
  });

  it('seeds nothing for an applicant who does not exist yet', async () => {
    const sent = await run('up', []);

    expect(sent).toHaveLength(1);
    expect(sent[0].parameters).toEqual(['applicant@example.test']);
  });

  it('gives the applicant a PlayStation account and Character', async () => {
    const sent = await run('up');

    const account = sent.find(query =>
      query.sql.includes('INSERT INTO "sto_info_app"."account"'),
    );
    expect(account?.parameters).toEqual([
      LOCAL_APPLICANT_CONSOLE_ACCOUNT_ID,
      'applicant-1',
      'fixtureps002',
    ]);
    expect(account?.sql).toContain(`"name" = 'PlayStation'`);

    const character = sent.find(query =>
      query.sql.includes('INSERT INTO "sto_info_app"."character"'),
    );
    expect(character?.parameters).toEqual([
      LOCAL_APPLICANT_CONSOLE_CHARACTER_ID,
      LOCAL_APPLICANT_CONSOLE_ACCOUNT_ID,
      'Kira Venn',
      'Kira Venn@fixtureps002',
    ]);
    expect(character?.sql).toContain(`"name" = 'Starfleet (2409)'`);
  });

  it('removes the Character, then the account', async () => {
    const sent = await run('down');

    expect(sent.map(query => query.parameters[0])).toEqual([
      LOCAL_APPLICANT_CONSOLE_CHARACTER_ID,
      LOCAL_APPLICANT_CONSOLE_ACCOUNT_ID,
    ]);
  });
});
