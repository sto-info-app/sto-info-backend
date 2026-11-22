import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import { GroupConflictingRosterImports1793900000000 } from '../../../database/migrations/1793900000000-GroupConflictingRosterImports';
import { RecordRosterImportCorrections1794300000000 } from '../../../database/migrations/1794300000000-RecordRosterImportCorrections';
import { RosterImportConflictEntity } from './roster-import-conflict.entity';

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
 * Holds the conflict-group entity and its hand-written migration to each
 * other, as the import and observation alignment specs do for theirs. It
 * proves the two descriptions agree, not that PostgreSQL accepts either.
 */
describe('Roster import conflict schema alignment', () => {
  const migration = new GroupConflictingRosterImports1793900000000();
  const corrections = new RecordRosterImportCorrections1794300000000();
  let statements: string[];

  beforeAll(async () => {
    // Every migration that shapes this table, in the order they run: FC-019
    // added the selection and made the group one per instant.
    statements = [
      ...(await capture(queryRunner => migration.up(queryRunner))),
      ...(await capture(queryRunner => corrections.up(queryRunner))),
    ];
  });

  const createTable = (): string => {
    const found = statements.find(statement =>
      statement.includes(
        'CREATE TABLE "sto_info_app"."fleet_roster_import_conflict"',
      ),
    );

    if (found === undefined) {
      throw new Error('Migration does not create fleet_roster_import_conflict');
    }

    return found;
  };

  const sqlLines = (): string[] =>
    createTable()
      .split('\n')
      .map(line => line.trim());

  it('declares exactly the columns the migration creates', () => {
    const entityColumns = getMetadataArgsStorage()
      .columns.filter(column => column.target === RosterImportConflictEntity)
      .map(column => column.options.name ?? column.propertyName);

    const migrationColumns = [
      ...sqlLines()
        .filter(line => line.startsWith('"'))
        .map(line => line.slice(1, line.indexOf('"', 1))),
      ...statements
        .map(statement =>
          /ALTER TABLE "sto_info_app"\."fleet_roster_import_conflict" ADD "([^"]+)" /.exec(
            statement,
          ),
        )
        .filter(match => match !== null)
        .map(match => match[1]),
    ];

    expect([...migrationColumns].sort()).toEqual([...entityColumns].sort());
  });

  // ADR-0007 from the other side: the entity has to ask for timestamptz too.
  it('types every instant column as timestamptz in both places', () => {
    const declared = getMetadataArgsStorage()
      .columns.filter(column => column.target === RosterImportConflictEntity)
      .filter(column => column.options.type === 'timestamptz')
      .map(column => column.options.name ?? column.propertyName);

    expect(declared).toEqual(
      expect.arrayContaining(['exportedAt', 'openedAt', 'resolvedAt']),
    );

    for (const column of declared) {
      expect(sqlLines()).toContainEqual(
        expect.stringMatching(new RegExp(`^"${column}" timestamptz(?![a-z])`)),
      );
    }
  });

  // One group per Fleet and instant, ever: a newcomer for a settled instant
  // reopens its group, and the selection already made stays in force.
  it('allows one group per Fleet and instant, settled or not', () => {
    const index = getMetadataArgsStorage().indices.find(
      candidate => candidate.name === 'UX_roster_import_conflict_instant',
    );

    expect(index).toEqual(
      expect.objectContaining({
        target: RosterImportConflictEntity,
        columns: ['fleetId', 'exportedAt'],
        unique: true,
      }),
    );
    expect(index?.where).toBeUndefined();
    expect(statements).toContainEqual(
      `CREATE UNIQUE INDEX "UX_roster_import_conflict_instant" ON "sto_info_app"."fleet_roster_import_conflict" ("fleetId", "exportedAt")`,
    );
    expect(statements).toContainEqual(
      `DROP INDEX "sto_info_app"."UX_roster_import_conflict_open"`,
    );
  });

  it('selects only an import in the group, and settles only with a selection', () => {
    const all = statements.join('\n');

    expect(all).toContain('FOREIGN KEY ("selectedImportId", "id")');
    expect(all).toContain(
      'REFERENCES "sto_info_app"."fleet_roster_import_source"("id", "conflictGroupId")',
    );
    expect(all).toContain(
      'CHECK ("resolvedAt" IS NULL OR "selectedImportId" IS NOT NULL)',
    );
  });

  it('restores the open-group index when the corrections are reverted', async () => {
    const reverted = await capture(queryRunner =>
      corrections.down(queryRunner),
    );

    expect(reverted).toContainEqual(
      `CREATE UNIQUE INDEX "UX_roster_import_conflict_open" ON "sto_info_app"."fleet_roster_import_conflict" ("fleetId", "exportedAt") WHERE "resolvedAt" IS NULL`,
    );
    expect(reverted.join('\n')).toContain('DROP COLUMN "selectedImportId"');
  });

  it('drops everything it created when reverted', async () => {
    const reverted = (
      await capture(queryRunner => migration.down(queryRunner))
    ).join('\n');

    expect(reverted).toContain(
      'DROP TABLE "sto_info_app"."fleet_roster_import_conflict"',
    );
    expect(reverted).toContain('DROP COLUMN "conflictGroupId"');
    expect(reverted).toContain(
      'DROP CONSTRAINT "FK_roster_import_source_conflict"',
    );
    expect(reverted).toContain(
      'DROP INDEX "sto_info_app"."IDX_roster_import_source_conflict"',
    );
  });
});
