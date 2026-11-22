import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import {
  AddPrivacyErasure1796500000000,
  AUDITED_BY_IDENTIFIERS_ONLY,
  POLICY_NOTICE_ID,
} from '../../database/migrations/1796500000000-AddPrivacyErasure';
import { RosterErasureEntity } from './roster-erasure.entity';

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
 * Holds the erasure record, the ownerless closed Community, the audit scrub
 * and the policy notice to the code (FC-038). It proves the descriptions
 * agree, not that PostgreSQL accepts them: the migration was run up, down
 * and up again on the local database.
 */
describe('Privacy erasure schema alignment (FC-038)', () => {
  const migration = new AddPrivacyErasure1796500000000();
  let up: string[];
  let down: string[];

  beforeAll(async () => {
    up = await capture(queryRunner => migration.up(queryRunner));
    down = await capture(queryRunner => migration.down(queryRunner));
  });

  const table = (): string =>
    up.find(statement =>
      statement.includes('CREATE TABLE "sto_info_app"."roster_erasure"'),
    )!;

  it('declares exactly the columns the erasure record is created with', () => {
    const entity = getMetadataArgsStorage()
      .columns.filter(column => column.target === RosterErasureEntity)
      .map(column => column.propertyName);
    const created = table()
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('"'))
      .map(line => line.slice(1, line.indexOf('"', 1)));

    expect([...created].sort()).toEqual([...entity].sort());
    expect(table()).toContain('"createdAt" TIMESTAMP WITH TIME ZONE');
  });

  it('holds a hash, never the name, one per pair, with a real reason', () => {
    expect(table()).not.toMatch(/characterName|accountHandle/);
    expect(table()).toContain('UNIQUE ("pairHash")');
    expect(table()).toContain(`CHECK ("pairHash" ~ '^[0-9a-f]{64}$')`);
    expect(table()).toContain(
      'CHECK (length(btrim("reason")) BETWEEN 10 AND 500)',
    );
    expect(up.join('\n')).toContain('roster_erasure is write-once');
  });

  it('keeps roster rows write-once but for the erased form, and puts it back', () => {
    const guard = (statements: string[]): string =>
      statements.find(statement =>
        statement.includes('"roster_observation_guard"()'),
      )!;

    expect(guard(up)).toContain(`NEW."characterName" = 'Erased member'`);
    expect(guard(up)).toContain(`NEW."accountHandle" LIKE '@erased-%'`);
    expect(guard(up)).toContain(`NEW."publicComment" = ''`);
    expect(guard(up)).toContain(
      'NEW."guildRank" IS DISTINCT FROM OLD."guildRank"',
    );
    expect(guard(down)).not.toContain('Erased member');
    expect(guard(down)).toContain(
      'NEW."characterName" IS DISTINCT FROM OLD."characterName"',
    );
  });

  it('lets only a closed Community keep no Owner, once the account goes', () => {
    expect(up).toContainEqual(
      expect.stringContaining(
        `FOREIGN KEY ("ownerUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL`,
      ),
    );
    expect(up).toContainEqual(
      `ALTER TABLE "sto_info_app"."fleet_community" ADD CONSTRAINT "CHK_fleet_community_owner_closed" CHECK ("ownerUserId" IS NOT NULL OR "status"::text = 'CLOSED')`,
    );
  });

  it('scrubs the audit trail of every entity now audited by identifiers', () => {
    const scrub = up.find(statement =>
      statement.startsWith('UPDATE "sto_info_app"."_audit"'),
    )!;

    for (const entity of AUDITED_BY_IDENTIFIERS_ONLY) {
      expect(scrub).toContain(`'${entity}'`);
    }

    expect(scrub).toContain(`WHERE key = 'id' OR key LIKE '%Id'`);
  });

  it('posts one notice that the policies changed, and takes it back', () => {
    expect(up).toContainEqual(
      expect.stringContaining('INSERT INTO "sto_info_app"."notification"'),
    );
    expect(down).toContainEqual(
      'DELETE FROM "sto_info_app"."notification" WHERE "id" = $1',
    );
    expect(POLICY_NOTICE_ID).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('takes it all back out, remaking the owner key and the import log type', () => {
    expect(down).toContainEqual(
      `ALTER TABLE "sto_info_app"."fleet_community" ALTER COLUMN "ownerUserId" SET NOT NULL`,
    );
    expect(down).toContainEqual(expect.stringContaining('ON DELETE RESTRICT'));
    expect(down).toContainEqual('DROP TABLE "sto_info_app"."roster_erasure"');
    expect(down).toContainEqual(
      `DELETE FROM "sto_info_app"."fleet_roster_import_action" WHERE "action"::text = 'SOURCE_ERASED'`,
    );

    const swap = down.findIndex(statement =>
      statement.includes('ALTER COLUMN "action" TYPE'),
    );
    const remake = down.findIndex(statement =>
      statement.includes('ADD CONSTRAINT "CHK_roster_import_action_conflict"'),
    );

    expect(remake).toBeGreaterThan(swap);
  });
});
