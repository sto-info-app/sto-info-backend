import { describe, expect, it, jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import { NotificationEmailType } from 'src/notification/email/notification-email-type.enum';
import { EmailFrequency } from 'src/user/enums/email-frequency.enum';

import {
  AddNotificationEmails1799000000000,
  NOTIFICATION_EMAIL_OUTBOX_TABLE,
  NOTIFICATION_EMAIL_TYPES_AT_1799,
} from '../1799000000000-AddNotificationEmails';

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

  await new AddNotificationEmails1799000000000()[direction](queryRunner);

  return statements;
}

const flat = (sql: string): string => sql.replace(/\s+/g, ' ');

/**
 * Notification emails and their switches (sc-1067). Proved against a real
 * database by the release rehearsal; this holds what each direction asks for.
 */
describe('AddNotificationEmails1799000000000', () => {
  // A type added to the code without a migration would fail to save.
  it('creates every email type the code knows, and only those', async () => {
    expect([...NOTIFICATION_EMAIL_TYPES_AT_1799]).toEqual(
      Object.values(NotificationEmailType),
    );

    const [types, frequencies] = await capture('up');

    expect(types).toBe(
      `CREATE TYPE "sto_info_app"."notification_email_type_enum" AS ENUM (${Object.values(
        NotificationEmailType,
      )
        .map(type => `'${type}'`)
        .join(', ')})`,
    );
    expect(frequencies).toBe(
      `CREATE TYPE "sto_info_app"."email_frequency_enum" AS ENUM (${Object.values(
        EmailFrequency,
      )
        .map(value => `'${value}'`)
        .join(', ')})`,
    );
  });

  // Existing accounts keep the login alert they had, and nothing else.
  it('starts every account with only the login alert, sent instantly', async () => {
    const statements = (await capture('up')).map(flat);

    expect(statements).toContain(
      `ALTER TABLE "sto_info_app"."user_preference" ADD "emailNotificationTypes" "sto_info_app"."notification_email_type_enum" array NOT NULL DEFAULT '{LOGIN}'`,
    );
    expect(statements).toContain(
      `ALTER TABLE "sto_info_app"."user_preference" ADD "emailFrequency" "sto_info_app"."email_frequency_enum" NOT NULL DEFAULT 'INSTANT'`,
    );
  });

  it('creates the outbox, which goes with its account', async () => {
    const statements = (await capture('up')).map(flat);
    const table = statements.find(sql =>
      sql.startsWith(`CREATE TABLE ${NOTIFICATION_EMAIL_OUTBOX_TABLE}`),
    );

    expect(table).toContain(
      `FOREIGN KEY ("userId") REFERENCES "sto_info_app"."user"("id") ON DELETE CASCADE`,
    );
    expect(table).toContain(`CHECK ("attempts" >= 0)`);
    expect(statements).toContain(
      `CREATE INDEX "IDX_notification_email_outbox_due" ON ${NOTIFICATION_EMAIL_OUTBOX_TABLE} ("dueAt") WHERE "sentAt" IS NULL AND "skippedAt" IS NULL`,
    );
    expect(statements).toHaveLength(7);
  });

  it('takes everything away again, table first', async () => {
    expect(await capture('down')).toEqual([
      `DROP TABLE ${NOTIFICATION_EMAIL_OUTBOX_TABLE}`,
      `ALTER TABLE "sto_info_app"."user_preference" DROP COLUMN "emailFrequency"`,
      `ALTER TABLE "sto_info_app"."user_preference" DROP COLUMN "emailNotificationTypes"`,
      `DROP TYPE "sto_info_app"."email_frequency_enum"`,
      `DROP TYPE "sto_info_app"."notification_email_type_enum"`,
    ]);
  });
});
