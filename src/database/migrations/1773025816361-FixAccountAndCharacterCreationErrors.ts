import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixAccountAndCharacterCreationErrors1773025816361 implements MigrationInterface {
  name = 'FixAccountAndCharacterCreationErrors1773025816361';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_account_handle_slug"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_character_full_handle_slug"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_character_full_handle_slug" ` +
        `ON "sto_info_app"."character" ("accountId", "fullHandleSlug") ` +
        `WHERE ("deletedAt" IS NULL)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_account_handle_slug" ` +
        `ON "sto_info_app"."account" ("handleSlug", "userId") ` +
        `WHERE ("deletedAt" IS NULL)`,
    );
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_character_full_handle_slug"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_account_handle_slug"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_character_full_handle_slug" ` +
        `ON "sto_info_app"."character" ("fullHandleSlug") ` +
        `WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_account_handle_slug" ` +
        `ON "sto_info_app"."account" ("handleSlug") ` +
        `WHERE "deletedAt" IS NULL`,
    );
  }
}
