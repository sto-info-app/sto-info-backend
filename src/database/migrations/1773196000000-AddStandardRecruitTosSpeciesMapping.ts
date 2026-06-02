import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStandardRecruitTosSpeciesMapping1773196000000 implements MigrationInterface {
  name = 'AddStandardRecruitTosSpeciesMapping1773196000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Standard recruits were missing the 23c species, leaving TOS Starfleet
    // with no selectable species when recruit type is Standard.
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."recruit_type_species_mapping" ("recruitTypeId", "speciesId")
      SELECT rt.id, s.id
      FROM "sto_info_app"."character_recruit_type" rt, "sto_info_app"."character_species" s
      WHERE rt.name = 'Standard'
      AND s.name IN ('23c Andorian', '23c Human', '23c Tellarite', '23c Vulcan')
      ON CONFLICT DO NOTHING
    `);
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "sto_info_app"."recruit_type_species_mapping"
      WHERE "recruitTypeId" = (
        SELECT id FROM "sto_info_app"."character_recruit_type" WHERE name = 'Standard'
      )
      AND "speciesId" IN (
        SELECT id FROM "sto_info_app"."character_species"
        WHERE name IN ('23c Andorian', '23c Human', '23c Tellarite', '23c Vulcan')
      )
    `);
  }
}
