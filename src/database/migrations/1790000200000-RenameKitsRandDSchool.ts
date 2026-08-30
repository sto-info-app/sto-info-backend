import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameKitsRandDSchool1790000200000 implements MigrationInterface {
  name = 'RenameKitsRandDSchool1790000200000';

  /**
   * Applies updates to character R&D school names to reflect in-game listings.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "sto_info_app"."character_rd_school"
      SET "name" = 'Kits and Modules'
      WHERE "name" = 'Kits'
    `);
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "sto_info_app"."character_rd_school"
      SET "name" = 'Kits'
      WHERE "name" = 'Kits and Modules'
    `);
  }
}
