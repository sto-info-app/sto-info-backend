import { MigrationInterface, QueryRunner } from 'typeorm';

import { SITE_ADMIN_ACTIONS } from './1796600000000-AddSiteAdminLog';
import { IMAGE_ESTATE_ACTIONS } from './1796700000000-AddPrivateImageDelivery';
import { RESCAN_ACTIONS } from './1796800000000-AddRescanCampaigns';
import { FC050_ACTIONS } from './1797100000000-DecideRescanFindings';
import { LEDGER_ACTIONS } from './1797200000000-RecordLedgerReconciliation';
import { OPERATIONS_ACTIONS } from './1797500000000-AddOperationsAlerts';

/** The site admin actions FC-045's feature switches add. */
export const FEATURE_SWITCH_ACTIONS = [
  'FEATURE_SWITCHED_ON',
  'FEATURE_SWITCHED_OFF',
] as const;

/**
 * Why the rollback refuses while the site admin log holds one of the actions.
 */
export const FEATURE_SWITCH_ACTIONS_DOWN_REFUSAL =
  'The site admin log holds feature switch changes: removing the values ' +
  'would lose Security Log history. Nothing was changed; roll forward instead.';

/** The site admin log's actions before this migration. */
const SITE_ADMIN_ACTIONS_BEFORE = [
  ...SITE_ADMIN_ACTIONS,
  ...IMAGE_ESTATE_ACTIONS,
  ...RESCAN_ACTIONS,
  ...FC050_ACTIONS,
  ...LEDGER_ACTIONS,
  ...OPERATIONS_ACTIONS,
];

/**
 * Records a site admin switching a feature on or off from the Admin page
 * (FC-045).
 *
 * With Steve's decisions of 6 October 2026, Fleet Communities, Storytime and
 * Custom Tracking are each switched from the Admin page rather than with SQL,
 * and every change takes a reason that the site admin log keeps.
 */
export class RecordFeatureSwitchChanges1797700000000 implements MigrationInterface {
  name = 'RecordFeatureSwitchChanges1797700000000';

  /**
   * Adds the actions.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const action of FEATURE_SWITCH_ACTIONS) {
      await queryRunner.query(
        `ALTER TYPE "sto_info_app"."site_admin_action_enum" ADD VALUE IF NOT EXISTS '${action}'`,
      );
    }
  }

  /**
   * Reverts the migration. The site admin log's type is made again without
   * the actions — but not while the log holds one: the log is evidence, and
   * rolling back does not get to rewrite it. It refuses, changing nothing and
   * deleting nothing, and the way on is to roll forward.
   *
   * @param queryRunner - The TypeORM query runner.
   * @throws Error, from PostgreSQL, when the log holds either action.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const type = `"sto_info_app"."site_admin_action_enum"`;
    const log = `"sto_info_app"."site_admin_action"`;

    await queryRunner.query(
      `DO $$ BEGIN IF EXISTS (SELECT 1 FROM ${log} WHERE "action"::text IN (${FEATURE_SWITCH_ACTIONS.map(action => `'${action}'`).join(', ')})) THEN RAISE EXCEPTION '${FEATURE_SWITCH_ACTIONS_DOWN_REFUSAL}'; END IF; END $$`,
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
