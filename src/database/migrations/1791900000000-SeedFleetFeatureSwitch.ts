import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the Fleet Community master switch, disabled (FC-006).
 *
 * Plan section 10 requires the switch to exist from the moment the schema does
 * and to start off. The tables from FC-004 and FC-005 are already in place, so
 * without this an environment has Fleet schema and no way to say whether Fleet
 * is live — and `SettingsService.getBoolean` would answer from its caller's
 * default rather than from anything an administrator had decided.
 *
 * Seeded as its own migration rather than added to FC-004's because that one
 * has been applied and rehearsed. Editing an applied migration changes what a
 * fresh database gets without changing what an existing one has.
 *
 * `ON CONFLICT DO NOTHING` because an environment that has already been
 * switched on by hand must not be switched back off by a deployment.
 */
export class SeedFleetFeatureSwitch1791900000000 implements MigrationInterface {
  name = 'SeedFleetFeatureSwitch1791900000000';

  /**
   * Applies the migration.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "sto_info_app"."app_setting" ("key", "value", "description")
       VALUES ('FLEET_COMMUNITIES_ENABLED', 'false', 'Master switch for the Fleet Community feature. File scanning and retention jobs are site-wide and are not affected by this setting.')
       ON CONFLICT ("key") DO NOTHING`,
    );
  }

  /**
   * Reverts the migration.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."app_setting" WHERE "key" = 'FLEET_COMMUNITIES_ENABLED'`,
    );
  }
}
