import { MigrationInterface, QueryRunner } from 'typeorm';

import { SITE_ADMIN_ACTIONS } from './1796600000000-AddSiteAdminLog';
import { IMAGE_ESTATE_ACTIONS } from './1796700000000-AddPrivateImageDelivery';
import { RESCAN_ACTIONS } from './1796800000000-AddRescanCampaigns';
import { FC050_ACTIONS } from './1797100000000-DecideRescanFindings';
import { LEDGER_ACTIONS } from './1797200000000-RecordLedgerReconciliation';

/** The site admin actions FC-042's operations controls add. */
export const OPERATIONS_ACTIONS = [
  'SCAN_DIAGNOSTICS_VIEWED',
  'SCAN_JOB_RETRIED',
  'PUBLICATION_PAUSED',
  'PUBLICATION_RESUMED',
  'SCAN_JOB_DISCARDED',
] as const;

/** The problems the operations alert cron watches for. */
export const OPERATIONS_ALERT_KINDS = [
  'SCAN_QUEUE_LAG',
  'PUBLICATION_QUEUE_LAG',
  'WORKER_SILENT',
  'WORKER_PAUSED',
  'SIGNATURES_STALE',
  'FAILED_JOBS',
  'PUBLICATION_PAUSED_LONG',
  'QUEUES_UNREACHABLE',
] as const;

/** The publication switch's key and its seeded, running value. */
export const PUBLICATION_SWITCH = {
  key: 'FILE_PUBLICATION_PAUSED',
  value: '{"paused":false}',
} as const;

/** The site admin log's actions before this migration. */
const SITE_ADMIN_ACTIONS_BEFORE = [
  ...SITE_ADMIN_ACTIONS,
  ...IMAGE_ESTATE_ACTIONS,
  ...RESCAN_ACTIONS,
  ...FC050_ACTIONS,
  ...LEDGER_ACTIONS,
];

/**
 * Operations alerts, logged diagnostics and the publication pause (FC-042).
 *
 * With Steve's decisions of 30 September 2026:
 *
 * - **Alerts.** A backend cron checks every minute for a scan or
 *   publication backlog, a silent or long-paused scan worker, old
 *   signatures, failed jobs and a publication pause left on, and tells
 *   every site admin in-app — once when a problem opens and once when it
 *   clears. It also says when Redis, which carries every queue, has not
 *   answered for two minutes. `operations_alert` holds each occurrence; a partial unique index
 *   keeps one of each kind open at a time, so two instances cannot both open
 *   and announce the same problem. Its detail is counts and ages only, and
 *   a CHECK refuses anything that is not a number.
 * - **The site admin log** gains five actions: a read of Scan Diagnostics
 *   (every page view is logged), a failed job retried or discarded, and
 *   publication paused and resumed.
 * - **The publication pause** is an `app_setting`, seeded running. One key
 *   holding a small JSON object — whether it is paused, since when and by
 *   whom — rather than three, so the three are always written and read
 *   together; the table's own `updatedAt` is a zoneless timestamp and its
 *   `updatedByUserId` says only who last touched it. `ON CONFLICT DO NOTHING`
 *   so a deployment never un-pauses an environment.
 */
export class AddOperationsAlerts1797500000000 implements MigrationInterface {
  name = 'AddOperationsAlerts1797500000000';

  /**
   * Adds the alerts, the actions and the switch.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."operations_alert_kind_enum" AS ENUM (${OPERATIONS_ALERT_KINDS.map(kind => `'${kind}'`).join(', ')})`,
    );
    await queryRunner.query(`CREATE TABLE "sto_info_app"."operations_alert" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "kind" "sto_info_app"."operations_alert_kind_enum" NOT NULL,
      "openedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "clearedAt" TIMESTAMP WITH TIME ZONE,
      "detail" jsonb NOT NULL DEFAULT '{}',
      CONSTRAINT "PK_operations_alert" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_operations_alert_order" CHECK ("lastSeenAt" >= "openedAt" AND ("clearedAt" IS NULL OR "clearedAt" >= "openedAt")),
      CONSTRAINT "CHK_operations_alert_detail" CHECK (jsonb_typeof("detail") = 'object' AND NOT jsonb_path_exists("detail", '$.* ? (@.type() != "number")')))`);
    // One open alert of each kind: the second instance to see a problem
    // finds it already open, and tells nobody again.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_operations_alert_open" ON "sto_info_app"."operations_alert" ("kind") WHERE "clearedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_operations_alert_opened" ON "sto_info_app"."operations_alert" ("openedAt")`,
    );

    for (const action of OPERATIONS_ACTIONS) {
      await queryRunner.query(
        `ALTER TYPE "sto_info_app"."site_admin_action_enum" ADD VALUE IF NOT EXISTS '${action}'`,
      );
    }

    await queryRunner.query(
      `INSERT INTO "sto_info_app"."app_setting" ("key", "value", "description")
       VALUES ('${PUBLICATION_SWITCH.key}', '${PUBLICATION_SWITCH.value}', 'Pauses publication of scanned uploads: they are still accepted and scanned, and publish when it is resumed. Changed only from the Admin page, with a reason. Independent of every feature switch.')
       ON CONFLICT ("key") DO NOTHING`,
    );
  }

  /**
   * Reverts the migration.
   *
   * Refused, before anything is changed, in two cases:
   *
   * - **While publication is paused.** The code before this migration
   *   cannot resume the queue, so rolling back would leave every upload
   *   unpublished with no switch to throw.
   * - **Once the site admin log holds any of the five actions.** The type
   *   cannot be made again without them while a row uses one, and deleting
   *   those rows would lose Security Log history: the log is evidence, and
   *   rolling back does not get to rewrite it. Roll forward instead.
   *
   * Otherwise the switch, the actions and the alerts are taken out again.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const type = `"sto_info_app"."site_admin_action_enum"`;
    const log = `"sto_info_app"."site_admin_action"`;

    await queryRunner.query(
      `DO $$ BEGIN IF EXISTS (SELECT 1 FROM "sto_info_app"."app_setting" WHERE "key" = '${PUBLICATION_SWITCH.key}' AND "value"::jsonb ->> 'paused' = 'true') THEN RAISE EXCEPTION 'Publication is paused; resume it before rolling back'; END IF; END $$`,
    );
    await queryRunner.query(
      `DO $$ BEGIN IF EXISTS (SELECT 1 FROM ${log} WHERE "action"::text IN (${OPERATIONS_ACTIONS.map(action => `'${action}'`).join(', ')})) THEN RAISE EXCEPTION 'The Security Log holds operations actions (FC-042); removing them would lose its history, so this migration cannot be rolled back. Roll forward instead'; END IF; END $$`,
    );
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."app_setting" WHERE "key" = '${PUBLICATION_SWITCH.key}'`,
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

    await queryRunner.query(`DROP TABLE "sto_info_app"."operations_alert"`);
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."operations_alert_kind_enum"`,
    );
  }
}
