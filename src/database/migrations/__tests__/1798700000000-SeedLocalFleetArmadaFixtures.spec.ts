import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { QueryRunner } from 'typeorm';

import { LOCAL_FIXTURE_COMMUNITY_ID } from '../1794000000000-SeedLocalFleetFixtures';
import {
  LOCAL_ALPHA_ARMADA_ID,
  LOCAL_BETA_ARMADA_ID,
  LOCAL_FLEET_IDS,
  LOCAL_MOVE_REQUEST_ID,
  LOCAL_PLACEMENT_IDS,
  LOCAL_PRIVATE_COMMUNITY_ID,
  LOCAL_SECOND_COMMUNITY_ID,
  SeedLocalFleetArmadaFixtures1798700000000,
} from '../1798700000000-SeedLocalFleetArmadaFixtures';

const OWNER_ID = 'b0b0b0b0-0000-4000-8000-000000000001';

interface SentQuery {
  readonly sql: string;
  readonly parameters: unknown[];
}

describe('SeedLocalFleetArmadaFixtures1798700000000', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalOwnerEmail = process.env.DATASEED_FLEET_OWNER_EMAIL;

  /**
   * Puts an environment variable back as it was.
   *
   * @param name - The variable.
   * @param value - Its original value, or undefined for unset.
   */
  function restore(name: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  afterEach(() => {
    restore('NODE_ENV', originalNodeEnv);
    restore('DATASEED_FLEET_OWNER_EMAIL', originalOwnerEmail);
  });

  /**
   * Runs a direction of the migration and keeps what it sends.
   *
   * @param direction - Which.
   * @param owners - What the owner lookup answers.
   * @returns Every query, in order.
   */
  const runMigration = async (
    direction: 'up' | 'down',
    owners: { id: string }[] = [],
  ): Promise<SentQuery[]> => {
    const sent: SentQuery[] = [];
    const queryRunner = {
      query: jest.fn((sql: string, parameters: unknown[] = []) => {
        sent.push({ sql, parameters });

        return Promise.resolve(
          sql.includes('FROM "sto_info_app"."user"') ? owners : [],
        );
      }),
    } as unknown as QueryRunner;

    await new SeedLocalFleetArmadaFixtures1798700000000()[direction](
      queryRunner,
    );

    return sent;
  };

  describe.each(['dev', 'staging', 'prod', undefined])(
    'when NODE_ENV is %s',
    nodeEnv => {
      beforeEach(() => {
        restore('NODE_ENV', nodeEnv);
        process.env.DATASEED_FLEET_OWNER_EMAIL = 'owner@example.com';
      });

      it('seeds nothing', async () => {
        await expect(runMigration('up', [{ id: OWNER_ID }])).resolves.toEqual(
          [],
        );
      });

      it('removes nothing', async () => {
        await expect(runMigration('down')).resolves.toEqual([]);
      });
    },
  );

  describe('on a local database', () => {
    beforeEach(() => {
      process.env.NODE_ENV = ' Local ';
      process.env.DATASEED_FLEET_OWNER_EMAIL = ' owner@example.com ';
    });

    it('seeds nothing without an owner email, or without an account for it', async () => {
      delete process.env.DATASEED_FLEET_OWNER_EMAIL;
      await expect(runMigration('up')).resolves.toEqual([]);

      process.env.DATASEED_FLEET_OWNER_EMAIL = 'owner@example.com';
      const sent = await runMigration('up');

      expect(sent).toHaveLength(1);
      expect(sent[0].sql).toContain('lower("email") = lower($1)');
      expect(sent[0].parameters).toEqual(['owner@example.com']);
    });

    it('gives the two new Communities to the owner, one of them members-only', async () => {
      const sent = await runMigration('up', [{ id: OWNER_ID }]);
      const communities = sent.find(query =>
        query.sql.includes('INSERT INTO "sto_info_app"."fleet_community"'),
      );

      expect(communities?.sql).toContain("'second-fixture-community'");
      expect(communities?.sql).toContain("'APPLICATION', 'PUBLIC'");
      expect(communities?.sql).toContain("'private-fixture-community'");
      expect(communities?.sql).toContain("'INVITE_ONLY', 'COMMUNITY'");
      expect(communities?.sql).toContain('ON CONFLICT ("id") DO NOTHING');
      expect(communities?.parameters).toEqual([
        LOCAL_SECOND_COMMUNITY_ID,
        OWNER_ID,
        LOCAL_PRIVATE_COMMUNITY_ID,
      ]);
    });

    it('puts two Federation Windows Armadas in the Fixture Community', async () => {
      const sent = await runMigration('up', [{ id: OWNER_ID }]);
      const armadas = sent.filter(query =>
        query.sql.includes('INSERT INTO "sto_info_app"."sto_armada"'),
      );

      expect(armadas.map(query => query.parameters)).toEqual([
        [
          LOCAL_ALPHA_ARMADA_ID,
          LOCAL_FIXTURE_COMMUNITY_ID,
          'Fixture Alpha Armada',
          'fixture alpha armada',
          'fixture-alpha-armada',
        ],
        [
          LOCAL_BETA_ARMADA_ID,
          LOCAL_FIXTURE_COMMUNITY_ID,
          'Fixture Beta Armada',
          'fixture beta armada',
          'fixture-beta-armada',
        ],
      ]);
      for (const query of armadas) {
        expect(query.sql).toContain(`"platform"."name" = 'Windows'`);
        expect(query.sql).toContain(`"faction"."name" = 'Federation'`);
      }
    });

    it('seeds every Fleet as public but the private Community’s, with its allegiance and platform', async () => {
      const sent = await runMigration('up', [{ id: OWNER_ID }]);
      const fleets = sent.filter(query =>
        query.sql.includes('INSERT INTO "sto_info_app"."sto_fleet"'),
      );

      expect(fleets).toHaveLength(Object.keys(LOCAL_FLEET_IDS).length);
      expect(
        fleets.map(query => [
          query.parameters[2],
          query.parameters[5],
          query.parameters[7],
          query.parameters[8],
        ]),
      ).toEqual([
        ['Fixture Alpha Fleet', 'Federation', 'Windows', 'PUBLIC'],
        ['Fixture Beta One', 'Federation', 'Windows', 'PUBLIC'],
        ['Fixture Beta Two', 'Federation', 'Windows', 'PUBLIC'],
        ['Fixture Gamma Fleet', 'Federation', 'Windows', 'PUBLIC'],
        ['Fixture Lead Fleet', 'Federation', 'Windows', 'PUBLIC'],
        ['Fixture Free Fleet', 'Federation', 'Windows', 'PUBLIC'],
        ['Fixture Klingon Fleet', 'Klingon', 'Windows', 'PUBLIC'],
        ['Second Fixture Fleet', 'Federation', 'Windows', 'PUBLIC'],
        ['Second Fixture Console Fleet', 'Klingon', 'Xbox', 'PUBLIC'],
        ['Private Fixture Fleet', 'Federation', 'Windows', 'COMMUNITY'],
      ]);
      expect(fleets[0].parameters[3]).toBe('fixture alpha fleet');
    });

    it('arranges the Alpha Armada as an Alpha, two Betas and a Gamma, and the Beta Armada as an Alpha alone', async () => {
      const sent = await runMigration('up', [{ id: OWNER_ID }]);
      const placements = sent.filter(query =>
        query.sql.includes(
          'INSERT INTO "sto_info_app"."armada_fleet_membership"',
        ),
      );

      expect(
        placements.map(query => [
          query.parameters[2],
          query.parameters[3],
          query.parameters[4],
          query.parameters[5],
        ]),
      ).toEqual([
        [LOCAL_ALPHA_ARMADA_ID, LOCAL_FLEET_IDS.alpha, 'ALPHA', null],
        [LOCAL_ALPHA_ARMADA_ID, LOCAL_FLEET_IDS.betaOne, 'BETA', null],
        [LOCAL_ALPHA_ARMADA_ID, LOCAL_FLEET_IDS.betaTwo, 'BETA', null],
        [
          LOCAL_ALPHA_ARMADA_ID,
          LOCAL_FLEET_IDS.gamma,
          'GAMMA',
          LOCAL_PLACEMENT_IDS.betaOne,
        ],
        [LOCAL_BETA_ARMADA_ID, LOCAL_FLEET_IDS.lead, 'ALPHA', null],
      ]);
      for (const query of placements) {
        expect(query.parameters[7]).toBe(OWNER_ID);
      }
    });

    it('leaves Beta Two a request open to move to the Beta Armada', async () => {
      const sent = await runMigration('up', [{ id: OWNER_ID }]);
      const request = sent.find(query =>
        query.sql.includes('INSERT INTO "sto_info_app"."armada_join_request"'),
      );

      expect(request?.sql).toContain('make_interval(days => 14)');
      expect(request?.parameters).toEqual([
        LOCAL_MOVE_REQUEST_ID,
        LOCAL_FIXTURE_COMMUNITY_ID,
        LOCAL_BETA_ARMADA_ID,
        LOCAL_FLEET_IDS.betaTwo,
        OWNER_ID,
      ]);
    });

    it('removes exactly what it made, dependants first', async () => {
      const sent = await runMigration('down');
      const tables = sent.map(
        query => /DELETE FROM "sto_info_app"\."(\w+)"/.exec(query.sql)?.[1],
      );

      expect(tables).toEqual([
        'armada_join_request',
        'armada_fleet_membership',
        'fleet_slug_history',
        'sto_fleet',
        'sto_armada',
        'fleet_community',
      ]);
      expect(sent[3].parameters).toEqual([Object.values(LOCAL_FLEET_IDS)]);
      expect(sent[5].parameters).toEqual([
        [LOCAL_SECOND_COMMUNITY_ID, LOCAL_PRIVATE_COMMUNITY_ID],
      ]);
    });
  });
});
