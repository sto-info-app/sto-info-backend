import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateStorytimeLanguages1789900000000 implements MigrationInterface {
  name = 'UpdateStorytimeLanguages1789900000000';

  /**
   * Replaces the old generic English code with UK English and changes the
   * Storytime defaults to the new BCP 47 code.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "sto_info_app"."storytime_story"
      SET "languageCode" = 'en-GB'
      WHERE "languageCode" = 'en'
    `);
    await queryRunner.query(`
      UPDATE "sto_info_app"."storytime_chapter"
      SET "languageCode" = 'en-GB'
      WHERE "languageCode" = 'en'
    `);
    await queryRunner.query(`
      UPDATE "sto_info_app"."storytime_arc"
      SET "languageCode" = 'en-GB'
      WHERE "languageCode" = 'en'
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."storytime_story"
      ALTER COLUMN "languageCode" SET DEFAULT 'en-GB'
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."storytime_arc"
      ALTER COLUMN "languageCode" SET DEFAULT 'en-GB'
    `);
  }

  /**
   * Restores the previous generic English code and schema defaults.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."storytime_story"
      ALTER COLUMN "languageCode" SET DEFAULT 'en'
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."storytime_arc"
      ALTER COLUMN "languageCode" SET DEFAULT 'en'
    `);
    await queryRunner.query(`
      UPDATE "sto_info_app"."storytime_story"
      SET "languageCode" = 'en'
      WHERE "languageCode" = 'en-GB'
    `);
    await queryRunner.query(`
      UPDATE "sto_info_app"."storytime_chapter"
      SET "languageCode" = 'en'
      WHERE "languageCode" = 'en-GB'
    `);
    await queryRunner.query(`
      UPDATE "sto_info_app"."storytime_arc"
      SET "languageCode" = 'en'
      WHERE "languageCode" = 'en-GB'
    `);
  }
}
