import { MigrationInterface, QueryRunner } from 'typeorm';

import { SITE_ADMIN_ACTIONS } from './1796600000000-AddSiteAdminLog';
import { IMAGE_ESTATE_ACTIONS } from './1796700000000-AddPrivateImageDelivery';
import { RESCAN_ACTIONS } from './1796800000000-AddRescanCampaigns';
import { FC050_ACTIONS } from './1797100000000-DecideRescanFindings';
import { LEDGER_ACTIONS } from './1797200000000-RecordLedgerReconciliation';
import { OPERATIONS_ACTIONS } from './1797500000000-AddOperationsAlerts';
import { FEATURE_SWITCH_ACTIONS } from './1797700000000-RecordFeatureSwitchChanges';
import {
  PREVIOUS_KINDS,
  PREVIOUS_SUBJECTS,
} from './1798800000000-AllowSiteNewsCovers';

/** The site admin action the Captain's Log adds. */
export const LOG_ENTRY_ACTIONS = ['LOG_ENTRY_REMOVED'] as const;

/** The asset kinds there were before this migration. */
export const KINDS_BEFORE_LOG = [...PREVIOUS_KINDS, 'NEWS_IMAGE'];

/** The placement subjects there were before this migration. */
export const SUBJECTS_BEFORE_LOG = [...PREVIOUS_SUBJECTS, 'SITE_NEWS_POST'];

/** The site admin log's actions before this migration. */
export const SITE_ADMIN_ACTIONS_BEFORE_LOG = [
  ...SITE_ADMIN_ACTIONS,
  ...IMAGE_ESTATE_ACTIONS,
  ...RESCAN_ACTIONS,
  ...FC050_ACTIONS,
  ...LEDGER_ACTIONS,
  ...OPERATIONS_ACTIONS,
  ...FEATURE_SWITCH_ACTIONS,
];

/**
 * Why the rollback refuses while the site admin log holds a removal.
 */
export const LOG_ENTRY_ACTIONS_DOWN_REFUSAL =
  'The site admin log holds Captain’s Log removals: removing the value ' +
  'would lose Security Log history. Nothing was changed; roll forward instead.';

/**
 * The picture column this migration adds, held like every other to pictures
 * the asset registry has published (FC-012's guard).
 */
export const LOG_GUARDED_IMAGE_COLUMNS: readonly (readonly [string, string])[] =
  [['log_entry', 'pictureId']];

/** The table this migration adds. */
export const LOG_ENTRY_TABLE = `"sto_info_app"."log_entry"`;

const SCHEMA = '"sto_info_app"';

/**
 * Adds the Captain's Log (sc-1450).
 *
 * With the decisions of 24 November 2026:
 *
 * - An entry is a Captain's entry, shown on its author's public profile, or a
 *   Personal one that only its author ever sees.
 * - Its stardate is worked out in UTC when it is written and kept, so a
 *   headline left blank reads the same for ever, however often it is edited.
 * - It may carry one described picture, placed against a subject and kind of
 *   its own so rescans and the estate inventory count it apart.
 * - A user report may name the entry it is about, and a site admin may
 *   remove a reported entry: it stays with its author, marked removed, and
 *   the removal is in the Security Log.
 *
 * The enums are widened with `ADD VALUE`, which PostgreSQL allows inside a
 * transaction so long as nothing in the same transaction uses the new value.
 * The way down refuses while the log holds a removal, and a registry row
 * still using the new kind or subject fails the cast, so a revert never
 * quietly discards anything.
 */
export class AddCaptainsLog1799100000000 implements MigrationInterface {
  name = 'AddCaptainsLog1799100000000';

