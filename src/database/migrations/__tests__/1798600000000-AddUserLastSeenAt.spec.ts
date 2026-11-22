import { describe, expect, it, jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import { AddUserLastSeenAt1798600000000 } from '../1798600000000-AddUserLastSeenAt';

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

  await new AddUserLastSeenAt1798600000000()[direction](queryRunner);

  return statements;
}

describe('AddUserLastSeenAt1798600000000', () => {
  // Nullable, so every existing user starts unseen and the statistics fall
  // back to their last sign-in until they come back.
  it('adds a nullable lastSeenAt to the user table, indexed', async () => {
    await expect(capture('up')).resolves.toEqual([
      `ALTER TABLE "sto_info_app"."user" ADD "lastSeenAt" TIMESTAMP`,
      `CREATE INDEX "IDX_user_last_seen_at" ON "sto_info_app"."user" ("lastSeenAt")`,
    ]);
  });

  it('takes the index and the column away again on the way down', async () => {
    await expect(capture('down')).resolves.toEqual([
      `DROP INDEX "sto_info_app"."IDX_user_last_seen_at"`,
      `ALTER TABLE "sto_info_app"."user" DROP COLUMN "lastSeenAt"`,
    ]);
  });
});
