import { MigrationInterface, QueryRunner } from 'typeorm';

/** The reports before this migration: the five built from the roster. */
const PREVIOUS_REPORTS = [
  'GROWTH',
  'TENURE',
  'RANKS',
  'ACTIVITY',
  'CONTRIBUTION',
];

/** The reports this migration adds (FC-030). */
const ADDED_REPORTS = ['ATTENDANCE', 'RECRUITMENT', 'HOLDINGS'];

/**
 * Event attendance, recruitment and holdings join a Fleet's reports
 * (FC-030).
 *
 * With Steve's decisions of 28 September 2026: attendance and recruitment
 * have an audience the Owner chooses, as the roster's reports do; holdings
 * are public, like the Holdings page, and have none. `HOLDINGS` is added to
 * `fleet_report_enum` all the same, so every report is named by one type;
 * the service never stores an audience for it.
 */
export class AddRecordReports1795900000000 implements MigrationInterface {
  name = 'AddRecordReports1795900000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const report of ADDED_REPORTS) {
      await queryRunner.query(
        `ALTER TYPE "sto_info_app"."fleet_report_enum" ADD VALUE IF NOT EXISTS '${report}'`,
      );
    }
  }

  /**
   * Reverts the migration. The new reports' audiences and their history go,
   * since the earlier type cannot name them; PostgreSQL cannot take a value
   * out of a type, so the type is made again without them.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const added = ADDED_REPORTS.map(value => `'${value}'`).join(', ');
    const previous = PREVIOUS_REPORTS.map(value => `'${value}'`).join(', ');

    for (const table of [
      'fleet_report_audience',
      'fleet_report_audience_change',
    ]) {
      await queryRunner.query(
        `DELETE FROM "sto_info_app"."${table}" WHERE "report"::text IN (${added})`,
      );
    }

    await queryRunner.query(
      `ALTER TYPE "sto_info_app"."fleet_report_enum" RENAME TO "fleet_report_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."fleet_report_enum" AS ENUM (${previous})`,
    );

    for (const table of [
      'fleet_report_audience',
      'fleet_report_audience_change',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "sto_info_app"."${table}" ALTER COLUMN "report" TYPE "sto_info_app"."fleet_report_enum" USING "report"::text::"sto_info_app"."fleet_report_enum"`,
      );
    }

    await queryRunner.query(`DROP TYPE "sto_info_app"."fleet_report_enum_old"`);
  }
}