  /**
   * Adds the entries, the report's link to one and the new enum values.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE ${SCHEMA}."file_asset_kind_enum" ADD VALUE IF NOT EXISTS 'LOG_IMAGE'`,
    );
    await queryRunner.query(
      `ALTER TYPE ${SCHEMA}."file_asset_subject_enum" ADD VALUE IF NOT EXISTS 'LOG_ENTRY'`,
    );
    for (const action of LOG_ENTRY_ACTIONS) {
      await queryRunner.query(
        `ALTER TYPE ${SCHEMA}."site_admin_action_enum" ADD VALUE IF NOT EXISTS '${action}'`,
      );
    }
    await queryRunner.query(
      `CREATE TYPE ${SCHEMA}."log_entry_type_enum" AS ENUM ('CAPTAIN', 'PERSONAL')`,
    );
    await queryRunner.query(`CREATE TABLE ${LOG_ENTRY_TABLE} (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "userId" uuid NOT NULL,
      "type" ${SCHEMA}."log_entry_type_enum" NOT NULL,
      "headline" character varying(120),
      "body" text NOT NULL,
      "stardate" numeric(8,2) NOT NULL,
      "pictureId" character varying(160),
      "pictureAlt" character varying(300),
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "editedAt" TIMESTAMP WITH TIME ZONE,
      "removedAt" TIMESTAMP WITH TIME ZONE,
      "removedByUserId" uuid,
      "removedReason" character varying(500),
      CONSTRAINT "PK_log_entry" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_log_entry_headline" CHECK ("headline" IS NULL OR char_length(btrim("headline")) > 0),
      CONSTRAINT "CHK_log_entry_body" CHECK (char_length(btrim("body")) > 0 AND char_length("body") <= 10000),
      CONSTRAINT "CHK_log_entry_stardate" CHECK ("stardate" >= 0),
      CONSTRAINT "CHK_log_entry_picture" CHECK (("pictureId" IS NULL) = ("pictureAlt" IS NULL)),
      CONSTRAINT "CHK_log_entry_removal" CHECK (("removedAt" IS NULL) = ("removedReason" IS NULL)),
      CONSTRAINT "FK_log_entry_user" FOREIGN KEY ("userId") REFERENCES ${SCHEMA}."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_log_entry_removed_by" FOREIGN KEY ("removedByUserId") REFERENCES ${SCHEMA}."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    for (const [table, column] of LOG_GUARDED_IMAGE_COLUMNS) {
      await queryRunner.query(
        `CREATE TRIGGER "TR_${table}_${column}_published" BEFORE INSERT OR UPDATE OF "${column}" ON ${SCHEMA}."${table}" FOR EACH ROW EXECUTE FUNCTION ${SCHEMA}."published_image_reference_guard"('${column}')`,
      );
    }
    await queryRunner.query(
      `CREATE INDEX "IDX_log_entry_user_created" ON ${LOG_ENTRY_TABLE} ("userId", "createdAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_log_entry_public" ON ${LOG_ENTRY_TABLE} ("userId", "createdAt" DESC) WHERE "type" = 'CAPTAIN' AND "removedAt" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE ${SCHEMA}."user_report" ADD "logEntryId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE ${SCHEMA}."user_report" ADD CONSTRAINT "FK_user_report_log_entry" FOREIGN KEY ("logEntryId") REFERENCES ${LOG_ENTRY_TABLE}("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_report_log_entry" ON ${SCHEMA}."user_report" ("logEntryId") WHERE "logEntryId" IS NOT NULL`,
    );
  }

  /**
   * Takes them away again, refusing first while the log holds a removal.
   *
   * @param queryRunner - The TypeORM query runner.
   * @throws Error, from PostgreSQL, when the log holds a removal.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const log = `${SCHEMA}."site_admin_action"`;
    const quotedAdded = LOG_ENTRY_ACTIONS.map(action => `'${action}'`).join(
      ', ',
    );

    await queryRunner.query(
      `DO $$ BEGIN IF EXISTS (SELECT 1 FROM ${log} WHERE "action"::text IN (${quotedAdded})) THEN RAISE EXCEPTION '${LOG_ENTRY_ACTIONS_DOWN_REFUSAL}'; END IF; END $$`,
    );
    await queryRunner.query(`DROP INDEX ${SCHEMA}."IDX_user_report_log_entry"`);
    await queryRunner.query(
      `ALTER TABLE ${SCHEMA}."user_report" DROP CONSTRAINT "FK_user_report_log_entry"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${SCHEMA}."user_report" DROP COLUMN "logEntryId"`,
    );
    await queryRunner.query(`DROP TABLE ${LOG_ENTRY_TABLE}`);
    await queryRunner.query(`DROP TYPE ${SCHEMA}."log_entry_type_enum"`);
    await this.narrow(
      queryRunner,
      'site_admin_action_enum',
      'site_admin_action',
      'action',
      SITE_ADMIN_ACTIONS_BEFORE_LOG,
    );
    await this.narrow(
      queryRunner,
      'file_asset_subject_enum',
      'file_asset_placement',
      'subject',
      SUBJECTS_BEFORE_LOG,
    );
    await this.narrow(
      queryRunner,
      'file_asset_kind_enum',
      'file_asset',
      'kind',
      KINDS_BEFORE_LOG,
    );
  }

  /**
   * Rebuilds one enum with only the values it had before.
   *
   * @param queryRunner - The TypeORM query runner.
   * @param type - The enum type's name.
   * @param table - The table whose column uses it.
   * @param column - That column.
   * @param values - What it held before.
   */
  private async narrow(
    queryRunner: QueryRunner,
    type: string,
    table: string,
    column: string,
    values: readonly string[],
  ): Promise<void> {
    const list = values.map(value => `'${value}'`).join(', ');

    await queryRunner.query(
      `ALTER TYPE ${SCHEMA}."${type}" RENAME TO "${type}_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE ${SCHEMA}."${type}" AS ENUM (${list})`,
    );
    await queryRunner.query(
      `ALTER TABLE ${SCHEMA}."${table}" ALTER COLUMN "${column}" TYPE ${SCHEMA}."${type}" USING "${column}"::text::${SCHEMA}."${type}"`,
    );
    await queryRunner.query(`DROP TYPE ${SCHEMA}."${type}_old"`);
  }
}
