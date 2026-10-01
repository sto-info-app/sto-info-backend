import { MigrationInterface, QueryRunner } from 'typeorm';

import { SITE_ADMIN_ACTIONS } from './1796600000000-AddSiteAdminLog';
import { IMAGE_ESTATE_ACTIONS } from './1796700000000-AddPrivateImageDelivery';
import { RESCAN_ACTIONS } from './1796800000000-AddRescanCampaigns';
import { FC050_ACTIONS } from './1797100000000-DecideRescanFindings';

/** The site admin action FC-042's restore check adds to the site admin log. */
export const LEDGER_ACTIONS = ['LEDGERS_RECONCILED'] as const;

/**
 * Why the rollback refuses while the site admin log holds one of the actions.
 */
export const LEDGER_ACTIONS_DOWN_REFUSAL =
  'The site admin log holds LEDGERS_RECONCILED entries: removing the value ' +
  'would lose Security Log history. Nothing was changed; roll forward instead.';

/** The site admin log's actions before this migration. */
const SITE_ADMIN_ACTIONS_BEFORE = [
  ...SITE_ADMIN_ACTIONS,
  ...IMAGE_ESTATE_ACTIONS,
  ...RESCAN_ACTIONS,
  ...FC050_ACTIONS,
];

/**
 * Records the restore check bringing records back (FC-042).
 *
 * With Steve's decisions of 30 September 2026, the backend compares the
 * ledgers it keeps outside the database — roster erasures, moderation hold
 * events and asset denies, in the private quarantine bucket — with the
 * database at every boot, before it serves anything, and puts back what an
 * older backup lacks. When it puts anything back, it says so in the site
 * admin log with no actor: nobody asked for it, the restore did.
 */
export class RecordLedgerReconciliation1797200000000 implements MigrationInterface {
  name = 'RecordLedgerReconciliation1797200000000';

  /**
   * Adds the action.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const action of LEDGER_ACTIONS) {
      await queryRunner.query(
        `ALTER TYPE "sto_info_app"."site_admin_action_enum" ADD VALUE IF NOT EXISTS '${action}'`,
      );
    }
  }

  /**
   * Reverts the migration. The site admin log's type is made again without
   * the action — but not while the log holds one: the log is evidence, and
   * rolling back does not get to rewrite it. It refuses, changing nothing and
   * deleting nothing, and the way on is to roll forward.
   *
   * @param queryRunner - The TypeORM query runner.
   * @throws Error, from PostgreSQL, when the log holds the action.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const type = `"sto_info_app"."site_admin_action_enum"`;
    const log = `"sto_info_app"."site_admin_action"`;

    await queryRunner.query(
      `DO $$ BEGIN IF EXISTS (SELECT 1 FROM ${log} WHERE "action"::text IN (${LEDGER_ACTIONS.map(action => `'${action}'`).join(', ')})) THEN RAISE EXCEPTION '${LEDGER_ACTIONS_DOWN_REFUSAL}'; END IF; END $$`,
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
  }
}
