import { MigrationInterface, QueryRunner } from 'typeorm';

/** The site admin actions FC-040 adds to the site admin log. */
export const IMAGE_ESTATE_ACTIONS = [
  'IMAGE_COPY_STARTED',
  'IMAGE_UNDO_STARTED',
  'IMAGE_RETIRE_STARTED',
  'IMAGE_RUN_PAUSED',
  'IMAGE_RUN_RESUMED',
] as const;

/** The site admin actions before this migration. */
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
];

/**
 * Private image delivery and the image estate's runs (FC-040).
 *
 * With Steve's decisions of 29 September 2026:
 *
 * - **Signed addresses.** A published picture is a private Cloudflare Images
 *   object, reachable only by an address the API signs, and only while its
 *   asset may be shown. `file_asset.deliveryPrivate` says which pictures are
 *   private already. Cloudflare will not make a custom-ID image private, so
 *   every existing picture is copied to a private one under a generated ID.
 * - **Runs.** A site admin copies the estate, undoes the copies or retires
 *   the old public copies in checkpointed runs, one at a time, each paused
 *   and resumed at will. `image_estate_step` records each picture's copy:
 *   what it replaced and every row it repointed, which is what undo reads.
 * - **Inventory.** `image_inventory_run` keeps each reconciliation of the
 *   registry, the feature tables and Cloudflare's listing. It reports; it
 *   deletes nothing.
 */
export class AddPrivateImageDelivery1796700000000 implements MigrationInterface {
  name = 'AddPrivateImageDelivery1796700000000';

  /**
   * Adds the flag, the run tables and the log's actions.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."file_asset" ADD "deliveryPrivate" boolean NOT NULL DEFAULT false`,
    );

    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."image_estate_run_kind_enum" AS ENUM ('COPY', 'UNDO', 'RETIRE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."image_estate_run_state_enum" AS ENUM ('RUNNING', 'PAUSED', 'DONE', 'FAILED')`,
    );
    await queryRunner.query(`CREATE TABLE "sto_info_app"."image_estate_run" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "kind" "sto_info_app"."image_estate_run_kind_enum" NOT NULL,
      "state" "sto_info_app"."image_estate_run_state_enum" NOT NULL DEFAULT 'RUNNING',
      "startedByUserId" uuid,
      "cursor" uuid,
      "counts" jsonb NOT NULL DEFAULT '{}',
      "lastError" varchar(500),
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "finishedAt" TIMESTAMP WITH TIME ZONE,
      CONSTRAINT "PK_image_estate_run" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_image_estate_run_finished" CHECK (("state" = 'DONE') = ("finishedAt" IS NOT NULL)),
      CONSTRAINT "FK_image_estate_run_started_by" FOREIGN KEY ("startedByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    // One run at a time: a copy, an undo and a retirement would otherwise
    // repoint the same rows from both ends.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_image_estate_run_open" ON "sto_info_app"."image_estate_run" ((true)) WHERE "state" <> 'DONE'`,
    );

    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."image_estate_step_state_enum" AS ENUM ('PENDING', 'COPIED', 'UNDONE', 'RETIRED', 'FAILED')`,
    );
    await queryRunner.query(`CREATE TABLE "sto_info_app"."image_estate_step" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "runId" uuid NOT NULL,
      "assetId" uuid NOT NULL,
      "state" "sto_info_app"."image_estate_step_state_enum" NOT NULL DEFAULT 'PENDING',
      "fromReference" varchar(200) NOT NULL,
      "fromStorage" "sto_info_app"."file_asset_storage_enum" NOT NULL,
      "toReference" varchar(200),
      "sha256" char(64),
      "byteSize" integer,
      "detectedContentType" varchar(100),
      "references" jsonb NOT NULL DEFAULT '[]',
      "placementIds" jsonb NOT NULL DEFAULT '[]',
      "error" varchar(500),
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "copiedAt" TIMESTAMP WITH TIME ZONE,
      "undoneAt" TIMESTAMP WITH TIME ZONE,
      "retiredAt" TIMESTAMP WITH TIME ZONE,
      CONSTRAINT "PK_image_estate_step" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_image_estate_step_copied" CHECK ("state" IN ('PENDING', 'FAILED') OR "toReference" IS NOT NULL),
      CONSTRAINT "FK_image_estate_step_run" FOREIGN KEY ("runId") REFERENCES "sto_info_app"."image_estate_run"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_image_estate_step_asset" FOREIGN KEY ("assetId") REFERENCES "sto_info_app"."file_asset"("id") ON DELETE RESTRICT ON UPDATE NO ACTION)`);
    // A picture is copied once; an undone copy may be made again.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_image_estate_step_asset" ON "sto_info_app"."image_estate_step" ("assetId") WHERE "state" IN ('PENDING', 'COPIED', 'RETIRED')`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_image_estate_step_state" ON "sto_info_app"."image_estate_step" ("state")`,
    );

    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."image_inventory_run_state_enum" AS ENUM ('RUNNING', 'DONE', 'FAILED')`,
    );
    await queryRunner.query(`CREATE TABLE "sto_info_app"."image_inventory_run" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "state" "sto_info_app"."image_inventory_run_state_enum" NOT NULL DEFAULT 'RUNNING',
      "startedByUserId" uuid,
      "report" jsonb,
      "error" varchar(500),
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "finishedAt" TIMESTAMP WITH TIME ZONE,
      CONSTRAINT "PK_image_inventory_run" PRIMARY KEY ("id"),
      CONSTRAINT "FK_image_inventory_run_started_by" FOREIGN KEY ("startedByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);

    for (const action of IMAGE_ESTATE_ACTIONS) {
      await queryRunner.query(
        `ALTER TYPE "sto_info_app"."site_admin_action_enum" ADD VALUE IF NOT EXISTS '${action}'`,
      );
    }
  }

  /**
   * Reverts the migration. PostgreSQL cannot take a value out of a type, so
   * the site admin log's is made again without FC-040's.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const log = `"sto_info_app"."site_admin_action"`;
    const type = `"sto_info_app"."site_admin_action_enum"`;

    // The log is write-once; its trigger refuses updates, not deletes.
    await queryRunner.query(
      `DELETE FROM ${log} WHERE "action"::text IN (${IMAGE_ESTATE_ACTIONS.map(action => `'${action}'`).join(', ')})`,
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

    await queryRunner.query(`DROP TABLE "sto_info_app"."image_inventory_run"`);
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."image_inventory_run_state_enum"`,
    );
    await queryRunner.query(`DROP TABLE "sto_info_app"."image_estate_step"`);
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."image_estate_step_state_enum"`,
    );
    await queryRunner.query(`DROP TABLE "sto_info_app"."image_estate_run"`);
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."image_estate_run_state_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."image_estate_run_kind_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."file_asset" DROP COLUMN "deliveryPrivate"`,
    );
  }
}
