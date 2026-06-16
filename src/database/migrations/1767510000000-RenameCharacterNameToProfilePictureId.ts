import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameCharacterNameToProfilePictureId1767510000000 implements MigrationInterface {
  name = 'RenameCharacterNameToProfilePictureId1767510000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character" RENAME COLUMN "name" TO "profilePictureId"
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character" RENAME COLUMN "nameNormalized" TO "handleNormalized"
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character" ALTER COLUMN "handleNormalized" TYPE character varying(511)
    `);
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character" ALTER COLUMN "handleNormalized" TYPE character varying(255)
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character" RENAME COLUMN "handleNormalized" TO "nameNormalized"
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character" RENAME COLUMN "profilePictureId" TO "name"
    `);
  }
}
