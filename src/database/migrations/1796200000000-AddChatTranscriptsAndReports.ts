import { MigrationInterface, QueryRunner } from 'typeorm';

/** The chat log's kinds before this migration. */
const PREVIOUS_ACTIONS = [
  'CHANNEL_CREATED',
  'CHANNEL_CHANGED',
  'CHANNEL_ARCHIVED',
  'MESSAGE_REMOVED',
];

/** The kinds this migration adds (FC-035). */
const ADDED_ACTIONS = ['TRANSCRIPT_REQUESTED', 'TRANSCRIPT_DOWNLOADED'];

/**
 * Transcripts and message reports for chat (FC-035).
 *
 * With Steve's decisions of 28 and 29 September 2026:
 *
 * - `chat_transcript`: a scope admin's request for one channel over at most
 *   the last seven days, with a purpose. A job writes it as plain text to the
 *   private exports bucket; its link lasts 24 hours. The range and the
 *   purpose are the database's to keep, as well as the service's. Every
 *   request and download is logged in `chat_action`.
 * - `chat_message_report`: a reader's report of a message, once per person,
 *   for the site's admins alone, with the member reports' reasons and
 *   statuses.
 * - `chat_report_evidence`: the reported message and the twenty before it,
 *   copied when reported, so they outlive the ordinary purge. They go 90
 *   days after the report is closed.
 */
export class AddChatTranscriptsAndReports1796200000000 implements MigrationInterface {
  name = 'AddChatTranscriptsAndReports1796200000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const action of ADDED_ACTIONS) {
      await queryRunner.query(
        `ALTER TYPE "sto_info_app"."chat_action_kind_enum" ADD VALUE IF NOT EXISTS '${action}'`,
      );
    }

    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."chat_transcript_status_enum" AS ENUM ('PENDING', 'READY', 'FAILED', 'EXPIRED')`,
    );
    await queryRunner.query(`CREATE TABLE "sto_info_app"."chat_transcript" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "channelId" uuid NOT NULL,
      "requestedByUserId" uuid,
      "purpose" varchar(500) NOT NULL,
      "fromAt" timestamptz NOT NULL,
      "toAt" timestamptz NOT NULL,
      "status" "sto_info_app"."chat_transcript_status_enum" NOT NULL DEFAULT 'PENDING',
      "objectKey" varchar(300),
      "messageCount" integer,
      "byteCount" integer,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "readyAt" timestamptz,
      "expiresAt" timestamptz,
      CONSTRAINT "PK_chat_transcript" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_chat_transcript_range" CHECK ("fromAt" < "toAt" AND "toAt" <= "createdAt" AND "fromAt" >= "createdAt" - interval '7 days'),
      CONSTRAINT "CHK_chat_transcript_purpose" CHECK (length(btrim("purpose")) BETWEEN 10 AND 500),
      CONSTRAINT "FK_chat_transcript_channel" FOREIGN KEY ("channelId") REFERENCES "sto_info_app"."chat_channel"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_chat_transcript_requester" FOREIGN KEY ("requestedByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_transcript_requester" ON "sto_info_app"."chat_transcript" ("requestedByUserId", "createdAt")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."chat_message_report" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "messageId" uuid NOT NULL,
      "channelId" uuid,
      "conversationId" uuid,
      "reporterUserId" uuid,
      "authorUserId" uuid,
      "reason" "sto_info_app"."report_reason_enum" NOT NULL,
      "details" varchar(1000),
      "status" "sto_info_app"."report_status_enum" NOT NULL DEFAULT 'OPEN',
      "resolutionNote" varchar(1000),
      "resolvedByUserId" uuid,
      "resolvedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_chat_message_report" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_chat_message_report_once" UNIQUE ("messageId", "reporterUserId"),
      CONSTRAINT "CHK_chat_message_report_place" CHECK (("channelId" IS NULL) <> ("conversationId" IS NULL)),
      CONSTRAINT "FK_chat_message_report_reporter" FOREIGN KEY ("reporterUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
      CONSTRAINT "FK_chat_message_report_author" FOREIGN KEY ("authorUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
      CONSTRAINT "FK_chat_message_report_resolver" FOREIGN KEY ("resolvedByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_message_report_status" ON "sto_info_app"."chat_message_report" ("status", "createdAt")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."chat_report_evidence" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "reportId" uuid NOT NULL,
      "position" smallint NOT NULL,
      "messageId" uuid NOT NULL,
      "authorUserId" uuid,
      "authorUsername" varchar(50),
      "body" varchar(2000),
      "deleted" boolean NOT NULL,
      "sentAt" timestamptz NOT NULL,
      CONSTRAINT "PK_chat_report_evidence" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_chat_report_evidence_position" UNIQUE ("reportId", "position"),
      CONSTRAINT "CHK_chat_report_evidence_position" CHECK ("position" BETWEEN 0 AND 20),
      CONSTRAINT "FK_chat_report_evidence_report" FOREIGN KEY ("reportId") REFERENCES "sto_info_app"."chat_message_report"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_chat_report_evidence_author" FOREIGN KEY ("authorUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
  }

  /**
   * Reverts the migration: transcripts, reports and their evidence go, and
   * the chat log forgets transcripts. PostgreSQL cannot take a value out of a
   * type, so the log's type is made again without them.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const added = ADDED_ACTIONS.map(value => `'${value}'`).join(', ');
    const previous = PREVIOUS_ACTIONS.map(value => `'${value}'`).join(', ');

    await queryRunner.query(`DROP TABLE "sto_info_app"."chat_report_evidence"`);
    await queryRunner.query(`DROP TABLE "sto_info_app"."chat_message_report"`);
    await queryRunner.query(`DROP TABLE "sto_info_app"."chat_transcript"`);
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."chat_transcript_status_enum"`,
    );
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."chat_action" WHERE "action"::text IN (${added})`,
    );
    await queryRunner.query(
      `ALTER TYPE "sto_info_app"."chat_action_kind_enum" RENAME TO "chat_action_kind_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."chat_action_kind_enum" AS ENUM (${previous})`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."chat_action" ALTER COLUMN "action" TYPE "sto_info_app"."chat_action_kind_enum" USING "action"::text::"sto_info_app"."chat_action_kind_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."chat_action_kind_enum_old"`,
    );
  }
}
