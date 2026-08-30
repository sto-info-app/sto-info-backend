import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReorderRandD1790000100000 implements MigrationInterface {
  name = 'ReorderRandD1790000100000';

  /**
   * Applies updates to the "sortOrder" of character R&D schools based on their names.
   * The new order now reflects the in-game listings.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "sto_info_app"."character_rd_school"
      SET "sortOrder" = CASE "name"
        WHEN 'Beams' THEN 100
        WHEN 'Cannons' THEN 110
        WHEN 'Engineering' THEN 120
        WHEN 'Ground Weapons' THEN 130
        WHEN 'Kits' THEN 140
        WHEN 'Projectiles' THEN 150
        WHEN 'Science' THEN 160
        WHEN 'Shields' THEN 170
      END
      WHERE "name" IN (
        'Beams',
        'Cannons',
        'Engineering',
        'Ground Weapons',
        'Kits',
        'Projectiles',
        'Science',
        'Shields'
      )
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
      SET "sortOrder" = CASE "name"
        WHEN 'Beams' THEN 10
        WHEN 'Cannons' THEN 20
        WHEN 'Projectiles' THEN 30
        WHEN 'Ground Weapons' THEN 40
        WHEN 'Kits' THEN 50
        WHEN 'Shields' THEN 60
        WHEN 'Engineering' THEN 70
        WHEN 'Science' THEN 80
      END
      WHERE "name" IN (
        'Beams',
        'Cannons',
        'Projectiles',
        'Ground Weapons',
        'Kits',
        'Shields',
        'Engineering',
        'Science'
      )
    `);
  }
}
