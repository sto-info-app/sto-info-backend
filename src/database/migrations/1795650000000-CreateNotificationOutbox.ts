import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The outbox every targeted in-app notice goes through (FC-028, FC-029).
 *
 * Steve's decision of 28 September 2026: one outbox for event reminders and
 * changes, Character association proposals, and later mentions, replies and
 * direct messages, each with its kind, a key that makes it sent once, and a
 * recheck before it is sent.
 *
 * It holds references, never words: `subjectId` names the occurrence or the
 * proposal, and `detail` only what a handler needs besides, such as a
 * reminder's lead. `CHK_notification_outbox_settled` keeps a notice from
 * being both sent and set aside.
 */
export class CreateNotificationOutbox1795650000000 implements MigrationInterface {
  name = 'CreateNotificationOutbox1795650000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."notification_outbox_kind_enum" AS ENUM ('EVENT_REMINDER', 'EVENT_CANCELLED', 'EVENT_MOVED', 'EVENT_PROMOTED', 'ROSTER_ASSOCIATION_PROPOSED')`,
    );
    await queryRunner.query(`CREATE TABLE "sto_info_app"."notification_outbox" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "userId" uuid NOT NULL,
      "kind" "sto_info_app"."notification_outbox_kind_enum" NOT NULL,
      "subjectId" uuid NOT NULL,
      "detail" jsonb,
      "dedupeKey" varchar(200) NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "deliveredAt" timestamptz,
      "skippedAt" timestamptz,
      "attempts" integer NOT NULL DEFAULT 0,
      "lastError" varchar(200),
      CONSTRAINT "PK_notification_outbox" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_notification_outbox_dedupe" UNIQUE ("dedupeKey"),
      CONSTRAINT "CHK_notification_outbox_settled" CHECK ("deliveredAt" IS NULL OR "skippedAt" IS NULL),
      CONSTRAINT "CHK_notification_outbox_attempts" CHECK ("attempts" >= 0),
      CONSTRAINT "FK_notification_outbox_user" FOREIGN KEY ("userId") REFERENCES "sto_info_app"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_outbox_pending" ON "sto_info_app"."notification_outbox" ("createdAt") WHERE "deliveredAt" IS NULL AND "skippedAt" IS NULL`,
    );
  }

  /**
   * Reverts the migration, and every notice with it.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "sto_info_app"."notification_outbox"`);
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."notification_outbox_kind_enum"`,
    );
  }
}
