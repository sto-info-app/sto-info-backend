import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import { CreateRosterImportSource1792300000000 } from '../../../database/migrations/1792300000000-CreateRosterImportSource';
import { AddDeclaredContentTypeToRosterImportSource1792500000000 } from '../../../database/migrations/1792500000000-AddDeclaredContentTypeToRosterImportSource';
import { RosterImportSourceEntity } from './roster-import-source.entity';

/**
 * Holds the provenance entity and its hand-written migration to each other.
 *
 * The migration is raw SQL, so nothing generates one from the other and
 * nothing notices when they part company — a column added to the entity but
 * not to the migration fails at runtime on whichever query touches it first,
 * a long way from the change that caused it. Same reasoning as
 * `fleet-schema-alignment.spec.ts`, and the same limitation: this proves the
 * two descriptions agree, not that PostgreSQL accepts either. That is what the
 * migration rehearsal is for.
 */
describe('Roster import source schema alignment', () => {
  let statements: string[];

  beforeAll(async () => {
    const captured: string[] = [];
    const queryRunner = {
      query: jest.fn((sql: string) => {
        captured.push(sql);

        return Promise.resolve();
      }),
    } as unknown as QueryRunner;

    // Every migration that shapes this table, in the order they run. The
    // table is no longer described by one of them: FC-011 added a column and
    // replaced the guard, and a spec that read only the first would hold the
    // entity to a schema that stopped existing.
    await new CreateRosterImportSource1792300000000().up(queryRunner);
    await new AddDeclaredContentTypeToRosterImportSource1792500000000().up(
      queryRunner,
    );
    statements = captured;
  });

  const createTable = (): string => {
    const found = statements.find(statement =>
      statement.includes(
        'CREATE TABLE "sto_info_app"."fleet_roster_import_source"',
      ),
    );

    if (found === undefined) {
      throw new Error('Migration does not create fleet_roster_import_source');
    }

    return found;
  };

  const entityColumns = (): string[] =>
    getMetadataArgsStorage()
      .columns.filter(column => column.target === RosterImportSourceEntity)
      .map(column => column.options.name ?? column.propertyName);

  const addedColumns = (): string[] =>
    statements
      .map(statement =>
        /ALTER TABLE "sto_info_app"\."fleet_roster_import_source" ADD "([^"]+)"/.exec(
          statement,
        ),
      )
      .filter(match => match !== null)
      .map(match => match[1]);

  const migrationColumns = (): string[] => [
    ...createTable()
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('"'))
      .map(line => line.slice(1, line.indexOf('"', 1))),
    ...addedColumns(),
  ];

  it('declares exactly the columns the migration creates', () => {
    expect([...migrationColumns()].sort()).toEqual([...entityColumns()].sort());
  });

  // ADR-0007 from the other side: the entity has to ask for timestamptz too,
  // or TypeORM's default lands a plain timestamp in any generated migration.
  it('types every instant column as timestamptz in both places', () => {
    const declared = getMetadataArgsStorage()
      .columns.filter(column => column.target === RosterImportSourceEntity)
      .filter(column => column.options.type === 'timestamptz')
      .map(column => column.options.name ?? column.propertyName);

    const sqlLines = createTable()
      .split('\n')
      .map(line => line.trim());

    expect(declared).toEqual(
      expect.arrayContaining(['uploadedAt', 'createdAt', 'updatedAt']),
    );

    for (const column of declared) {
      expect(sqlLines).toContainEqual(
        expect.stringMatching(new RegExp(`^"${column}" timestamptz(?![a-z])`)),
      );
    }
  });

  it('keeps the provenance columns write-once in the database', () => {
    // The last definition wins, as it does in PostgreSQL: the guard is
    // replaced rather than altered, so an earlier one still in this list is
    // history and not the rule.
    const definitions = statements.filter(statement =>
      statement.includes('roster_import_source_guard'),
    );
    const guard = definitions[definitions.length - 1];

    expect(guard).toBeDefined();

    // Every column the trigger is supposed to freeze. A column added to the
    // table and forgotten here would be silently editable.
    for (const column of [
      'assetId',
      'fleetId',
      'originalFilename',
      'declaredContentType',
      'sourceSha256',
      'sanitisedSha256',
      'sourceByteSize',
      'sanitisedByteSize',
      'sourceHeaderShape',
      'parserVersion',
      'uploadedAt',
    ]) {
      expect(guard).toContain(
        `NEW."${column}" IS DISTINCT FROM OLD."${column}"`,
      );
    }
  });

  it('drops everything it created when reverted', async () => {
    const captured: string[] = [];
    const queryRunner = {
      query: jest.fn((sql: string) => {
        captured.push(sql);

        return Promise.resolve();
      }),
    } as unknown as QueryRunner;

    await new CreateRosterImportSource1792300000000().down(queryRunner);

    const reverted = captured.join('\n');

    expect(reverted).toContain(
      'DROP TABLE "sto_info_app"."fleet_roster_import_source"',
    );
    expect(reverted).toContain(
      'DROP TRIGGER IF EXISTS "TR_roster_import_source_guard"',
    );
    expect(reverted).toContain(
      'DROP FUNCTION IF EXISTS "sto_info_app"."roster_import_source_guard"',
    );
    expect(reverted).toContain(
      'DROP TYPE "sto_info_app"."roster_source_header_shape_enum"',
    );
  });
});
