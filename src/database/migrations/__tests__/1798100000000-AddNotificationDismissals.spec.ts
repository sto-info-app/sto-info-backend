import { describe, expect, it, jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import { AddNotificationDismissals1798100000000 } from '../1798100000000-AddNotificationDismissals';

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

  await new AddNotificationDismissals1798100000000()[direction](queryRunner);

  return statements;
}

describe('AddNotificationDismissals1798100000000', () => {
  it('creates one row per reader and notification, unique and cascading', async () => {
    const [table, index, key] = await capture('up');

    expect(table).toContain(
      'CREATE TABLE "sto_info_app"."notification_dismissal"',
    );
    expect(table).toContain('"notificationId" uuid NOT NULL');
    expect(table).toContain('"userId" uuid NOT NULL');
    expect(table).toContain('"dismissedAt" TIMESTAMP NOT NULL DEFAULT now()');
    expect(index).toBe(
      'CREATE UNIQUE INDEX "UX_notification_dismissal_notification_user" ON "sto_info_app"."notification_dismissal" ("notificationId", "userId")',
    );
    expect(key).toContain('REFERENCES "sto_info_app"."notification"("id")');
    expect(key).toContain('ON DELETE CASCADE');
  });

  it('takes the table away again on the way down', async () => {
    await expect(capture('down')).resolves.toEqual([
      `ALTER TABLE "sto_info_app"."notification_dismissal" DROP CONSTRAINT "FK_notification_dismissal_notification"`,
      `DROP INDEX "sto_info_app"."UX_notification_dismissal_notification_user"`,
      `DROP TABLE "sto_info_app"."notification_dismissal"`,
    ]);
  });
});
