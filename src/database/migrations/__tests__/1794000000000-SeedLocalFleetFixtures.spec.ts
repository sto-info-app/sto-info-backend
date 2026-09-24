import { jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import { FLEET_COMMUNITIES_ENABLED_SETTING_KEY } from '../../../fleet/constants/fleet-feature.constants';
import {
  LOCAL_FIXTURE_COMMUNITY_ID,
  LOCAL_FIXTURE_CONSOLE_FLEET_ID,
  LOCAL_FIXTURE_PC_FLEET_ID,
  SeedLocalFleetFixtures1794000000000,
} from '../1794000000000-SeedLocalFleetFixtures';

/** The owner the lookup finds, when it finds one. */
const OWNER_ID = 'b0b0b0b0-0000-4000-8000-000000000001';

/** One statement the migration sent, with what it was bound to. */
interface SentQuery {
  readonly sql: string;
  readonly parameters: unknown[];
}

/**
 * Migrations are excluded from coverage and run against a real database only
 * in rehearsal, so this spec asserts the SQL the migration emits.
 *
 * What matters most is what it does *not* do: anywhere but a developer's own
 * database it sends nothing at all, in either direction.
 */
describe('SeedLocalFleetFixtures1794000000000', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalOwnerEmail = process.env.DATASEED_FLEET_OWNER_EMAIL;

  afterEach(() => {
    restore('NODE_ENV', originalNodeEnv);
    restore('DATASEED_FLEET_OWNER_EMAIL', originalOwnerEmail);
  });

  /**
   * Runs one direction against a query runner that records what it is sent.
   *
   * @param direction - Which way to run.
   * @param answers - What a statement containing each key returns.
   * @returns What was sent, in order.
   */
  const runMigration = async (
    direction: 'up' | 'down',
    answers: Record<string, unknown> = {},
  ): Promise<SentQuery[]> => {
    const sent: SentQuery[] = [];
    const queryRunner = {
      query: jest.fn((sql: string, parameters: unknown[] = []) => {
        sent.push({ sql, parameters });

        const key = Object.keys(answers).find(candidate =>
          sql.includes(candidate),
        );

        return Promise.resolve(key === undefined ? [] : answers[key]);
      }),
    } as unknown as QueryRunner;

    await new SeedLocalFleetFixtures1794000000000()[direction](queryRunner);

    return sent;
  };

  /** The answers a local database with the owner and the worker gives. */
  const LOCAL_ANSWERS = {
    'FROM "sto_info_app"."user"': [{ id: OWNER_ID }],
    to_regclass: [{ scanAttempts: 'sto_info_worker.file_scan_attempt' }],
  };

  it('names the migration after its own class', () => {
    expect(new SeedLocalFleetFixtures1794000000000().name).toBe(
      'SeedLocalFleetFixtures1794000000000',
    );
  });

  describe.each(['dev', 'staging', 'prod', undefined])(
    'when NODE_ENV is %s',
    nodeEnv => {
      beforeEach(() => {
        restore('NODE_ENV', nodeEnv);
        process.env.DATASEED_FLEET_OWNER_EMAIL = 'owner@example.com';
      });

      it('seeds nothing', async () => {
        await expect(runMigration('up', LOCAL_ANSWERS)).resolves.toEqual([]);
      });

      it('removes nothing', async () => {
        await expect(runMigration('down', LOCAL_ANSWERS)).resolves.toEqual([]);
      });
    },
  );

  describe('on a local database', () => {
    beforeEach(() => {
      process.env.NODE_ENV = ' Local ';
      process.env.DATASEED_FLEET_OWNER_EMAIL = ' owner@example.com ';
    });

    it.each(['', '   '])(
      'seeds nothing when the owner email is %j',
      async email => {
        process.env.DATASEED_FLEET_OWNER_EMAIL = email;

        await expect(runMigration('up', LOCAL_ANSWERS)).resolves.toEqual([]);
      },
    );

    it('seeds nothing when the owner email is unset', async () => {
      delete process.env.DATASEED_FLEET_OWNER_EMAIL;

      await expect(runMigration('up', LOCAL_ANSWERS)).resolves.toEqual([]);
    });

    it('seeds nothing more when no live account has the email', async () => {
      const sent = await runMigration('up');

      expect(sent).toHaveLength(1);
      expect(sent[0].sql).toContain('lower("email") = lower($1)');
      expect(sent[0].sql).toContain('"deletedAt" IS NULL');
      expect(sent[0].parameters).toEqual(['owner@example.com']);
    });

    it('gives the Community to the account the email names', async () => {
      const sent = await runMigration('up', LOCAL_ANSWERS);
      const community = sent.find(query =>
        query.sql.includes('INSERT INTO "sto_info_app"."fleet_community"'),
      );

      expect(community?.sql).toContain("'Fixture Community'");
      expect(community?.sql).toContain("'fixture-community'");
      expect(community?.sql).toContain('ON CONFLICT ("id") DO NOTHING');
      expect(community?.parameters).toEqual([
        LOCAL_FIXTURE_COMMUNITY_ID,
        OWNER_ID,
      ]);
    });

    it('seeds a Windows Fleet named as the roster fixtures name it', async () => {
      const sent = await runMigration('up', LOCAL_ANSWERS);
      const fleet = sent.find(
        query => query.parameters[0] === LOCAL_FIXTURE_PC_FLEET_ID,
      );

      expect(fleet?.sql).toContain('INSERT INTO "sto_info_app"."sto_fleet"');
      expect(fleet?.sql).toContain('ON CONFLICT ("id") DO NOTHING');
      expect(fleet?.parameters).toEqual([
        LOCAL_FIXTURE_PC_FLEET_ID,
        LOCAL_FIXTURE_COMMUNITY_ID,
        'Fixture Basic Fleet',
        'fixture basic fleet',
        'fixture-basic-fleet',
        'Windows',
      ]);
    });

    it('seeds a PlayStation Fleet, where the game writes no export', async () => {
      const sent = await runMigration('up', LOCAL_ANSWERS);
      const fleet = sent.find(
        query => query.parameters[0] === LOCAL_FIXTURE_CONSOLE_FLEET_ID,
      );

      expect(fleet?.parameters).toEqual([
        LOCAL_FIXTURE_CONSOLE_FLEET_ID,
        LOCAL_FIXTURE_COMMUNITY_ID,
        'Fixture Console Fleet',
        'fixture console fleet',
        'fixture-console-fleet',
        'PlayStation',
      ]);
    });

    /**
     * Read from the constant the service uses rather than typed again here,
     * so a seed that switched on a key nobody reads would fail.
     */
    it('switches the feature on last', async () => {
      const sent = await runMigration('up', LOCAL_ANSWERS);
      const last = sent[sent.length - 1];

      expect(last.sql).toContain(`SET "value" = 'true'`);
      expect(last.parameters).toEqual([FLEET_COMMUNITIES_ENABLED_SETTING_KEY]);
    });

    it('removes each row before whatever it points at', async () => {
      const sent = await runMigration('down', LOCAL_ANSWERS);
      const deleted = sent
        .map(query => /DELETE FROM ("[a-z_]+"\."[a-z_]+")/.exec(query.sql))
        .filter(match => match !== null)
        .map(match => match[1]);

      expect(deleted).toEqual([
        '"sto_info_app"."character_fleet_membership"',
        '"sto_info_app"."character_fleet_proposal"',
        '"sto_info_app"."fleet_roster_import_source"',
        '"sto_info_app"."fleet_roster_import_conflict"',
        '"sto_info_app"."file_asset_placement"',
        '"sto_info_worker"."file_scan_attempt"',
        '"sto_info_app"."file_asset"',
        '"sto_info_app"."fleet_slug_history"',
        '"sto_info_app"."sto_fleet"',
        '"sto_info_app"."fleet_community"',
      ]);
    });

    it('removes only what hangs off the seeded Community', async () => {
      const sent = await runMigration('down', LOCAL_ANSWERS);

      for (const query of sent.filter(each => each.sql.includes('DELETE'))) {
        expect(query.parameters).toEqual([LOCAL_FIXTURE_COMMUNITY_ID]);
      }
    });

    it('takes the files held by the Community, its Fleets and its Armadas', async () => {
      const sent = await runMigration('down', LOCAL_ANSWERS);
      const assets = sent.find(query =>
        query.sql.includes('DELETE FROM "sto_info_app"."file_asset" '),
      );

      expect(assets?.sql).toContain('"communityId" = $1');
      expect(assets?.sql).toContain('"fleetId" IN (');
      expect(assets?.sql).toContain('"armadaId" IN (');
    });

    it('leaves the scanner alone where the worker has never migrated', async () => {
      const sent = await runMigration('down', {
        to_regclass: [{ scanAttempts: null }],
      });

      expect(sent.some(query => query.sql.includes('"sto_info_worker"'))).toBe(
        false,
      );
      expect(
        sent.some(query =>
          query.sql.includes('DELETE FROM "sto_info_app"."fleet_community"'),
        ),
      ).toBe(true);
    });

    it('switches the feature off last', async () => {
      const sent = await runMigration('down', LOCAL_ANSWERS);
      const last = sent[sent.length - 1];

      expect(last.sql).toContain(`SET "value" = 'false'`);
      expect(last.parameters).toEqual([FLEET_COMMUNITIES_ENABLED_SETTING_KEY]);
    });
  });
});

/**
 * Puts an environment variable back as it was.
 *
 * @param name - The variable.
 * @param value - Its value before, or undefined when it was unset.
 */
function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
