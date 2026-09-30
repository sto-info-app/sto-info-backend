import { MigrationInterface, QueryRunner } from 'typeorm';

import { RESCAN_ACTIONS } from './1796800000000-AddRescanCampaigns';

/** The site admin actions FC-050 adds to the site admin log. */
export const FC050_ACTIONS = [
  'CHAT_MESSAGE_REMOVED',
  'IMAGE_TAKEN_DOWN',
  'IMAGE_KEPT',
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
  ...RESCAN_ACTIONS,
];

/**
 * A site admin's decision on a picture refused for policy on rescan, and
 * two actions the site admin log was missing (FC-050).
 *
 * With Steve's decisions of 30 September 2026:
 *
 * - **Take it down or keep it.** A picture refused for policy on rescan
 *   stays up and is listed on Scan Diagnostics for a site admin to decide
 *   (FC-041), and until now nothing could decide it. Either decision takes
 *   a reason and is logged; a takedown tells the owner, as an infected
 *   picture's does. A decided finding leaves the list.
 * - **A chat message a site admin removes** is logged in the site admin
 *   log as well as chat's own, so the Security Log shows it with the rest
 *   of what site admins do.
 */
export class DecideRescanFindings1797100000000 implements MigrationInterface {
  name = 'DecideRescanFindings1797100000000';

  /**
   * Adds the decision and the log's actions.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."file_rescan_decision_enum" AS ENUM ('TAKEN_DOWN', 'KEPT')`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."file_rescan" ADD COLUMN "decision" "sto_info_app"."file_rescan_decision_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."file_rescan" ADD COLUMN "decidedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."file_rescan" ADD COLUMN "decidedByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."file_rescan" ADD CONSTRAINT "FK_file_rescan_decided_by" FOREIGN KEY ("decidedByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    // Only a policy refusal waits on a site admin, and a decision always
    // says when it was made.
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."file_rescan" ADD CONSTRAINT "CHK_file_rescan_decision" CHECK (("decision" IS NULL) = ("decidedAt" IS NULL) AND ("decision" IS NULL OR "state" = 'REFUSED'))`,
    );

    for (const action of FC050_ACTIONS) {
      await queryRunner.query(
        `ALTER TYPE "sto_info_app"."site_admin_action_enum" ADD VALUE IF NOT EXISTS '${action}'`,
      );
    }
  }

  /**
   * Reverts the migration. The site admin log's type is made again without
   * the new actions, which fails while the log holds one: the log is
   * evidence, and rolling back does not get to rewrite it.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const type = `"sto_info_app"."site_admin_action_enum"`;
    const log = `"sto_info_app"."site_admin_action"`;

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

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."file_rescan" DROP CONSTRAINT "CHK_file_rescan_decision"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."file_rescan" DROP CONSTRAINT "FK_file_rescan_decided_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."file_rescan" DROP COLUMN "decidedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."file_rescan" DROP COLUMN "decidedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."file_rescan" DROP COLUMN "decision"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."file_rescan_decision_enum"`,
    );
  }
}
