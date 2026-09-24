import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import { RecordRosterImportCorrections1794300000000 } from '../../../database/migrations/1794300000000-RecordRosterImportCorrections';
import { RosterImportActionKind } from '../enums/roster-import-action-kind.enum';
import { RosterImportActionEntity } from './roster-import-action.entity';

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
 * Holds the import action entity and its hand-written migration to each
 * other, as the other roster alignment specs do for theirs. It proves the
 * two descriptions agree, not that PostgreSQL accepts either: the constraint
 * behaviour was rehearsed against the local database.
 */
describe('Roster import action schema alignment', () => {
  const migration = new RecordRosterImportCorrections1794300000000();
  let statements: string[];

  beforeAll(async () => {
    statements = await capture(queryRunner => migration.up(queryRunner));
  });

  const createTable = (): string => {
    const found = statements.find(statement =>
      statement.includes(
        'CREATE TABLE "sto_info_app"."fleet_roster_import_action"',
      ),
    );

    if (found === undefined) {
      throw new Error('Migration does not create fleet_roster_import_action');
    }

    return found;
  };

  const sqlLines = (): string[] =>
    createTable()
      .split('\n')
      .map(line => line.trim());

  it('declares exactly the columns the migration creates', () => {
    const entityColumns = getMetadataArgsStorage()
      .columns.filter(column => column.target === RosterImportActionEntity)
      .map(column => column.options.name ?? column.propertyName);

    const migrationColumns = sqlLines()
      .filter(line => line.startsWith('"'))
      .map(line => line.slice(1, line.indexOf('"', 1)));

    expect([...migrationColumns].sort()).toEqual([...entityColumns].sort());
  });

  // ADR-0007 from the other side: the entity has to ask for timestamptz too.
  it('types every instant column as timestamptz in both places', () => {
    const declared = getMetadataArgsStorage()
      .columns.filter(column => column.target === RosterImportActionEntity)
      .filter(column => column.options.type === 'timestamptz')
      .map(column => column.options.name ?? column.propertyName);

    expect(declared).toEqual(expect.arrayContaining(['actedAt', 'createdAt']));

    for (const column of declared) {
      expect(sqlLines()).toContainEqual(
        expect.stringMatching(new RegExp(`^"${column}" timestamptz(?![a-z])`)),
      );
    }
  });

  it('gives the enum exactly the actions the entity knows', () => {
    const values = Object.values(RosterImportActionKind)
      .map(value => `'${value}'`)
      .join(', ');

    expect(statements).toContainEqual(
      `CREATE TYPE "sto_info_app"."roster_import_action_enum" AS ENUM (${values})`,
    );
  });

  it('requires a reason that is not blank', () => {
    expect(sqlLines()).toContainEqual('"reason" varchar(500) NOT NULL,');
    expect(createTable()).toContain('CHECK (length(btrim("reason")) > 0)');
  });

  it('names a conflict group on a selection and on nothing else', () => {
    expect(createTable()).toContain(
      `CHECK (("action" = 'CONFLICT_SELECTED') = ("conflictGroupId" IS NOT NULL))`,
    );
  });

  it('keeps every action write-once but for its actor', () => {
    const guard = statements.find(statement =>
      statement.includes(
        'FUNCTION "sto_info_app"."roster_import_action_guard"',
      ),
    );

    expect(guard).toContain(
      `(to_jsonb(NEW) - 'actorUserId') IS DISTINCT FROM (to_jsonb(OLD) - 'actorUserId')`,
    );
    expect(statements).toContainEqual(
      expect.stringContaining(
        'CREATE TRIGGER "TR_roster_import_action_guard" BEFORE UPDATE',
      ),
    );
  });

  it('drops everything it created when reverted', async () => {
    const reverted = (
      await capture(queryRunner => migration.down(queryRunner))
    ).join('\n');

    for (const expected of [
      'DROP TRIGGER IF EXISTS "TR_roster_import_action_guard"',
      'DROP FUNCTION IF EXISTS "sto_info_app"."roster_import_action_guard"()',
      'DROP TABLE "sto_info_app"."fleet_roster_import_action"',
      'DROP TYPE "sto_info_app"."roster_import_action_enum"',
      'DROP CONSTRAINT "UQ_roster_import_source_conflict_member"',
      'DROP COLUMN "excluded"',
      'DROP COLUMN "partial"',
    ]) {
      expect(reverted).toContain(expected);
    }
  });
});
