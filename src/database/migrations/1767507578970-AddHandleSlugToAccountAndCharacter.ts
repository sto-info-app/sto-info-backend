import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHandleSlugToAccountAndCharacter1767507578970 implements MigrationInterface {
  name = 'AddHandleSlugToAccountAndCharacter1767507578970';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."account" ADD "handleSlug" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" ADD "handleSlug" character varying(511)`,
    );

    // Update existing records
    await queryRunner.query(
      `UPDATE "sto_info_app"."account" SET "handleSlug" = REPLACE("handle", '#', '~')`,
    );
    await queryRunner.query(
      `UPDATE "sto_info_app"."character" SET "handleSlug" = REPLACE("handle", '#', '~')`,
    );

    // Set to NOT NULL
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."account" ALTER COLUMN "handleSlug" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" ALTER COLUMN "handleSlug" SET NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" DROP CONSTRAINT "FK_character_account"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" DROP CONSTRAINT "FK_character_general_faction"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" DROP CONSTRAINT "FK_character_faction"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" DROP CONSTRAINT "FK_character_sex"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" DROP CONSTRAINT "FK_character_class"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" DROP CONSTRAINT "FK_character_recruit_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" DROP CONSTRAINT "FK_character_species"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."recruit_type_faction_mapping" DROP CONSTRAINT "FK_recruit_type_faction_recruit_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."recruit_type_faction_mapping" DROP CONSTRAINT "FK_recruit_type_faction_faction"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."recruit_type_species_mapping" DROP CONSTRAINT "FK_recruit_type_species_recruit_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."recruit_type_species_mapping" DROP CONSTRAINT "FK_recruit_type_species_species"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."faction_species_mapping" DROP CONSTRAINT "FK_faction_species_faction"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."faction_species_mapping" DROP CONSTRAINT "FK_faction_species_species"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_character_account_name_normalized"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_recruit_type_faction_recruit_type"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_recruit_type_faction_faction"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_recruit_type_species_recruit_type"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_recruit_type_species_species"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_faction_species_faction"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_faction_species_species"`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_account_handle_slug" ON "sto_info_app"."account" ("handleSlug") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_character_handle_slug" ON "sto_info_app"."character" ("handleSlug") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_character_account_handle_normalized" ON "sto_info_app"."character" ("accountId", "nameNormalized") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bad81849bec5ce7c1a0be9b930" ON "sto_info_app"."recruit_type_faction_mapping" ("recruitTypeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_418048f90c4f90057a6e3100b2" ON "sto_info_app"."recruit_type_faction_mapping" ("factionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bbc0922430771400177e3db230" ON "sto_info_app"."recruit_type_species_mapping" ("recruitTypeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a49aad6aee633e2b5496ad9b01" ON "sto_info_app"."recruit_type_species_mapping" ("speciesId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_31c61b50239b161baa649c36c8" ON "sto_info_app"."faction_species_mapping" ("factionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5ccb53fef7d36c8dacb75e5257" ON "sto_info_app"."faction_species_mapping" ("speciesId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" ADD CONSTRAINT "FK_9f86c0cb452b51bd1b738a73a23" FOREIGN KEY ("accountId") REFERENCES "sto_info_app"."account"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" ADD CONSTRAINT "FK_e8e1e93323e5dee69236a49aa6c" FOREIGN KEY ("generalFactionId") REFERENCES "sto_info_app"."character_general_faction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" ADD CONSTRAINT "FK_7c7f3d7b801379ac0c032207e51" FOREIGN KEY ("factionId") REFERENCES "sto_info_app"."character_faction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" ADD CONSTRAINT "FK_435b6f6be7149dfaf12d00e3134" FOREIGN KEY ("sexId") REFERENCES "sto_info_app"."character_sex"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" ADD CONSTRAINT "FK_a94ac46b7a3d853ac1a8c6a8b82" FOREIGN KEY ("classId") REFERENCES "sto_info_app"."character_class"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" ADD CONSTRAINT "FK_782df2ae416ac671985c4848bb3" FOREIGN KEY ("recruitTypeId") REFERENCES "sto_info_app"."character_recruit_type"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" ADD CONSTRAINT "FK_a930f997145c13a04c3fc6e32d0" FOREIGN KEY ("speciesId") REFERENCES "sto_info_app"."character_species"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."recruit_type_faction_mapping" ADD CONSTRAINT "FK_bad81849bec5ce7c1a0be9b930f" FOREIGN KEY ("recruitTypeId") REFERENCES "sto_info_app"."character_recruit_type"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."recruit_type_faction_mapping" ADD CONSTRAINT "FK_418048f90c4f90057a6e3100b24" FOREIGN KEY ("factionId") REFERENCES "sto_info_app"."character_faction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."recruit_type_species_mapping" ADD CONSTRAINT "FK_bbc0922430771400177e3db2307" FOREIGN KEY ("recruitTypeId") REFERENCES "sto_info_app"."character_recruit_type"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."recruit_type_species_mapping" ADD CONSTRAINT "FK_a49aad6aee633e2b5496ad9b011" FOREIGN KEY ("speciesId") REFERENCES "sto_info_app"."character_species"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."faction_species_mapping" ADD CONSTRAINT "FK_31c61b50239b161baa649c36c82" FOREIGN KEY ("factionId") REFERENCES "sto_info_app"."character_faction"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."faction_species_mapping" ADD CONSTRAINT "FK_5ccb53fef7d36c8dacb75e52577" FOREIGN KEY ("speciesId") REFERENCES "sto_info_app"."character_species"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."faction_species_mapping" DROP CONSTRAINT "FK_5ccb53fef7d36c8dacb75e52577"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."faction_species_mapping" DROP CONSTRAINT "FK_31c61b50239b161baa649c36c82"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."recruit_type_species_mapping" DROP CONSTRAINT "FK_a49aad6aee633e2b5496ad9b011"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."recruit_type_species_mapping" DROP CONSTRAINT "FK_bbc0922430771400177e3db2307"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."recruit_type_faction_mapping" DROP CONSTRAINT "FK_418048f90c4f90057a6e3100b24"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."recruit_type_faction_mapping" DROP CONSTRAINT "FK_bad81849bec5ce7c1a0be9b930f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" DROP CONSTRAINT "FK_a930f997145c13a04c3fc6e32d0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" DROP CONSTRAINT "FK_782df2ae416ac671985c4848bb3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" DROP CONSTRAINT "FK_a94ac46b7a3d853ac1a8c6a8b82"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" DROP CONSTRAINT "FK_435b6f6be7149dfaf12d00e3134"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" DROP CONSTRAINT "FK_7c7f3d7b801379ac0c032207e51"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" DROP CONSTRAINT "FK_e8e1e93323e5dee69236a49aa6c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" DROP CONSTRAINT "FK_9f86c0cb452b51bd1b738a73a23"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_5ccb53fef7d36c8dacb75e5257"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_31c61b50239b161baa649c36c8"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_a49aad6aee633e2b5496ad9b01"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_bbc0922430771400177e3db230"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_418048f90c4f90057a6e3100b2"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_bad81849bec5ce7c1a0be9b930"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_character_account_handle_normalized"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_character_handle_slug"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_account_handle_slug"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" DROP COLUMN "handleSlug"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."account" DROP COLUMN "handleSlug"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_faction_species_species" ON "sto_info_app"."faction_species_mapping" ("speciesId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_faction_species_faction" ON "sto_info_app"."faction_species_mapping" ("factionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_recruit_type_species_species" ON "sto_info_app"."recruit_type_species_mapping" ("speciesId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_recruit_type_species_recruit_type" ON "sto_info_app"."recruit_type_species_mapping" ("recruitTypeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_recruit_type_faction_faction" ON "sto_info_app"."recruit_type_faction_mapping" ("factionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_recruit_type_faction_recruit_type" ON "sto_info_app"."recruit_type_faction_mapping" ("recruitTypeId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_character_account_name_normalized" ON "sto_info_app"."character" ("accountId", "nameNormalized") WHERE ("deletedAt" IS NULL)`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."faction_species_mapping" ADD CONSTRAINT "FK_faction_species_species" FOREIGN KEY ("speciesId") REFERENCES "sto_info_app"."character_species"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."faction_species_mapping" ADD CONSTRAINT "FK_faction_species_faction" FOREIGN KEY ("factionId") REFERENCES "sto_info_app"."character_faction"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."recruit_type_species_mapping" ADD CONSTRAINT "FK_recruit_type_species_species" FOREIGN KEY ("speciesId") REFERENCES "sto_info_app"."character_species"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."recruit_type_species_mapping" ADD CONSTRAINT "FK_recruit_type_species_recruit_type" FOREIGN KEY ("recruitTypeId") REFERENCES "sto_info_app"."character_recruit_type"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."recruit_type_faction_mapping" ADD CONSTRAINT "FK_recruit_type_faction_faction" FOREIGN KEY ("factionId") REFERENCES "sto_info_app"."character_faction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."recruit_type_faction_mapping" ADD CONSTRAINT "FK_recruit_type_faction_recruit_type" FOREIGN KEY ("recruitTypeId") REFERENCES "sto_info_app"."character_recruit_type"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" ADD CONSTRAINT "FK_character_species" FOREIGN KEY ("speciesId") REFERENCES "sto_info_app"."character_species"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" ADD CONSTRAINT "FK_character_recruit_type" FOREIGN KEY ("recruitTypeId") REFERENCES "sto_info_app"."character_recruit_type"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" ADD CONSTRAINT "FK_character_class" FOREIGN KEY ("classId") REFERENCES "sto_info_app"."character_class"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" ADD CONSTRAINT "FK_character_sex" FOREIGN KEY ("sexId") REFERENCES "sto_info_app"."character_sex"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" ADD CONSTRAINT "FK_character_faction" FOREIGN KEY ("factionId") REFERENCES "sto_info_app"."character_faction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" ADD CONSTRAINT "FK_character_general_faction" FOREIGN KEY ("generalFactionId") REFERENCES "sto_info_app"."character_general_faction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" ADD CONSTRAINT "FK_character_account" FOREIGN KEY ("accountId") REFERENCES "sto_info_app"."account"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
