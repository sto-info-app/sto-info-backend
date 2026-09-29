import { MigrationInterface, QueryRunner } from 'typeorm';

/** The site admin actions FC-041 adds to the site admin log. */
export const RESCAN_ACTIONS = [
  'RESCAN_STARTED',
  'RESCAN_PAUSED',
  'RESCAN_RESUMED',
  'RESCAN_CANCELLED',
] as const;

/** The site admin log's actions before this migration. */
const SITE_ADMIN_ACTIONS_BEFORE = [
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
  'IMAGE_COPY_STARTED',
  'IMAGE_UNDO_STARTED',
  'IMAGE_RETIRE_STARTED',
  'IMAGE_RUN_PAUSED',
  'IMAGE_RUN_RESUMED',
];

/**
 * Rescan campaigns (FC-041).
 *
 * With Steve's decisions of 29 September 2026:
 *
 * - **Campaigns.** A site admin, or once after release the system for the
 *   legacy estate, rescans a selection of published pictures: by kind, by
 *   upload date, and by how long since they were last scanned.
 *   `file_rescan_campaign` holds each, with its selection, its cursor and
 *   what it has found.
 * - **Rescans.** The API stages a copy of each picture in the quarantine
 *   bucket and asks the worker to scan it as usual. `file_rescan` holds
 *   each: the copy, the policy and the definitions it was asked against,
 *   and the verdict. One picture is rescanned once per policy and
 *   definition epoch, however many campaigns overlap.
 */
export class AddRescanCampaigns1796800000000 implements MigrationInterface {
  name = 'AddRescanCampaigns1796800000000';

  /**
   * Adds the campaigns, the rescans and the log's actions.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."file_rescan_campaign_kind_enum" AS ENUM ('MANUAL', 'LEGACY')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."file_rescan_campaign_state_enum" AS ENUM ('RUNNING', 'PAUSED', 'DONE', 'CANCELLED', 'FAILED')`,
    );
    await queryRunner.query(`CREATE TABLE "sto_info_app"."file_rescan_campaign" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "kind" "sto_info_app"."file_rescan_campaign_kind_enum" NOT NULL,
      "state" "sto_info_app"."file_rescan_campaign_state_enum" NOT NULL DEFAULT 'RUNNING',
      "startedByUserId" uuid,
      "selection" jsonb NOT NULL DEFAULT '{}',
      "cursor" uuid,
      "counts" jsonb NOT NULL DEFAULT '{}',
      "lastError" varchar(500),
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "finishedAt" TIMESTAMP WITH TIME ZONE,
      CONSTRAINT "PK_file_rescan_campaign" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_file_rescan_campaign_finished" CHECK (("state" IN ('DONE', 'CANCELLED')) = ("finishedAt" IS NOT NULL)),
      CONSTRAINT "FK_file_rescan_campaign_started_by" FOREIGN KEY ("startedByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);

    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."file_rescan_state_enum" AS ENUM ('REQUESTED', 'CLEAN', 'INFECTED', 'REFUSED', 'FAILED')`,
    );
    await queryRunner.query(`CREATE TABLE "sto_info_app"."file_rescan" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "campaignId" uuid NOT NULL,
      "assetId" uuid NOT NULL,
      "state" "sto_info_app"."file_rescan_state_enum" NOT NULL DEFAULT 'REQUESTED',
      "stagingKey" varchar(300) NOT NULL,
      "sha256" char(64) NOT NULL,
      "declaredContentType" varchar(100) NOT NULL,
      "policyVersion" integer NOT NULL,
      "definitionEpoch" varchar(255) NOT NULL,
      "rejectionCode" varchar(100),
      "engine" varchar(100),
      "engineVersion" varchar(100),
      "signatureVersion" varchar(100),
      "requestedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "verdictAt" TIMESTAMP WITH TIME ZONE,
      CONSTRAINT "PK_file_rescan" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_file_rescan_staging_key" UNIQUE ("stagingKey"),
      CONSTRAINT "CHK_file_rescan_verdict" CHECK (("state" = 'REQUESTED') = ("verdictAt" IS NULL)),
      CONSTRAINT "CHK_file_rescan_code" CHECK ("state" NOT IN ('INFECTED', 'REFUSED') OR "rejectionCode" IS NOT NULL),
      CONSTRAINT "FK_file_rescan_campaign" FOREIGN KEY ("campaignId") REFERENCES "sto_info_app"."file_rescan_campaign"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_file_rescan_asset" FOREIGN KEY ("assetId") REFERENCES "sto_info_app"."file_asset"("id") ON DELETE RESTRICT ON UPDATE NO ACTION)`);
    // A picture is rescanned once per policy and definition epoch, however
    // many campaigns overlap. A failed rescan may be tried again.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_file_rescan_once" ON "sto_info_app"."file_rescan" ("assetId", "policyVersion", "definitionEpoch") WHERE "state" <> 'FAILED'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_file_rescan_campaign_state" ON "sto_info_app"."file_rescan" ("campaignId", "state")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_file_rescan_requested" ON "sto_info_app"."file_rescan" ("requestedAt") WHERE "state" = 'REQUESTED'`,
    );

    for (const action of RESCAN_ACTIONS) {
      await queryRunner.query(
        `ALTER TYPE "sto_info_app"."site_admin_action_enum" ADD VALUE IF NOT EXISTS '${action}'`,
      );
    }
  }

  /**
   * Reverts the migration. The site admin log's type is made again without
   * FC-041's actions.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const log = `"sto_info_app"."site_admin_action"`;
    const type = `"sto_info_app"."site_admin_action_enum"`;

    await queryRunner.query(
      `DELETE FROM ${log} WHERE "action"::text IN (${RESCAN_ACTIONS.map(action => `'${action}'`).join(', ')})`,
    );
    await queryRunner.query(
      `ALTER TYPE ${type} RENAME TO "site_admin_action_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE ${type} AS ENUM (${SITE_ADMIN_ACTIONS_BEFORE.map(action => `'${action}'`).join(', ')})`,
    );
    await queryRunner.query(
      `ALTER TABLE ${log} ALTER COLUMN "action" TYPE ${type} USING "action"::text::${type}`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."site_admin_action_enum_old"`,
    );

    await queryRunner.query(`DROP TABLE "sto_info_app"."file_rescan"`);
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."file_rescan_state_enum"`,
    );
    await queryRunner.query(`DROP TABLE "sto_info_app"."file_rescan_campaign"`);
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."file_rescan_campaign_state_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."file_rescan_campaign_kind_enum"`,
    );
  }
}
