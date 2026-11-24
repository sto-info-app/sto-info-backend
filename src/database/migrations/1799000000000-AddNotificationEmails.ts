import { MigrationInterface, QueryRunner } from 'typeorm';

/** The kinds of email a user can opt in to, as the migration found them. */
export const NOTIFICATION_EMAIL_TYPES_AT_1799 = [
  'LOGIN',
  'STORYTIME_STORY_INVITE',
  'STORYTIME_ARC_INVITE',
  'STORYTIME_MODERATION',
  'STORYTIME_APPEAL',
  'STORYTIME_SPOTLIGHT',
  'STORYTIME_FOLLOWER',
  'STORYTIME_COMMENT',
  'STORYTIME_REPLY',
  'STORYTIME_REACTION',
  'STORYTIME_FOLLOWED_PUBLICATION',
  'FRIEND_REQUEST',
  'FRIEND_ACCEPTED',
  'FLEET_MENTION',
  'FLEET_REPLY',
  'FLEET_DIRECT_MESSAGE',
  'FLEET_ROSTER_PROPOSAL',
  'FLEET_EVENT_REMINDER',
  'FLEET_EVENT_CANCELLED',
  'FLEET_EVENT_MOVED',
  'FLEET_EVENT_PROMOTED',
  'FLEET_OWNERSHIP',
  'FLEET_SUSPENSION',
  'FLEET_MEMBERSHIP',
  'FLEET_ARMADA',
  'FLEET_TRANSCRIPT',
] as const;

/** The table this migration adds. */
export const NOTIFICATION_EMAIL_OUTBOX_TABLE = `"sto_info_app"."notification_email_outbox"`;

const SCHEMA = '"sto_info_app"';

/**
 * Adds notification emails and the switches that opt in to them (sc-1067).
 *
 * Every account, existing and new, starts with the login alert on and every
 * other email off, sent instantly: the login alert was already sent to
 * everybody, and nothing else was. The outbox holds what is waiting, and
 * goes with the account it is for.
 */
export class AddNotificationEmails1799000000000 implements MigrationInterface {
  name = 'AddNotificationEmails1799000000000';

  /**
   * Adds the types, the preference columns and the outbox.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    const types = NOTIFICATION_EMAIL_TYPES_AT_1799.map(
      type => `'${type}'`,
    ).join(', ');

    await queryRunner.query(
      `CREATE TYPE ${SCHEMA}."notification_email_type_enum" AS ENUM (${types})`,
    );
    await queryRunner.query(
      `CREATE TYPE ${SCHEMA}."email_frequency_enum" AS ENUM ('INSTANT', 'DAILY', 'WEEKLY')`,
    );
    await queryRunner.query(
      `ALTER TABLE ${SCHEMA}."user_preference" ADD "emailNotificationTypes" ${SCHEMA}."notification_email_type_enum" array NOT NULL DEFAULT '{LOGIN}'`,
    );
    await queryRunner.query(
      `ALTER TABLE ${SCHEMA}."user_preference" ADD "emailFrequency" ${SCHEMA}."email_frequency_enum" NOT NULL DEFAULT 'INSTANT'`,
    );
    await queryRunner.query(`CREATE TABLE ${NOTIFICATION_EMAIL_OUTBOX_TABLE} (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "userId" uuid NOT NULL,
      "type" ${SCHEMA}."notification_email_type_enum" NOT NULL,
      "title" character varying(200) NOT NULL,
      "body" text NOT NULL,
      "linkUrl" character varying(2048),
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "dueAt" TIMESTAMP WITH TIME ZONE NOT NULL,
      "sentAt" TIMESTAMP WITH TIME ZONE,
      "skippedAt" TIMESTAMP WITH TIME ZONE,
      "attempts" integer NOT NULL DEFAULT 0,
      "lastError" character varying(200),
      CONSTRAINT "PK_notification_email_outbox" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_notification_email_outbox_attempts" CHECK ("attempts" >= 0),
      CONSTRAINT "FK_notification_email_outbox_user" FOREIGN KEY ("userId") REFERENCES ${SCHEMA}."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_email_outbox_due" ON ${NOTIFICATION_EMAIL_OUTBOX_TABLE} ("dueAt") WHERE "sentAt" IS NULL AND "skippedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_email_outbox_user_type" ON ${NOTIFICATION_EMAIL_OUTBOX_TABLE} ("userId", "type")`,
    );
  }

  /**
   * Takes them away again.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE ${NOTIFICATION_EMAIL_OUTBOX_TABLE}`);
    await queryRunner.query(
      `ALTER TABLE ${SCHEMA}."user_preference" DROP COLUMN "emailFrequency"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${SCHEMA}."user_preference" DROP COLUMN "emailNotificationTypes"`,
    );
    await queryRunner.query(`DROP TYPE ${SCHEMA}."email_frequency_enum"`);
    await queryRunner.query(
      `DROP TYPE ${SCHEMA}."notification_email_type_enum"`,
    );
  }
}
