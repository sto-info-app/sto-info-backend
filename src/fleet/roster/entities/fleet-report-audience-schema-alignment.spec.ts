import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import { CreateFleetReportAudiences1794700000000 } from '../../../database/migrations/1794700000000-CreateFleetReportAudiences';
import { FleetReport } from '../enums/fleet-report.enum';
import { FleetReportAudienceChangeEntity } from './fleet-report-audience-change.entity';
import { FleetReportAudienceEntity } from './fleet-report-audience.entity';

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
 * Holds the two report audience entities and their hand-written migration to
 * each other, as the roster alignment specs do for theirs. It proves the two
 * descriptions agree, not that PostgreSQL accepts either: the constraint
 * behaviour was rehearsed against the local database.
 */
describe('Fleet report audience schema alignment', () => {
  const migration = new CreateFleetReportAudiences1794700000000();
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

  const tables: Array<[string, abstract new () => unknown]> = [
    ['fleet_report_audience', FleetReportAudienceEntity],
    ['fleet_report_audience_change', FleetReportAudienceChangeEntity],
  ];

  describe.each(tables)('%s', (table, entity) => {
    it('declares exactly the columns the migration creates', () => {
      const migrationColumns = sqlLines(table)
        .filter(line => line.startsWith('"'))
        .map(line => line.slice(1, line.indexOf('"', 1)));

      expect([...migrationColumns].sort()).toEqual(
        declared(entity)
          .map(column => column.options.name ?? column.propertyName)
          .sort(),
      );
    });

    // ADR-0007 from the other side: the entity has to ask for timestamptz.
    it('types every instant column as timestamptz in both places', () => {
      const instants = declared(entity)
        .filter(column => column.options.type === 'timestamptz')
        .map(column => column.propertyName);

      expect(instants.length).toBeGreaterThan(0);

      for (const column of instants) {
        expect(sqlLines(table)).toContainEqual(
          expect.stringMatching(
            new RegExp(`^"${column}" timestamptz(?![a-z])`),
          ),
        );
      }
    });

    it('uses the shared report and audience types', () => {
      for (const column of declared(entity).filter(
        candidate => candidate.options.type === 'enum',
      )) {
        const type =
          column.options.enum === FleetReport
            ? 'fleet_report_enum'
            : 'fleet_audience_enum';

        expect(column.options.enumName).toBe(type);
        expect(sqlLines(table)).toContainEqual(
          expect.stringMatching(
            new RegExp(`^"${column.propertyName}" "sto_info_app"."${type}"`),
          ),
        );
      }
    });
  });

  it('gives the report type exactly the reports the code knows', () => {
    const values = Object.values(FleetReport)
      .map(value => `'${value}'`)
      .join(', ');

    expect(statements).toContainEqual(
      `CREATE TYPE "sto_info_app"."fleet_report_enum" AS ENUM (${values})`,
    );
  });

  it('keeps one audience per Fleet and report', () => {
    expect(createTable('fleet_report_audience')).toContain(
      'PRIMARY KEY ("fleetId", "report")',
    );
  });

  it('records only a change that moved the audience', () => {
    expect(createTable('fleet_report_audience_change')).toContain(
      'CHECK ("audienceBefore" <> "audienceAfter")',
    );
  });

  it('keeps every change write-once but for its actor', () => {
    const guard = statements.find(statement =>
      statement.includes(
        'FUNCTION "sto_info_app"."fleet_report_audience_change_guard"',
      ),
    );

    expect(guard).toContain(
      `(to_jsonb(NEW) - 'actorUserId') IS DISTINCT FROM (to_jsonb(OLD) - 'actorUserId')`,
    );
    expect(statements).toContainEqual(
      expect.stringContaining(
        'CREATE TRIGGER "TR_fleet_report_audience_change_guard" BEFORE UPDATE',
      ),
    );
  });

  it('drops everything it created when reverted', async () => {
    const reverted = (
      await capture(queryRunner => migration.down(queryRunner))
    ).join('\n');

    for (const expected of [
      'DROP TRIGGER IF EXISTS "TR_fleet_report_audience_change_guard"',
      'DROP FUNCTION IF EXISTS "sto_info_app"."fleet_report_audience_change_guard"()',
      'DROP TABLE "sto_info_app"."fleet_report_audience_change"',
      'DROP TABLE "sto_info_app"."fleet_report_audience"',
      'DROP TYPE "sto_info_app"."fleet_report_enum"',
    ]) {
      expect(reverted).toContain(expected);
    }
  });
});
