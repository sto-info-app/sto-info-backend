import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCharacterVisibilityAndRegistryIndexes1785888000000 implements MigrationInterface {
  name = 'AddCharacterVisibilityAndRegistryIndexes1785888000000';

  /**
   * Applies the migration to the database.
   *
   * Adds the per-character public visibility flag that completes the
   * profile -> account -> character opt-in chain used by the Galactic
   * Personnel Registry, then adds the indexes the registry's list, search and
   * sort queries depend on.
   *
   * The column defaults to `true` to match `account."publiclyVisible"`. This is
   * safe because `user_profile."publiclyVisible"` defaults to `false` and acts
   * as the master gate, so no captain becomes public until its owner opts in.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character"
      ADD "publiclyVisible" boolean NOT NULL DEFAULT true
    `);

    // Registry listings only ever read opted-in, non-deleted profiles.
    await queryRunner.query(`
      CREATE INDEX "IDX_user_profile_publicly_visible"
      ON "sto_info_app"."user_profile" ("publiclyVisible")
      WHERE "deletedAt" IS NULL
    `);

    // Supports the "Recently Active" sort, which orders by last login.
    await queryRunner.query(`
      CREATE INDEX "IDX_user_last_login_at"
      ON "sto_info_app"."user" ("lastLoginAt")
    `);

    // Supports the case-insensitive username search.
    await queryRunner.query(`
      CREATE INDEX "IDX_user_profile_username_lower"
      ON "sto_info_app"."user_profile" (LOWER("username"))
    `);

    // Supports resolving a profile's publicly visible accounts.
    await queryRunner.query(`
      CREATE INDEX "IDX_account_publicly_visible"
      ON "sto_info_app"."account" ("userId", "publiclyVisible")
      WHERE "deletedAt" IS NULL
    `);

    // Supports resolving an account's publicly visible characters.
    await queryRunner.query(`
      CREATE INDEX "IDX_character_publicly_visible"
      ON "sto_info_app"."character" ("accountId", "publiclyVisible")
      WHERE "deletedAt" IS NULL
    `);
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_character_publicly_visible"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_account_publicly_visible"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_user_profile_username_lower"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_user_last_login_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_user_profile_publicly_visible"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" DROP COLUMN "publiclyVisible"`,
    );
  }
}
