import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixKlingonRecruitAndKdfSpeciesMappings1773197000000 implements MigrationInterface {
  name = 'FixKlingonRecruitAndKdfSpeciesMappings1773197000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Per the STO wiki, Klingon (Discovery) is a KDF faction species,
    // but was missing from the KDF faction_species_mapping (it was only
    // mapped to Discovery Starfleet).
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."faction_species_mapping" ("factionId", "speciesId")
      SELECT f.id, s.id
      FROM "sto_info_app"."character_faction" f, "sto_info_app"."character_species" s
      WHERE f.name = 'Klingon Defense Force'
      AND s.name = 'Klingon (Discovery)'
      ON CONFLICT DO NOTHING
    `);

    // Per the STO wiki, Klingon Recruitment allows any KDF faction species.
    // The original mapping only included a narrow subset; the remaining KDF
    // species — Liberated Borg Klingon, Alien, Cardassian, Talaxian,
    // Trill (joined), and Klingon (Discovery) — were missing.
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."recruit_type_species_mapping" ("recruitTypeId", "speciesId")
      SELECT rt.id, s.id
      FROM "sto_info_app"."character_recruit_type" rt, "sto_info_app"."character_species" s
      WHERE rt.name = 'Klingon'
      AND s.name IN (
        'Liberated Borg Klingon',
        'Alien',
        'Cardassian',
        'Talaxian',
        'Trill (joined)',
        'Klingon (Discovery)'
      )
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove Klingon (Discovery) from KDF faction_species_mapping
    await queryRunner.query(`
      DELETE FROM "sto_info_app"."faction_species_mapping"
      WHERE "factionId" = (
        SELECT id FROM "sto_info_app"."character_faction" WHERE name = 'Klingon Defense Force'
      )
      AND "speciesId" = (
        SELECT id FROM "sto_info_app"."character_species" WHERE name = 'Klingon (Discovery)'
      )
    `);

    // Remove the newly added Klingon recruit species
    await queryRunner.query(`
      DELETE FROM "sto_info_app"."recruit_type_species_mapping"
      WHERE "recruitTypeId" = (
        SELECT id FROM "sto_info_app"."character_recruit_type" WHERE name = 'Klingon'
      )
      AND "speciesId" IN (
        SELECT id FROM "sto_info_app"."character_species"
        WHERE name IN (
          'Liberated Borg Klingon',
          'Alien',
          'Cardassian',
          'Talaxian',
          'Trill (joined)',
          'Klingon (Discovery)'
        )
      )
    `);
  }
}
