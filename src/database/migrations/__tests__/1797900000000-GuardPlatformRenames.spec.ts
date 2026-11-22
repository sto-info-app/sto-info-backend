import { describe, expect, it, jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import {
  GuardPlatformRenames1797900000000,
  PLATFORM_NAMED_TABLES,
  PLATFORM_RENAME_GUARD_SQLSTATE,
  PLATFORM_RENAME_REFUSAL,
} from '../1797900000000-GuardPlatformRenames';

/**
 * Runs a direction of the migration and keeps what it sends.
 *
 * @param direction - Which.
 * @returns Every statement, in order.
 */
async function capture(direction: 'up' | 'down'): Promise<string[]> {
  const statements: string[] = [];
  const queryRunner = {
    query: jest.fn((sql: string) => {
      statements.push(sql);

      return Promise.resolve();
    }),
  } as unknown as QueryRunner;

  await new GuardPlatformRenames1797900000000()[direction](queryRunner);

  return statements;
}

/**
 * The guard is proved against a real database by the release rehearsal; this
 * holds what it watches and what it says.
 */
describe('GuardPlatformRenames1797900000000 (FC-045)', () => {
  it('watches renames only', async () => {
    const [, trigger] = await capture('up');

    expect(trigger).toBe(
      'CREATE TRIGGER "TR_platform_rename_guard" BEFORE UPDATE OF "name" ON "sto_info_app"."platform" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."platform_rename_guard"()',
    );
  });

  it('refuses a rename while any Fleet, Armada or old Fleet address is on the platform', async () => {
    const [guard] = await capture('up');

    expect([...PLATFORM_NAMED_TABLES]).toEqual([
      'sto_fleet',
      'sto_armada',
      'fleet_slug_history',
    ]);
    expect(guard).toContain('NEW."name" IS DISTINCT FROM OLD."name"');

    for (const table of PLATFORM_NAMED_TABLES) {
      expect(guard).toContain(
        `EXISTS (SELECT 1 FROM "sto_info_app"."${table}" WHERE "platformId" = OLD."id")`,
      );
    }

    expect(guard).toContain(`RAISE EXCEPTION '${PLATFORM_RENAME_REFUSAL}'`);
    expect(guard).toContain(`USING ERRCODE = 'IRG02'`);
    expect(PLATFORM_RENAME_GUARD_SQLSTATE).toBe('IRG02');
    expect(PLATFORM_RENAME_REFUSAL).not.toContain("'");
  });

  it('takes the guard away again on the way down', async () => {
    await expect(capture('down')).resolves.toEqual([
      'DROP TRIGGER "TR_platform_rename_guard" ON "sto_info_app"."platform"',
      'DROP FUNCTION "sto_info_app"."platform_rename_guard"()',
    ]);
  });
});
