import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import { CreateFleetHoldings1795400000000 } from '../../../database/migrations/1795400000000-CreateFleetHoldings';
import { FleetHoldingChangeEntity } from './fleet-holding-change.entity';
import { FleetHoldingHistoryEntity } from './fleet-holding-history.entity';
import { FleetHoldingStatusEntity } from './fleet-holding-status.entity';
import { FleetHoldingTierEntity } from './fleet-holding-tier.entity';
import { FleetHoldingTrackEntity } from './fleet-holding-track.entity';
import { FleetHoldingTypeEntity } from './fleet-holding-type.entity';

/**
 * Runs a migration step and keeps every statement it issues.
 *
 * @param step - The step to run.
 * @returns What it sent to the database, in order.
 */
async function capture(
  step: (queryRunner: QueryRunner) => Promise<void>,
): Promise<string[]> {
  const captured: string[] = [];
  const queryRunner = {
    query: jest.fn((sql: string) => {
      captured.push(sql);

      return Promise.resolve();
    }),
  } as unknown as QueryRunner;

  await step(queryRunner);

  return captured;
}

/**
 * Holds the holdings entities and their hand-written migration to each
 * other, and checks the catalogue it seeds. It proves the two descriptions
 * agree, not that PostgreSQL accepts either: the constraints and triggers
 * were rehearsed against the local database, 19 statements each refused or
 * allowed as intended.
 */
describe('Holdings schema alignment', () => {
  const migration = new CreateFleetHoldings1795400000000();
  let statements: string[];

  beforeAll(async () => {
    statements = await capture(queryRunner => migration.up(queryRunner));
  });

  const createTable = (table: string): string => {
    const found = statements.find(statement =>
      statement.includes(`CREATE TABLE "sto_info_app"."${table}" (`),
    );

    if (found === undefined) {
      throw new Error(`Migration does not create ${table}`);
    }

    return found;
  };

  const sqlLines = (table: string): string[] =>
    createTable(table)
      .split('\n')
      .map(line => line.trim());

  const declared = (entity: abstract new () => unknown) =>
    getMetadataArgsStorage().columns.filter(column => column.target === entity);

  const inserted = (table: string): string => {
    const found = statements.find(statement =>
      statement.startsWith(`INSERT INTO "sto_info_app"."${table}"`),
    );

    if (found === undefined) {
      throw new Error(`Migration does not seed ${table}`);
    }

    return found;
  };

  const TABLES: [string, abstract new () => unknown][] = [
    ['fleet_holding_type', FleetHoldingTypeEntity],
    ['fleet_holding_track', FleetHoldingTrackEntity],
    ['fleet_holding_tier', FleetHoldingTierEntity],
    ['fleet_holding_status', FleetHoldingStatusEntity],
    ['fleet_holding_change', FleetHoldingChangeEntity],
    ['fleet_holding_history', FleetHoldingHistoryEntity],
  ];

  it.each(TABLES)(
    'declares exactly the columns %s is created with',
    (table, entity) => {
      const migrationColumns = sqlLines(table)
        .filter(line => line.startsWith('"'))
        .map(line => line.slice(1, line.indexOf('"', 1)));

      expect([...migrationColumns].sort()).toEqual(
        declared(entity)
          .map(column => column.options.name ?? column.propertyName)
          .sort(),
      );
    },
  );

  it.each(TABLES)(
    'types every instant column of %s as timestamptz in both places',
    (table, entity) => {
      const instants = declared(entity)
        .filter(column => column.options.type === 'timestamptz')
        .map(column => column.propertyName);

      for (const column of instants) {
        expect(sqlLines(table)).toContainEqual(
          expect.stringMatching(
            new RegExp(`^"${column}" timestamptz(?![a-z])`),
          ),
        );
      }
    },
  );

  it('seeds seven holdings from the STO Wiki, as catalogue version 1', () => {
    const holdings = inserted('fleet_holding_type');

    for (const name of [
      'Fleet Starbase',
      'Fleet Embassy',
      'Fleet Dilithium Mine',
      'Fleet Spire',
      'Fleet Research Lab',
      'Deep Space K-13',
      'Fleet Colony World',
    ]) {
      expect(holdings).toContain(`'${name}'`);
    }
    expect(
      holdings.match(/'https:\/\/stowiki\.net\/wiki\/[^']+'/g),
    ).toHaveLength(7);
    expect(holdings.match(/, 1\)/g)).toHaveLength(7);
  });

  it('seeds tiers that make a fully upgraded Fleet level 85', () => {
    const tiers = [
      ...inserted('fleet_holding_tier').matchAll(/\('([A-Z0-9_]+)', (\d+)\)/g),
    ];
    const highest = new Map<string, number>();

    for (const [, track, tier] of tiers) {
      highest.set(track, Math.max(highest.get(track) ?? 0, Number(tier)));
    }

    expect(highest.size).toBe(23);
    expect([...highest.values()].reduce((sum, tier) => sum + tier, 0)).toBe(85);
    expect(highest.get('STARBASE_MILITARY')).toBe(5);
    expect(highest.get('K13_XENOTECH_RESEARCH')).toBe(3);
  });

  it('refuses a recorded tier the catalogue does not list', () => {
    expect(createTable('fleet_holding_history')).toContain(
      `FOREIGN KEY ("trackCode", "tier") REFERENCES "sto_info_app"."fleet_holding_tier"("trackCode", "tier")`,
    );
    expect(createTable('fleet_holding_status')).toContain(
      `FOREIGN KEY ("trackCode", "tier") REFERENCES "sto_info_app"."fleet_holding_tier"("trackCode", "tier")`,
    );
    expect(createTable('fleet_holding_history')).toContain(
      `CHECK ("tier" <> "tierBefore")`,
    );
  });

  it('keeps the change and its history write-once but for the recorder going', () => {
    const changeGuard = statements.find(statement =>
      statement.includes(
        'FUNCTION "sto_info_app"."fleet_holding_change_guard"',
      ),
    );

    expect(changeGuard).toContain(
      `(to_jsonb(NEW) - 'actorUserId') IS DISTINCT FROM (to_jsonb(OLD) - 'actorUserId')`,
    );
    for (const table of ['fleet_holding_change', 'fleet_holding_history']) {
      expect(statements).toContainEqual(
        expect.stringContaining(
          `CREATE TRIGGER "TR_${table}_guard" BEFORE UPDATE`,
        ),
      );
    }
  });

  it('drops everything it created when reverted', async () => {
    const reverted = (
      await capture(queryRunner => migration.down(queryRunner))
    ).join('\n');

    for (const table of TABLES.map(([name]) => name)) {
      expect(reverted).toContain(`DROP TABLE "sto_info_app"."${table}"`);
    }
    for (const guard of ['fleet_holding_change', 'fleet_holding_history']) {
      expect(reverted).toContain(`DROP TRIGGER IF EXISTS "TR_${guard}_guard"`);
      expect(reverted).toContain(
        `DROP FUNCTION IF EXISTS "sto_info_app"."${guard}_guard"()`,
      );
    }
  });
});
