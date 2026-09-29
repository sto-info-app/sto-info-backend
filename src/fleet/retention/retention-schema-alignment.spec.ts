import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import { RecordRosterImportCorrections1794300000000 } from '../../database/migrations/1794300000000-RecordRosterImportCorrections';
import { AddFleetAdministration1796300000000 } from '../../database/migrations/1796300000000-AddFleetAdministration';
import { AddRetentionRuns1796400000000 } from '../../database/migrations/1796400000000-AddRetentionRuns';
import { AddPrivacyErasure1796500000000 } from '../../database/migrations/1796500000000-AddPrivacyErasure';
import { ModerationHoldActionKind } from '../chat/holds/moderation-hold.enums';
import { RosterImportActionKind } from '../imports/enums/roster-import-action-kind.enum';
import { RetentionJob } from './retention-job.enum';
import { RetentionRunEntity } from './retention-run.entity';

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
 * The values a type is created with, and those later added to it.
 *
 * @param statements - Every statement, in order.
 * @param type - The type.
 * @returns Its values.
 */
function valuesOf(statements: readonly string[], type: string): string[] {
  const values: string[] = [];

  for (const statement of statements) {
    const created = new RegExp(
      `CREATE TYPE "sto_info_app"\\."${type}" AS ENUM \\((.*)\\)`,
    ).exec(statement);
    const added = new RegExp(
      `ALTER TYPE "sto_info_app"\\."${type}" ADD VALUE IF NOT EXISTS '(\\w+)'`,
    ).exec(statement);

    if (created !== null) {
      values.push(...created[1].split(', ').map(value => value.slice(1, -1)));
    }

    if (added !== null) {
      values.push(added[1]);
    }
  }

  return values;
}

/**
 * Holds the retention runs table and the two logs' new values to the code
 * (FC-037). It proves the descriptions agree, not that PostgreSQL accepts
 * them: the migration was run up, down and up again on the local database.
 */
describe('Retention schema alignment (FC-037)', () => {
  const migration = new AddRetentionRuns1796400000000();
  let up: string[];
  let down: string[];

  beforeAll(async () => {
    up = await capture(queryRunner => migration.up(queryRunner));
    down = await capture(queryRunner => migration.down(queryRunner));
  });

  const table = (): string =>
    up.find(statement =>
      statement.includes('CREATE TABLE "sto_info_app"."retention_run"'),
    )!;

  it('declares exactly the columns the table is created with', () => {
    const entity = getMetadataArgsStorage()
      .columns.filter(column => column.target === RetentionRunEntity)
      .map(column => column.propertyName);
    const created = table()
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('"'))
      .map(line => line.slice(1, line.indexOf('"', 1)));

    expect([...created].sort()).toEqual([...entity].sort());
  });

  it('types every instant as timestamptz', () => {
    for (const column of ['startedAt', 'finishedAt']) {
      expect(table()).toContain(`"${column}" TIMESTAMP WITH TIME ZONE`);
    }
  });

  it('gives the job type every job the code knows', () => {
    expect(valuesOf(up, 'retention_job_enum')).toEqual(
      Object.values(RetentionJob),
    );
  });

  it('makes a finished run write-once, with an error only on a failure', () => {
    expect(table()).toContain(
      'CHECK (("finishedAt" IS NULL) = ("complete" IS NULL))',
    );
    expect(table()).toContain(
      'CHECK ("error" IS NULL OR ("finishedAt" IS NOT NULL AND NOT "complete"))',
    );
    expect(up.join('\n')).toContain(`IF OLD."finishedAt" IS NOT NULL`);
    expect(up).toContainEqual(
      expect.stringContaining(
        'CREATE TRIGGER "TR_retention_run_guard" BEFORE UPDATE',
      ),
    );
  });

  it('leaves both logs knowing every action the code knows', async () => {
    const holds = await capture(queryRunner =>
      new AddFleetAdministration1796300000000().up(queryRunner),
    );
    const imports = await capture(queryRunner =>
      new RecordRosterImportCorrections1794300000000().up(queryRunner),
    );
    // FC-038 adds the last: a held import whose file an erasure deleted.
    const erasure = await capture(queryRunner =>
      new AddPrivacyErasure1796500000000().up(queryRunner),
    );

    expect(
      valuesOf([...holds, ...up], 'moderation_hold_action_kind_enum'),
    ).toEqual(Object.values(ModerationHoldActionKind));
    expect(
      valuesOf([...imports, ...up, ...erasure], 'roster_import_action_enum'),
    ).toEqual(Object.values(RosterImportActionKind));
  });

  it('takes it all back out, remaking both types and the CHECK', () => {
    expect(down.slice(0, 3)).toEqual([
      'DROP TABLE "sto_info_app"."retention_run"',
      'DROP FUNCTION "sto_info_app"."retention_run_guard"()',
      'DROP TYPE "sto_info_app"."retention_job_enum"',
    ]);
    expect(down).toContainEqual(
      `DELETE FROM "sto_info_app"."moderation_hold_action" WHERE "action"::text IN ('REVIEW_DUE', 'RELEASE_WARNED')`,
    );
    expect(down).toContainEqual(
      `CREATE TYPE "sto_info_app"."moderation_hold_action_kind_enum" AS ENUM ('PLACED', 'EXTENDED', 'RELEASED', 'READ')`,
    );

    const dropCheck = down.indexOf(
      'ALTER TABLE "sto_info_app"."fleet_roster_import_action" DROP CONSTRAINT "CHK_roster_import_action_conflict"',
    );
    const swap = down.findIndex(statement =>
      statement.includes(
        'ALTER TABLE "sto_info_app"."fleet_roster_import_action" ALTER COLUMN "action" TYPE',
      ),
    );
    const remake = down.findIndex(statement =>
      statement.includes('ADD CONSTRAINT "CHK_roster_import_action_conflict"'),
    );

    expect(dropCheck).toBeGreaterThan(-1);
    expect(swap).toBeGreaterThan(dropCheck);
    expect(remake).toBeGreaterThan(swap);
    expect(down).toContainEqual(
      `DELETE FROM "sto_info_app"."fleet_roster_import_action" WHERE "action"::text IN ('SOURCE_EXPIRED')`,
    );
  });
});
