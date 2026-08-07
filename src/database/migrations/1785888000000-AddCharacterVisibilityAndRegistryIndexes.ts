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
    await this.executeQueries(queryRunner, [
      `
      ALTER TABLE "sto_info_app"."character"
      ADD "publiclyVisible" boolean NOT NULL DEFAULT true
    `,
      // Registry listings only ever read opted-in, non-deleted profiles.
      `
      CREATE INDEX "IDX_user_profile_publicly_visible"
      ON "sto_info_app"."user_profile" ("publiclyVisible")
      WHERE "deletedAt" IS NULL
    `,
      // Supports the "Recently Active" sort, which orders by last login.
      `
      CREATE INDEX "IDX_user_last_login_at"
      ON "sto_info_app"."user" ("lastLoginAt")
    `,
      // Supports the case-insensitive username search.
      `
      CREATE INDEX "IDX_user_profile_username_lower"
      ON "sto_info_app"."user_profile" (LOWER("username"))
    `,
      // Supports resolving a profile's publicly visible accounts.
      `
      CREATE INDEX "IDX_account_publicly_visible"
      ON "sto_info_app"."account" ("userId", "publiclyVisible")
      WHERE "deletedAt" IS NULL
    `,
      // Supports resolving an account's publicly visible characters.
      `
      CREATE INDEX "IDX_character_publicly_visible"
      ON "sto_info_app"."character" ("accountId", "publiclyVisible")
      WHERE "deletedAt" IS NULL
    `,
    ]);
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `DROP INDEX "sto_info_app"."IDX_character_publicly_visible"`,
      `DROP INDEX "sto_info_app"."IDX_account_publicly_visible"`,
      `DROP INDEX "sto_info_app"."IDX_user_profile_username_lower"`,
      `DROP INDEX "sto_info_app"."IDX_user_last_login_at"`,
      `DROP INDEX "sto_info_app"."IDX_user_profile_publicly_visible"`,
      `ALTER TABLE "sto_info_app"."character" DROP COLUMN "publiclyVisible"`,
    ]);
  }

  /**
   * Executes migration queries in the given order.
   *
   * @param queryRunner - The TypeORM query runner.
   * @param queries - SQL statements to execute.
   */
  private async executeQueries(
    queryRunner: QueryRunner,
    queries: string[],
  ): Promise<void> {
    for (const query of queries) {
      await queryRunner.query(query);
    }
  }
}
