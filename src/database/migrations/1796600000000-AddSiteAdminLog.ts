import { MigrationInterface, QueryRunner } from 'typeorm';

/** Every site admin action the log records (FC-039). */
export const SITE_ADMIN_ACTIONS = [
  'USER_ROLE_CHANGED',
  'PERMISSION_OVERRIDE_SET',
  'PERMISSION_OVERRIDE_REMOVED',
  'LIMIT_OVERRIDE_SET',
  'LIMIT_OVERRIDE_REMOVED',
  'USER_DISABLED',
  'USER_ENABLED',
  'USER_REPORT_DECIDED',
  'CHAT_REPORT_DECIDED',
  'CUSTOM_TRACKING_SUPPRESSED',
  'CUSTOM_TRACKING_RESTORED',
  'STORYTIME_CONTENT_REMOVED',
  'STORYTIME_CONTENT_RESTORED',
  'STORYTIME_REPORT_DECIDED',
  'STORYTIME_APPEAL_DECIDED',
] as const;

/** The logs a retried job or run writes to, and which gain a key. */
export const KEYED_LOGS = [
  'scope_governance_action',
  'chat_action',
  'moderation_hold_action',
  'fleet_roster_import_action',
] as const;

/** The chat log's new values: what the transcript job and sweep did. */
const CHAT_ACTIONS_ADDED = [
  'TRANSCRIPT_READY',
  'TRANSCRIPT_FAILED',
  'TRANSCRIPT_EXPIRED',
];

/** The chat log's values before this migration. */
const CHAT_ACTIONS_BEFORE = [
  'CHANNEL_CREATED',
  'CHANNEL_CHANGED',
  'CHANNEL_ARCHIVED',
  'MESSAGE_REMOVED',
  'TRANSCRIPT_REQUESTED',
  'TRANSCRIPT_DOWNLOADED',
];

/**
 * Cross-feature audit and admin security diagnostics (FC-039).
 *
 * With Steve's decisions of 29 September 2026:
 *
 * - **The site admin log.** `site_admin_action` records every site-level
 *   admin action — roles and permission and limit overrides, disabling and
 *   enabling accounts, report decisions, and content moderation — with who,
 *   when, whom or what, why and the relevant IDs, in the transaction that
 *   makes the change. Write-once; kept under the audit policy, like
 *   `_audit`: the IP address goes after 90 days and the row after 180.
 * - **Keys.** A log a retried job or scheduled run writes to gains an
 *   `idempotencyKey`, unique where set, so a retry writes nothing twice.
 * - **Transcripts.** The chat log records a transcript being written, given
 *   up on and expiring, as well as asked for and downloaded.
 */
export class AddSiteAdminLog1796600000000 implements MigrationInterface {
  name = 'AddSiteAdminLog1796600000000';

  /**
   * Adds the site admin log, the keys and the transcript actions.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."site_admin_action_enum" AS ENUM (${SITE_ADMIN_ACTIONS.map(action => `'${action}'`).join(', ')})`,
    );
    await queryRunner.query(`CREATE TABLE "sto_info_app"."site_admin_action" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "action" "sto_info_app"."site_admin_action_enum" NOT NULL,
      "actorUserId" uuid,
      "targetUserId" uuid,
      "subjectKind" varchar(40),
      "subjectId" varchar(100),
      "reason" varchar(1000) NOT NULL,
      "detail" jsonb,
      "ipAddress" varchar(45),
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_site_admin_action" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_site_admin_action_reason" CHECK (length(btrim("reason")) > 0),
      CONSTRAINT "CHK_site_admin_action_subject" CHECK (("subjectKind" IS NULL) = ("subjectId" IS NULL)),
      CONSTRAINT "FK_site_admin_action_actor" FOREIGN KEY ("actorUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
      CONSTRAINT "FK_site_admin_action_target" FOREIGN KEY ("targetUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_site_admin_action_created" ON "sto_info_app"."site_admin_action" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_site_admin_action_target" ON "sto_info_app"."site_admin_action" ("targetUserId")`,
    );
    // Write-once, but for the accounts it names going and the IP address
    // being forgotten, as the audit policy asks.
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."site_admin_action_guard"()
      RETURNS trigger AS $$
      BEGIN
        IF (to_jsonb(NEW) - 'actorUserId' - 'targetUserId' - 'ipAddress')
            IS DISTINCT FROM (to_jsonb(OLD) - 'actorUserId' - 'targetUserId' - 'ipAddress')
          OR (NEW."actorUserId" IS NOT NULL AND NEW."actorUserId" IS DISTINCT FROM OLD."actorUserId")
          OR (NEW."targetUserId" IS NOT NULL AND NEW."targetUserId" IS DISTINCT FROM OLD."targetUserId")
          OR (NEW."ipAddress" IS NOT NULL AND NEW."ipAddress" IS DISTINCT FROM OLD."ipAddress") THEN
          RAISE EXCEPTION 'site_admin_action is write-once' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(
      `CREATE TRIGGER "TR_site_admin_action_guard" BEFORE UPDATE ON "sto_info_app"."site_admin_action" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."site_admin_action_guard"()`,
    );

    for (const table of KEYED_LOGS) {
      await queryRunner.query(
        `ALTER TABLE "sto_info_app"."${table}" ADD "idempotencyKey" varchar(200)`,
      );
      await queryRunner.query(
        `CREATE UNIQUE INDEX "UX_${table}_idempotency" ON "sto_info_app"."${table}" ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL`,
      );
    }

    for (const action of CHAT_ACTIONS_ADDED) {
      await queryRunner.query(
        `ALTER TYPE "sto_info_app"."chat_action_kind_enum" ADD VALUE IF NOT EXISTS '${action}'`,
      );
    }
  }

  /**
   * Reverts the migration: the site admin log, the keys and the transcript
   * actions go. PostgreSQL cannot take a value out of a type, so the chat
   * log's is made again without them.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const chat = `"sto_info_app"."chat_action"`;
    const type = `"sto_info_app"."chat_action_kind_enum"`;

    await queryRunner.query(
      `DELETE FROM ${chat} WHERE "action"::text IN (${CHAT_ACTIONS_ADDED.map(action => `'${action}'`).join(', ')})`,
    );
    await queryRunner.query(
      `ALTER TYPE ${type} RENAME TO "chat_action_kind_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE ${type} AS ENUM (${CHAT_ACTIONS_BEFORE.map(action => `'${action}'`).join(', ')})`,
    );
    await queryRunner.query(
      `ALTER TABLE ${chat} ALTER COLUMN "action" TYPE ${type} USING "action"::text::${type}`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."chat_action_kind_enum_old"`,
    );

    for (const table of KEYED_LOGS) {
      await queryRunner.query(
        `DROP INDEX "sto_info_app"."UX_${table}_idempotency"`,
      );
      await queryRunner.query(
        `ALTER TABLE "sto_info_app"."${table}" DROP COLUMN "idempotencyKey"`,
      );
    }

    await queryRunner.query(`DROP TABLE "sto_info_app"."site_admin_action"`);
    await queryRunner.query(
      `DROP FUNCTION "sto_info_app"."site_admin_action_guard"()`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."site_admin_action_enum"`,
    );
  }
}
