import { describe, expect, it, jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import {
  CHARACTER_COPY_GUARD,
  CHARACTER_COPY_TABLE,
  RecordCharacterCopies1798900000000,
} from '../1798900000000-RecordCharacterCopies';

/**
 * Runs a direction of the migration and keeps what it sends.
 *
 * @param direction - Which.
 * @returns Every statement, in order, with each run of white space made one.
 */
async function capture(direction: 'up' | 'down'): Promise<string[]> {
  const statements: string[] = [];
  const queryRunner = {
    query: jest.fn((sql: string) => {
      statements.push(sql.replace(/\s+/g, ' '));

      return Promise.resolve();
    }),
  } as unknown as QueryRunner;

  await new RecordCharacterCopies1798900000000()[direction](queryRunner);

  return statements;
}

/**
 * The copy ledger the Security Log reads as its Storytime source (sc-1483).
 * The trigger is proved against a real database by the release rehearsal;
 * this holds what each direction asks for.
 */
describe('RecordCharacterCopies1798900000000', () => {
  it('creates the table, its index, its guard and the trigger, in that order', async () => {
    const statements = await capture('up');

    expect(statements).toHaveLength(4);
    expect(statements[0]).toContain(`CREATE TABLE ${CHARACTER_COPY_TABLE}`);
    expect(statements[1]).toBe(
      `CREATE INDEX "IDX_storytime_character_copy_created" ON ${CHARACTER_COPY_TABLE} ("createdAt")`,
    );
    expect(statements[2]).toContain(
      `CREATE OR REPLACE FUNCTION ${CHARACTER_COPY_GUARD}()`,
    );
    expect(statements[3]).toBe(
      `CREATE TRIGGER "TR_storytime_character_copy_guard" BEFORE UPDATE ON ${CHARACTER_COPY_TABLE} FOR EACH ROW EXECUTE FUNCTION ${CHARACTER_COPY_GUARD}()`,
    );
  });

  it('lets the actor go with their account, and names the Characters without a key', async () => {
    const [table] = await capture('up');

    expect(table).toContain(
      `FOREIGN KEY ("actorUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL`,
    );
    expect(table).toContain('"actorUserId" uuid,');
    expect(table).toContain('"sourceCharacterId" uuid NOT NULL');
    expect(table).toContain('"copyCharacterId" uuid NOT NULL');
    expect(table).not.toContain('storytime_character"');
    expect(table).not.toContain('ipAddress');
  });

  it('refuses a copy into the Story it came from', async () => {
    const [table] = await capture('up');

    expect(table).toContain(
      'CONSTRAINT "CHK_storytime_character_copy_other_story" CHECK ("sourceStoryId" <> "targetStoryId")',
    );
  });

  it('allows only the actor to be forgotten once a row is written', async () => {
    const guard = (await capture('up'))[2];

    expect(guard).toContain(
      `(to_jsonb(NEW) - 'actorUserId') IS DISTINCT FROM (to_jsonb(OLD) - 'actorUserId')`,
    );
    expect(guard).toContain(
      `(NEW."actorUserId" IS NOT NULL AND NEW."actorUserId" IS DISTINCT FROM OLD."actorUserId")`,
    );
    expect(guard).toContain(`USING ERRCODE = '23514'`);
  });

  it('drops the table before its guard on the way down', async () => {
    expect(await capture('down')).toEqual([
      `DROP TABLE ${CHARACTER_COPY_TABLE}`,
      `DROP FUNCTION ${CHARACTER_COPY_GUARD}()`,
    ]);
  });
});
