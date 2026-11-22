import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import {
  AddOperationsAlerts1797500000000,
  OPERATIONS_ACTIONS,
  OPERATIONS_ALERT_KINDS,
  PUBLICATION_SWITCH,
} from '../../database/migrations/1797500000000-AddOperationsAlerts';
import {
  AddPurgeOwedAlert1797600000000,
  PURGE_OWED_ALERT,
} from '../../database/migrations/1797600000000-AddPurgeOwedAlert';
import { FILE_PUBLICATION_PAUSED_SETTING_KEY } from '../../file-assets/constants/file-asset-publication.constants';
import { OperationsAlertEntity } from './operations-alert.entity';
import { OperationsAlertKind } from './operations-alert.enum';

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
 * Holds the operations alerts' table and the publication switch to the code
 * (FC-042). It proves the descriptions agree, not that PostgreSQL accepts
 * them: the migration was run up, down and up again in a throwaway
 * PostgreSQL 18 container.
 */
describe('Operations alert schema alignment (FC-042)', () => {
  const migration = new AddOperationsAlerts1797500000000();
  let up: string[];
  let down: string[];

  beforeAll(async () => {
    up = await capture(queryRunner => migration.up(queryRunner));
    down = await capture(queryRunner => migration.down(queryRunner));
  });

  const table = (): string =>
    up.find(statement =>
      statement.includes('CREATE TABLE "sto_info_app"."operations_alert"'),
    )!;

  it('names the migration after its own class', () => {
    expect(migration.name).toBe('AddOperationsAlerts1797500000000');
  });

  it('declares exactly the columns the table is created with', () => {
    const created = table()
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('"'))
      .map(line => line.slice(1, line.indexOf('"', 1)));
    const declared = getMetadataArgsStorage()
      .columns.filter(column => column.target === OperationsAlertEntity)
      .map(column => column.propertyName);

    expect([...created].sort()).toEqual([...declared].sort());
  });

  it('gives the kind type every problem the code watches for', () => {
    // FC-043 added one after FC-042's migration had made the type.
    expect([...OPERATIONS_ALERT_KINDS, PURGE_OWED_ALERT]).toEqual(
      Object.values(OperationsAlertKind),
    );
    expect(up[0]).toBe(
      `CREATE TYPE "sto_info_app"."operations_alert_kind_enum" AS ENUM (${OPERATIONS_ALERT_KINDS.map(
        kind => `'${kind}'`,
      ).join(', ')})`,
    );
  });

  it('keeps its instants as timestamptz', () => {
    for (const column of ['openedAt', 'lastSeenAt']) {
      expect(table()).toContain(
        `"${column}" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
      );
    }
    expect(table()).toContain('"clearedAt" TIMESTAMP WITH TIME ZONE,');
  });

  it('keeps one alert of each kind open, and counts only in its detail', () => {
    expect(up).toContain(
      'CREATE UNIQUE INDEX "UX_operations_alert_open" ON "sto_info_app"."operations_alert" ("kind") WHERE "clearedAt" IS NULL',
    );
    expect(table()).toContain(
      `CHECK (jsonb_typeof("detail") = 'object' AND NOT jsonb_path_exists("detail", '$.* ? (@.type() != "number")'))`,
    );
    expect(table()).toContain(
      `CHECK ("lastSeenAt" >= "openedAt" AND ("clearedAt" IS NULL OR "clearedAt" >= "openedAt"))`,
    );
  });

  it('seeds the switch the pause service reads, running, never over one already set', () => {
    const seed = up[up.length - 1];

    expect(PUBLICATION_SWITCH.key).toBe(FILE_PUBLICATION_PAUSED_SETTING_KEY);
    expect(JSON.parse(PUBLICATION_SWITCH.value)).toEqual({ paused: false });
    expect(seed).toContain(
      `VALUES ('${FILE_PUBLICATION_PAUSED_SETTING_KEY}', '{"paused":false}'`,
    );
    expect(seed).toContain('ON CONFLICT ("key") DO NOTHING');
  });

  it('refuses to roll back while publication is paused, or once the log holds its actions, then undoes it all', () => {
    expect(down[0]).toContain(`"value"::jsonb ->> 'paused' = 'true'`);
    expect(down[0]).toContain('RAISE EXCEPTION');
    expect(down[1]).toContain(
      `SELECT 1 FROM "sto_info_app"."site_admin_action" WHERE "action"::text IN (${OPERATIONS_ACTIONS.map(action => `'${action}'`).join(', ')})`,
    );
    expect(down[1]).toContain('Roll forward instead');
    expect(down.slice(0, 2).join('\n')).not.toMatch(/DELETE|UPDATE/);
    expect(down[2]).toBe(
      `DELETE FROM "sto_info_app"."app_setting" WHERE "key" = '${FILE_PUBLICATION_PAUSED_SETTING_KEY}'`,
    );
    expect(down.slice(-2)).toEqual([
      'DROP TABLE "sto_info_app"."operations_alert"',
      'DROP TYPE "sto_info_app"."operations_alert_kind_enum"',
    ]);
  });
});

/**
 * Holds FC-043's alert kind to the code. Rehearsed up, refused down and
 * plain down in a throwaway PostgreSQL 18 container.
 */
describe('Owed purge alert migration (FC-043)', () => {
  const migration = new AddPurgeOwedAlert1797600000000();

  it('names the migration after its own class', () => {
    expect(migration.name).toBe('AddPurgeOwedAlert1797600000000');
  });

  it('adds the kind, and nothing else', async () => {
    await expect(capture(runner => migration.up(runner))).resolves.toEqual([
      `ALTER TYPE "sto_info_app"."operations_alert_kind_enum" ADD VALUE IF NOT EXISTS 'PURGE_OWED'`,
    ]);
  });

  it('refuses to come down once an alert of the kind exists, first', async () => {
    const [refusal, ...rest] = await capture(runner => migration.down(runner));

    expect(refusal).toContain(`WHERE "kind"::text = 'PURGE_OWED'`);
    expect(refusal).toContain('RAISE EXCEPTION');
    expect(rest).toContain(
      `CREATE TYPE "sto_info_app"."operations_alert_kind_enum" AS ENUM (${OPERATIONS_ALERT_KINDS.map(
        kind => `'${kind}'`,
      ).join(', ')})`,
    );
    expect(rest[rest.length - 1]).toBe(
      'DROP TYPE "sto_info_app"."operations_alert_kind_enum_old"',
    );
  });
});
