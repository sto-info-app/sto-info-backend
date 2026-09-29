import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import { CreateActivityFeed1795800000000 } from '../../../database/migrations/1795800000000-CreateActivityFeed';
import { ActivityType, ActivityVisibility } from '../enums/activity.enums';
import { ActivityEventEntity } from './activity-event.entity';

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
 * Holds the activity entity and its hand-written migration to each other
 * (FC-029). It proves the two descriptions agree, not that PostgreSQL
 * accepts either: the constraints were rehearsed against the local database.
 */
describe('Activity schema alignment', () => {
  const migration = new CreateActivityFeed1795800000000();
  let statements: string[];
  let reverted: string[];

  beforeAll(async () => {
    statements = await capture(queryRunner => migration.up(queryRunner));
    reverted = await capture(queryRunner => migration.down(queryRunner));
  });

  const table = (): string =>
    statements.find(statement =>
      statement.includes('CREATE TABLE "sto_info_app"."activity_event" ('),
    ) as string;

  const sqlLines = (): string[] =>
    table()
      .split('\n')
      .map(line => line.trim());

  const declared = () =>
    getMetadataArgsStorage().columns.filter(
      column => column.target === ActivityEventEntity,
    );

  it('declares exactly the columns the table is created with', () => {
    const migrationColumns = sqlLines()
      .filter(line => line.startsWith('"'))
      .map(line => line.slice(1, line.indexOf('"', 1)));

    expect([...migrationColumns].sort()).toEqual(
      declared()
        .map(column => column.propertyName)
        .sort(),
    );
  });

  it('types every instant column as timestamptz in both places', () => {
    for (const column of declared().filter(
      each => each.options.type === 'timestamptz',
    )) {
      expect(sqlLines()).toContainEqual(
        expect.stringMatching(
          new RegExp(`^"${column.propertyName}" timestamptz(?![a-z])`),
        ),
      );
    }
  });

  it.each([
    ['activity_type_enum', Object.values(ActivityType)],
    ['activity_visibility_enum', Object.values(ActivityVisibility)],
  ])('creates %s with every value the code knows', (name, values) => {
    expect(statements).toContain(
      `CREATE TYPE "sto_info_app"."${name}" AS ENUM (${values
        .map(value => `'${value}'`)
        .join(', ')})`,
    );
  });

  it('records each thing once, in one scope', () => {
    expect(table()).toContain(
      'CONSTRAINT "UQ_activity_event_idempotency" UNIQUE ("idempotencyKey")',
    );
    expect(table()).toContain(
      'CONSTRAINT "CHK_activity_event_scope" CHECK ("fleetId" IS NULL OR "armadaId" IS NULL)',
    );
  });

  it('takes the table and its types back out when reverted', () => {
    expect(reverted).toEqual([
      'DROP TABLE "sto_info_app"."activity_event"',
      'DROP TYPE "sto_info_app"."activity_visibility_enum"',
      'DROP TYPE "sto_info_app"."activity_type_enum"',
    ]);
  });
});
