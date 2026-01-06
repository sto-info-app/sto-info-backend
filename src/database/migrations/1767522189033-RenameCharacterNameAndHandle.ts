import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameCharacterNameAndHandle1767522189033 implements MigrationInterface {
  name = 'RenameCharacterNameAndHandle1767522189033';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop existing indices first
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_character_handle_slug"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_character_account_handle_normalized"`,
    );

    // Rename columns to preserve data
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" RENAME COLUMN "handle" TO "fullHandle"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" RENAME COLUMN "handleNormalized" TO "fullHandleNormalized"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" RENAME COLUMN "handleSlug" TO "fullHandleSlug"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" RENAME COLUMN "name" TO "handle"`,
    );

    // Recreate indices with new column names
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_character_full_handle_slug" ON "sto_info_app"."character" ("fullHandleSlug") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_character_account_handle_normalized" ON "sto_info_app"."character" ("accountId", "fullHandleNormalized") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_character_account_handle_normalized"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_character_full_handle_slug"`,
    );

    // Reverse renames
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" RENAME COLUMN "handle" TO "name"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" RENAME COLUMN "fullHandleSlug" TO "handleSlug"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" RENAME COLUMN "fullHandleNormalized" TO "handleNormalized"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" RENAME COLUMN "fullHandle" TO "handle"`,
    );

    // Recreate original indices
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_character_account_handle_normalized" ON "sto_info_app"."character" ("accountId", "handleNormalized") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_character_handle_slug" ON "sto_info_app"."character" ("handleSlug") WHERE "deletedAt" IS NULL`,
    );
  }
}
