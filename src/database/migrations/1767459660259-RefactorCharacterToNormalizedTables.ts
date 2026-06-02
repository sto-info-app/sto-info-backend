import { MigrationInterface, QueryRunner } from 'typeorm';

export class RefactorCharacterToNormalizedTables1767459660259 implements MigrationInterface {
  name = 'RefactorCharacterToNormalizedTables1767459660259';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."character_class" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(50) NOT NULL,
        CONSTRAINT "UQ_character_class_name" UNIQUE ("name"),
        CONSTRAINT "PK_character_class" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."character_species" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(100) NOT NULL,
        CONSTRAINT "UQ_character_species_name" UNIQUE ("name"),
        CONSTRAINT "PK_character_species" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."character_recruit_type" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(50) NOT NULL,
        CONSTRAINT "UQ_character_recruit_type_name" UNIQUE ("name"),
        CONSTRAINT "PK_character_recruit_type" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."character_faction" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(100) NOT NULL,
        CONSTRAINT "UQ_character_faction_name" UNIQUE ("name"),
        CONSTRAINT "PK_character_faction" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."character_general_faction" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(50) NOT NULL,
        CONSTRAINT "UQ_character_general_faction_name" UNIQUE ("name"),
        CONSTRAINT "PK_character_general_faction" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."character_sex" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(20) NOT NULL,
        CONSTRAINT "UQ_character_sex_name" UNIQUE ("name"),
        CONSTRAINT "PK_character_sex" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "sto_info_app"."character" CASCADE
    `);
    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."character" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "accountId" uuid NOT NULL,
        "name" character varying(255) NOT NULL,
        "nameNormalized" character varying(255) NOT NULL,
        "handle" character varying(511) NOT NULL,
        "generalFactionId" uuid NOT NULL,
        "factionId" uuid NOT NULL,
        "sexId" uuid NOT NULL,
        "classId" uuid NOT NULL,
        "recruitTypeId" uuid,
        "speciesId" uuid NOT NULL,
        "createdDate" TIMESTAMP,
        "firstName" character varying(255),
        "middleName" character varying(255),
        "lastName" character varying(255),
        "biography" text,
        "notes" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_character" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UX_character_account_name_normalized" 
      ON "sto_info_app"."character" ("accountId", "nameNormalized") 
      WHERE "deletedAt" IS NULL
    `);
    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."recruit_type_faction_mapping" (
        "recruitTypeId" uuid NOT NULL,
        "factionId" uuid NOT NULL,
        CONSTRAINT "PK_recruit_type_faction_mapping" PRIMARY KEY ("recruitTypeId", "factionId")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_recruit_type_faction_recruit_type" 
      ON "sto_info_app"."recruit_type_faction_mapping" ("recruitTypeId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_recruit_type_faction_faction" 
      ON "sto_info_app"."recruit_type_faction_mapping" ("factionId")
    `);
    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."recruit_type_species_mapping" (
        "recruitTypeId" uuid NOT NULL,
        "speciesId" uuid NOT NULL,
        CONSTRAINT "PK_recruit_type_species_mapping" PRIMARY KEY ("recruitTypeId", "speciesId")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_recruit_type_species_recruit_type" 
      ON "sto_info_app"."recruit_type_species_mapping" ("recruitTypeId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_recruit_type_species_species" 
      ON "sto_info_app"."recruit_type_species_mapping" ("speciesId")
    `);
    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."faction_species_mapping" (
        "factionId" uuid NOT NULL,
        "speciesId" uuid NOT NULL,
        CONSTRAINT "PK_faction_species_mapping" PRIMARY KEY ("factionId", "speciesId")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_faction_species_faction" 
      ON "sto_info_app"."faction_species_mapping" ("factionId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_faction_species_species" 
      ON "sto_info_app"."faction_species_mapping" ("speciesId")
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character" 
      ADD CONSTRAINT "FK_character_account" 
      FOREIGN KEY ("accountId") REFERENCES "sto_info_app"."account"("id") 
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character" 
      ADD CONSTRAINT "FK_character_general_faction" 
      FOREIGN KEY ("generalFactionId") REFERENCES "sto_info_app"."character_general_faction"("id") 
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character" 
      ADD CONSTRAINT "FK_character_faction" 
      FOREIGN KEY ("factionId") REFERENCES "sto_info_app"."character_faction"("id") 
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character" 
      ADD CONSTRAINT "FK_character_sex" 
      FOREIGN KEY ("sexId") REFERENCES "sto_info_app"."character_sex"("id") 
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character" 
      ADD CONSTRAINT "FK_character_class" 
      FOREIGN KEY ("classId") REFERENCES "sto_info_app"."character_class"("id") 
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character" 
      ADD CONSTRAINT "FK_character_recruit_type" 
      FOREIGN KEY ("recruitTypeId") REFERENCES "sto_info_app"."character_recruit_type"("id") 
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character" 
      ADD CONSTRAINT "FK_character_species" 
      FOREIGN KEY ("speciesId") REFERENCES "sto_info_app"."character_species"("id") 
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."recruit_type_faction_mapping" 
      ADD CONSTRAINT "FK_recruit_type_faction_recruit_type" 
      FOREIGN KEY ("recruitTypeId") REFERENCES "sto_info_app"."character_recruit_type"("id") 
      ON DELETE CASCADE ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."recruit_type_faction_mapping" 
      ADD CONSTRAINT "FK_recruit_type_faction_faction" 
      FOREIGN KEY ("factionId") REFERENCES "sto_info_app"."character_faction"("id") 
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."recruit_type_species_mapping" 
      ADD CONSTRAINT "FK_recruit_type_species_recruit_type" 
      FOREIGN KEY ("recruitTypeId") REFERENCES "sto_info_app"."character_recruit_type"("id") 
      ON DELETE CASCADE ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."recruit_type_species_mapping" 
      ADD CONSTRAINT "FK_recruit_type_species_species" 
      FOREIGN KEY ("speciesId") REFERENCES "sto_info_app"."character_species"("id") 
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."faction_species_mapping" 
      ADD CONSTRAINT "FK_faction_species_faction" 
      FOREIGN KEY ("factionId") REFERENCES "sto_info_app"."character_faction"("id") 
      ON DELETE CASCADE ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."faction_species_mapping" 
      ADD CONSTRAINT "FK_faction_species_species" 
      FOREIGN KEY ("speciesId") REFERENCES "sto_info_app"."character_species"("id") 
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    // --- Seeding Data ---

    // General Factions
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."character_general_faction" (name) 
      VALUES ('Federation'), ('Klingon'), ('Undecided')
    `);

    // Classes
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."character_class" (name) 
      VALUES ('Tactical'), ('Engineering'), ('Science')
    `);

    // Sexes
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."character_sex" (name) 
      VALUES ('Male'), ('Female')
    `);

    // Recruit Types
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."character_recruit_type" (name) 
      VALUES ('Standard'), ('Delta'), ('Temporal'), ('Gamma'), ('Klingon')
    `);

    // Factions
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."character_faction" (name) 
      VALUES ('Starfleet (2409)'), ('TOS Starfleet'), ('Discovery Starfleet'), 
             ('Klingon Defense Force'), ('Romulan Republic'), ('Dominion')
    `);

    // Species
    const speciesList = [
      '23c Andorian',
      '23c Human',
      '23c Tellarite',
      '23c Vulcan',
      'Alien',
      'Andorian',
      'Bajoran',
      'Benzite',
      'Betazoid',
      'Bolian',
      'Caitian',
      'Cardassian',
      'Ferasan',
      'Ferengi',
      'Gorn',
      'Human',
      "Jem'Hadar",
      "Jem'Hadar Vanguard",
      'Klingon (Discovery)',
      'Klingon (Federation)',
      'Klingon (TNG)',
      'Lethean',
      'Liberated Borg Human',
      'Liberated Borg Klingon',
      'Liberated Borg Romulan',
      'Nausicaan',
      'Orion',
      'Pakled',
      'Reman',
      'Rigelian',
      'Romulan',
      'Saurian',
      'Talaxian',
      'Tellarite',
      'Trill',
      'Trill (joined)',
      'Vulcan',
    ];
    for (const species of speciesList) {
      await queryRunner.query(
        `INSERT INTO "sto_info_app"."character_species" (name) VALUES ($1)`,
        [species],
      );
    }

    // --- Mappings ---

    // Recruit Type <-> Faction
    // Standard in all
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."recruit_type_faction_mapping" ("recruitTypeId", "factionId") 
      SELECT rt.id, f.id FROM "sto_info_app"."character_recruit_type" rt, "sto_info_app"."character_faction" f 
      WHERE rt.name = 'Standard'
    `);

    // Delta in SF 2409, KDF, Romulan
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."recruit_type_faction_mapping" ("recruitTypeId", "factionId") 
      SELECT rt.id, f.id FROM "sto_info_app"."character_recruit_type" rt, "sto_info_app"."character_faction" f 
      WHERE rt.name = 'Delta' 
      AND f.name IN ('Starfleet (2409)', 'Klingon Defense Force', 'Romulan Republic')
    `);

    // Temporal in TOS SF
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."recruit_type_faction_mapping" ("recruitTypeId", "factionId") 
      SELECT rt.id, f.id FROM "sto_info_app"."character_recruit_type" rt, "sto_info_app"."character_faction" f 
      WHERE rt.name = 'Temporal' AND f.name = 'TOS Starfleet'
    `);

    // Gamma in Dominion
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."recruit_type_faction_mapping" ("recruitTypeId", "factionId") 
      SELECT rt.id, f.id FROM "sto_info_app"."character_recruit_type" rt, "sto_info_app"."character_faction" f 
      WHERE rt.name = 'Gamma' AND f.name = 'Dominion'
    `);

    // Klingon in KDF
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."recruit_type_faction_mapping" ("recruitTypeId", "factionId") 
      SELECT rt.id, f.id FROM "sto_info_app"."character_recruit_type" rt, "sto_info_app"."character_faction" f 
      WHERE rt.name = 'Klingon' AND f.name = 'Klingon Defense Force'
    `);

    // Faction <-> Species Mappings (High level)
    // TOS SF Species
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."faction_species_mapping" ("factionId", "speciesId")
      SELECT f.id, s.id FROM "sto_info_app"."character_faction" f, "sto_info_app"."character_species" s
      WHERE f.name = 'TOS Starfleet' 
      AND s.name IN ('23c Andorian', '23c Human', '23c Tellarite', '23c Vulcan')
    `);

    // Dominion Species
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."faction_species_mapping" ("factionId", "speciesId")
      SELECT f.id, s.id FROM "sto_info_app"."character_faction" f, "sto_info_app"."character_species" s
      WHERE f.name = 'Dominion' 
      AND s.name IN ('Jem''Hadar', 'Jem''Hadar Vanguard', 'Alien')
    `);

    // Discovery SF Species
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."faction_species_mapping" ("factionId", "speciesId")
      SELECT f.id, s.id FROM "sto_info_app"."character_faction" f, "sto_info_app"."character_species" s
      WHERE f.name = 'Discovery Starfleet' 
      AND s.name IN ('Human', 'Vulcan', 'Klingon (Discovery)', 'Alien')
    `);

    // Starfleet 2409 Species
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."faction_species_mapping" ("factionId", "speciesId")
      SELECT f.id, s.id FROM "sto_info_app"."character_faction" f, "sto_info_app"."character_species" s
      WHERE f.name = 'Starfleet (2409)' 
      AND s.name IN ('Andorian', 'Bajoran', 'Benzite', 'Betazoid', 'Bolian', 'Caitian', 'Ferengi', 'Human', 'Klingon (Federation)', 'Liberated Borg Human', 'Pakled', 'Rigelian', 'Saurian', 'Tellarite', 'Trill', 'Trill (joined)', 'Vulcan', 'Alien', 'Cardassian', 'Talaxian')
    `);

    // KDF Species
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."faction_species_mapping" ("factionId", "speciesId")
      SELECT f.id, s.id FROM "sto_info_app"."character_faction" f, "sto_info_app"."character_species" s
      WHERE f.name = 'Klingon Defense Force' 
      AND s.name IN ('Gorn', 'Klingon (TNG)', 'Lethean', 'Nausicaan', 'Orion', 'Ferasan', 'Liberated Borg Klingon', 'Alien', 'Cardassian', 'Talaxian', 'Trill (joined)')
    `);

    // Romulan Republic Species
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."faction_species_mapping" ("factionId", "speciesId")
      SELECT f.id, s.id FROM "sto_info_app"."character_faction" f, "sto_info_app"."character_species" s
      WHERE f.name = 'Romulan Republic' AND s.name IN ('Romulan', 'Reman', 'Liberated Borg Romulan', 'Alien')
    `);

    // Recruit Type <-> Species Mappings
    // Temporal recruits must use 23c species
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."recruit_type_species_mapping" ("recruitTypeId", "speciesId")
      SELECT rt.id, s.id FROM "sto_info_app"."character_recruit_type" rt, "sto_info_app"."character_species" s
      WHERE rt.name = 'Temporal' AND s.name IN ('23c Andorian', '23c Human', '23c Tellarite', '23c Vulcan')
    `);

    // Gamma recruits must be Jem'Hadar
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."recruit_type_species_mapping" ("recruitTypeId", "speciesId")
      SELECT rt.id, s.id FROM "sto_info_app"."character_recruit_type" rt, "sto_info_app"."character_species" s
      WHERE rt.name = 'Gamma' AND s.name IN ('Jem''Hadar', 'Jem''Hadar Vanguard')
    `);

    // Klingon recruits must be KDF species (mostly Klingon TNG)
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."recruit_type_species_mapping" ("recruitTypeId", "speciesId")
      SELECT rt.id, s.id FROM "sto_info_app"."character_recruit_type" rt, "sto_info_app"."character_species" s
      WHERE rt.name = 'Klingon' 
      AND s.name IN ('Klingon (TNG)', 'Gorn', 'Lethean', 'Nausicaan', 'Orion', 'Ferasan', 'Klingon (Discovery)')
    `);

    // Standard and Delta are more flexible, covered by faction-species mostly,
    // but for specific selectable logic we can add them to all non-special species
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."recruit_type_species_mapping" ("recruitTypeId", "speciesId")
      SELECT rt.id, s.id FROM "sto_info_app"."character_recruit_type" rt, "sto_info_app"."character_species" s
      WHERE rt.name IN ('Standard', 'Delta') 
      AND s.name NOT IN ('23c Andorian', '23c Human', '23c Tellarite', '23c Vulcan', 'Jem''Hadar', 'Jem''Hadar Vanguard')
    `);
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."faction_species_mapping" 
      DROP CONSTRAINT "FK_faction_species_species"
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."faction_species_mapping" 
      DROP CONSTRAINT "FK_faction_species_faction"
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."recruit_type_species_mapping" 
      DROP CONSTRAINT "FK_recruit_type_species_species"
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."recruit_type_species_mapping" 
      DROP CONSTRAINT "FK_recruit_type_species_recruit_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."recruit_type_faction_mapping" 
      DROP CONSTRAINT "FK_recruit_type_faction_faction"
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."recruit_type_faction_mapping" 
      DROP CONSTRAINT "FK_recruit_type_faction_recruit_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character" 
      DROP CONSTRAINT "FK_character_species"
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character" 
      DROP CONSTRAINT "FK_character_recruit_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character" 
      DROP CONSTRAINT "FK_character_class"
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character" 
      DROP CONSTRAINT "FK_character_sex"
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character" 
      DROP CONSTRAINT "FK_character_faction"
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character" 
      DROP CONSTRAINT "FK_character_general_faction"
    `);
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character" 
      DROP CONSTRAINT "FK_character_account"
    `);
    await queryRunner.query(`
      DROP INDEX "sto_info_app"."IDX_faction_species_species"
    `);
    await queryRunner.query(`
      DROP INDEX "sto_info_app"."IDX_faction_species_faction"
    `);
    await queryRunner.query(`
      DROP TABLE "sto_info_app"."faction_species_mapping"
    `);
    await queryRunner.query(`
      DROP INDEX "sto_info_app"."IDX_recruit_type_species_species"
    `);
    await queryRunner.query(`
      DROP INDEX "sto_info_app"."IDX_recruit_type_species_recruit_type"
    `);
    await queryRunner.query(`
      DROP TABLE "sto_info_app"."recruit_type_species_mapping"
    `);
    await queryRunner.query(`
      DROP INDEX "sto_info_app"."IDX_recruit_type_faction_faction"
    `);
    await queryRunner.query(`
      DROP INDEX "sto_info_app"."IDX_recruit_type_faction_recruit_type"
    `);
    await queryRunner.query(`
      DROP TABLE "sto_info_app"."recruit_type_faction_mapping"
    `);
    await queryRunner.query(`
      DROP INDEX "sto_info_app"."UX_character_account_name_normalized"
    `);
    await queryRunner.query(`DROP TABLE "sto_info_app"."character"`);
    await queryRunner.query(`DROP TABLE "sto_info_app"."character_sex"`);
    await queryRunner.query(`
      DROP TABLE "sto_info_app"."character_general_faction"
    `);
    await queryRunner.query(`DROP TABLE "sto_info_app"."character_faction"`);
    await queryRunner.query(`
      DROP TABLE "sto_info_app"."character_recruit_type"
    `);
    await queryRunner.query(`DROP TABLE "sto_info_app"."character_species"`);
    await queryRunner.query(`DROP TABLE "sto_info_app"."character_class"`);
  }
}
