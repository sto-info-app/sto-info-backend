import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFactionGeneralFactionMapping1773195274531 implements MigrationInterface {
  name = 'CreateFactionGeneralFactionMapping1773195274531';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "sto_info_app"."faction_general_faction_mapping" ("factionId" uuid NOT NULL, "generalFactionId" uuid NOT NULL, CONSTRAINT "PK_0b2ce24829716188f550b49db4a" PRIMARY KEY ("factionId", "generalFactionId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_170c578b92cd12cd7aaa499892" ON "sto_info_app"."faction_general_faction_mapping" ("factionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ac98ec22dd6350b6ed12c84375" ON "sto_info_app"."faction_general_faction_mapping" ("generalFactionId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."faction_general_faction_mapping" ADD CONSTRAINT "FK_170c578b92cd12cd7aaa4998929" FOREIGN KEY ("factionId") REFERENCES "sto_info_app"."character_faction"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."faction_general_faction_mapping" ADD CONSTRAINT "FK_ac98ec22dd6350b6ed12c843752" FOREIGN KEY ("generalFactionId") REFERENCES "sto_info_app"."character_general_faction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    // --- Seeding Data ---

    // Starfleet (2409) -> Federation
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."faction_general_faction_mapping" ("factionId", "generalFactionId")
      SELECT f.id, gf.id
      FROM "sto_info_app"."character_faction" f, "sto_info_app"."character_general_faction" gf
      WHERE f.name = 'Starfleet (2409)' AND gf.name = 'Federation'
    `);

    // TOS Starfleet -> Federation
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."faction_general_faction_mapping" ("factionId", "generalFactionId")
      SELECT f.id, gf.id
      FROM "sto_info_app"."character_faction" f, "sto_info_app"."character_general_faction" gf
      WHERE f.name = 'TOS Starfleet' AND gf.name = 'Federation'
    `);

    // Discovery Starfleet -> Federation
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."faction_general_faction_mapping" ("factionId", "generalFactionId")
      SELECT f.id, gf.id
      FROM "sto_info_app"."character_faction" f, "sto_info_app"."character_general_faction" gf
      WHERE f.name = 'Discovery Starfleet' AND gf.name = 'Federation'
    `);

    // Klingon Defense Force -> Klingon
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."faction_general_faction_mapping" ("factionId", "generalFactionId")
      SELECT f.id, gf.id
      FROM "sto_info_app"."character_faction" f, "sto_info_app"."character_general_faction" gf
      WHERE f.name = 'Klingon Defense Force' AND gf.name = 'Klingon'
    `);

    // Romulan Republic -> Undecided, Federation, Klingon
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."faction_general_faction_mapping" ("factionId", "generalFactionId")
      SELECT f.id, gf.id
      FROM "sto_info_app"."character_faction" f, "sto_info_app"."character_general_faction" gf
      WHERE f.name = 'Romulan Republic'
      AND gf.name IN ('Undecided', 'Federation', 'Klingon')
    `);

    // Dominion -> Undecided, Federation, Klingon
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."faction_general_faction_mapping" ("factionId", "generalFactionId")
      SELECT f.id, gf.id
      FROM "sto_info_app"."character_faction" f, "sto_info_app"."character_general_faction" gf
      WHERE f.name = 'Dominion'
      AND gf.name IN ('Undecided', 'Federation', 'Klingon')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."faction_general_faction_mapping" DROP CONSTRAINT "FK_ac98ec22dd6350b6ed12c843752"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."faction_general_faction_mapping" DROP CONSTRAINT "FK_170c578b92cd12cd7aaa4998929"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_ac98ec22dd6350b6ed12c84375"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_170c578b92cd12cd7aaa499892"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."faction_general_faction_mapping"`,
    );
  }
}
