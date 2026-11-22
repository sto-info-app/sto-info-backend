import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import { CreateRosterRankOrder1794600000000 } from '../../../database/migrations/1794600000000-CreateRosterRankOrder';
import { RosterRankOrderActionEntity } from './roster-rank-order-action.entity';
import { RosterRankOrderEntity } from './roster-rank-order.entity';

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
 * Holds the two rank order entities and their hand-written migration to each
 * other, as the other roster alignment specs do for theirs. It proves the two
 * descriptions agree, not that PostgreSQL accepts either: the constraint
 * behaviour was rehearsed against the local database.
 */
describe('Roster rank order schema alignment', () => {
  const migration = new CreateRosterRankOrder1794600000000();
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

  it.each<[string, abstract new () => unknown]>([
    ['fleet_roster_rank_order', RosterRankOrderEntity],
    ['fleet_roster_rank_order_action', RosterRankOrderActionEntity],
  ])('declares exactly the columns %s is created with', (table, entity) => {
    const migrationColumns = sqlLines(table)
      .filter(line => line.startsWith('"'))
      .map(line => line.slice(1, line.indexOf('"', 1)));

    expect([...migrationColumns].sort()).toEqual(
      declared(entity)
        .map(column => column.options.name ?? column.propertyName)
        .sort(),
    );
  });

  // ADR-0007 from the other side: the entity has to ask for timestamptz too.
  it('types every instant column as timestamptz in both places', () => {
    const instants = declared(RosterRankOrderActionEntity)
      .filter(column => column.options.type === 'timestamptz')
      .map(column => column.propertyName);

    expect(instants).toEqual(expect.arrayContaining(['actedAt', 'createdAt']));

    for (const column of instants) {
      expect(sqlLines('fleet_roster_rank_order_action')).toContainEqual(
        expect.stringMatching(new RegExp(`^"${column}" timestamptz(?![a-z])`)),
      );
    }
  });

  it('places each label once per Fleet, in a tier from 1', () => {
    expect(createTable('fleet_roster_rank_order')).toContain(
      'PRIMARY KEY ("fleetId", "label")',
    );
    expect(createTable('fleet_roster_rank_order')).toContain(
      'CHECK ("tier" >= 1)',
    );
  });

  it('requires a reason that is not blank, and both orders as lists', () => {
    const table = createTable('fleet_roster_rank_order_action');

    expect(sqlLines('fleet_roster_rank_order_action')).toContainEqual(
      '"reason" varchar(500) NOT NULL,',
    );
    expect(table).toContain('CHECK (length(btrim("reason")) > 0)');
    expect(table).toContain(
      `CHECK (jsonb_typeof("tiersBefore") = 'array' AND jsonb_typeof("tiersAfter") = 'array')`,
    );
  });

  it('keeps every edit write-once but for its actor', () => {
    const guard = statements.find(statement =>
      statement.includes(
        'FUNCTION "sto_info_app"."roster_rank_order_action_guard"',
      ),
    );

    expect(guard).toContain(
      `(to_jsonb(NEW) - 'actorUserId') IS DISTINCT FROM (to_jsonb(OLD) - 'actorUserId')`,
    );
    expect(statements).toContainEqual(
      expect.stringContaining(
        'CREATE TRIGGER "TR_roster_rank_order_action_guard" BEFORE UPDATE',
      ),
    );
  });

  it('drops everything it created when reverted', async () => {
    const reverted = (
      await capture(queryRunner => migration.down(queryRunner))
    ).join('\n');

    for (const expected of [
      'DROP TRIGGER IF EXISTS "TR_roster_rank_order_action_guard"',
      'DROP FUNCTION IF EXISTS "sto_info_app"."roster_rank_order_action_guard"()',
      'DROP TABLE "sto_info_app"."fleet_roster_rank_order_action"',
      'DROP TABLE "sto_info_app"."fleet_roster_rank_order"',
    ]) {
      expect(reverted).toContain(expected);
    }
  });
});
