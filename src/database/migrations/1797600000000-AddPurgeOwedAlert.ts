import { MigrationInterface, QueryRunner } from 'typeorm';

import { OPERATIONS_ALERT_KINDS } from './1797500000000-AddOperationsAlerts';

/** The operations alert FC-043 adds. */
export const PURGE_OWED_ALERT = 'PURGE_OWED';

/**
 * An operations alert for a withdrawn picture still online (FC-043).
 *
 * Withdrawing a published picture deletes it from Cloudflare after revoking
 * its row, and a delete that failed was never tried again. FC-043 adds an
 * hourly sweep that retries every owed purge, and this alert, which tells
 * every site admin once one has been owed for a day. The sweep reads the
 * partial index `IDX_file_asset_purge_outstanding`, which FC-012 created
 * for exactly this, so the only change here is the alert's kind.
 */
export class AddPurgeOwedAlert1797600000000 implements MigrationInterface {
  name = 'AddPurgeOwedAlert1797600000000';

  /**
   * Adds the kind.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "sto_info_app"."operations_alert_kind_enum" ADD VALUE IF NOT EXISTS '${PURGE_OWED_ALERT}'`,
    );
  }

  /**
   * Reverts the migration.
   *
   * Refused, before anything is changed, once any alert of the kind has
   * been recorded: the type cannot be made again without the value while a
   * row uses it, and deleting the row would lose the record of a picture
   * that stayed online. Roll forward instead. Otherwise the type is made
   * again without it.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const type = `"sto_info_app"."operations_alert_kind_enum"`;
    const table = `"sto_info_app"."operations_alert"`;

    await queryRunner.query(
      `DO $$ BEGIN IF EXISTS (SELECT 1 FROM ${table} WHERE "kind"::text = '${PURGE_OWED_ALERT}') THEN RAISE EXCEPTION 'Operations alerts of kind ${PURGE_OWED_ALERT} (FC-043) have been recorded; removing the kind would lose them, so this migration cannot be rolled back. Roll forward instead'; END IF; END $$`,
    );
    await queryRunner.query(
      `ALTER TYPE ${type} RENAME TO "operations_alert_kind_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE ${type} AS ENUM (${OPERATIONS_ALERT_KINDS.map(kind => `'${kind}'`).join(', ')})`,
    );
    await queryRunner.query(
      `ALTER TABLE ${table} ALTER COLUMN "kind" TYPE ${type} USING "kind"::text::${type}`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."operations_alert_kind_enum_old"`,
    );
  }
}
