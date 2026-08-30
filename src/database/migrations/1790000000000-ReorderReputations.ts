import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReorderReputations1790000000000 implements MigrationInterface {
  name = 'ReorderReputations1790000000000';

  /**
   * Applies updates to the "sortOrder" of character reputations based on their names.
   * The new order now reflects the in-game listings.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "sto_info_app"."character_reputation"
      SET "sortOrder" = CASE "name"
        WHEN 'Discovery Legends' THEN 100
        WHEN 'Task Force Omega' THEN 110
        WHEN 'Nukara Strikeforce' THEN 120
        WHEN 'New Romulus' THEN 130
        WHEN 'Dyson Joint Command' THEN 140
        WHEN '8472 Counter-Command' THEN 150
        WHEN 'Delta Alliance' THEN 160
        WHEN 'Iconian Resistance' THEN 170
        WHEN 'Terran Task Force' THEN 180
        WHEN 'Temporal Defense Initiative' THEN 190
        WHEN 'Lukari Restoration Initiative' THEN 200
        WHEN 'Competitive Wargames' THEN 210
        WHEN 'Gamma Task Force' THEN 220
      END
      WHERE "name" IN (
        'Discovery Legends',
        'Task Force Omega',
        'Nukara Strikeforce',
        'New Romulus',
        'Dyson Joint Command',
        '8472 Counter-Command',
        'Delta Alliance',
        'Iconian Resistance',
        'Terran Task Force',
        'Temporal Defense Initiative',
        'Lukari Restoration Initiative',
        'Competitive Wargames',
        'Gamma Task Force'
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
      UPDATE "sto_info_app"."character_reputation"
      SET "sortOrder" = CASE "name"
        WHEN 'Task Force Omega' THEN 10
        WHEN 'New Romulus' THEN 20
        WHEN 'Nukara Strikeforce' THEN 30
        WHEN 'Dyson Joint Command' THEN 40
        WHEN '8472 Counter-Command' THEN 50
        WHEN 'Delta Alliance' THEN 60
        WHEN 'Iconian Resistance' THEN 70
        WHEN 'Terran Task Force' THEN 80
        WHEN 'Temporal Defense Initiative' THEN 90
        WHEN 'Lukari Restoration Initiative' THEN 100
        WHEN 'Competitive Wargames' THEN 110
        WHEN 'Gamma Task Force' THEN 120
        WHEN 'Discovery Legends' THEN 130
      END
      WHERE "name" IN (
        'Task Force Omega',
        'New Romulus',
        'Nukara Strikeforce',
        'Dyson Joint Command',
        '8472 Counter-Command',
        'Delta Alliance',
        'Iconian Resistance',
        'Terran Task Force',
        'Temporal Defense Initiative',
        'Lukari Restoration Initiative',
        'Competitive Wargames',
        'Gamma Task Force',
        'Discovery Legends'
      )
    `);
  }
}
