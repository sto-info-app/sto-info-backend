import { MigrationInterface, QueryRunner } from 'typeorm';

export class AccountAndCharacterUpdates1774318826026 implements MigrationInterface {
  name = 'AccountAndCharacterUpdates1774318826026';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add iconUrl column to tables
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_recruit_type" ADD "iconUrl" character varying(511)`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_general_faction" ADD "iconUrl" character varying(511)`,
    );

    // Update faction icons
    await queryRunner.query(`
      UPDATE "sto_info_app"."character_faction" 
      SET "iconUrl" = 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/a69420ff-952f-4776-ebed-ffcbfd634500/square100' 
      WHERE "name" = 'Klingon Defense Force' 
    `);
    await queryRunner.query(`
      UPDATE "sto_info_app"."character_faction" 
      SET "iconUrl" = 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/1f195b7b-301a-47b1-02a9-d52a2fb35800/square100' 
      WHERE "name" = 'Dominion' 
    `);
    await queryRunner.query(`
      UPDATE "sto_info_app"."character_faction" 
      SET "iconUrl" = 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/e8246159-ea6a-46bf-a756-efac4e9d5f00/square100' 
      WHERE "name" = 'Discovery Starfleet' 
    `);
    await queryRunner.query(`
      UPDATE "sto_info_app"."character_faction" 
      SET "iconUrl" = 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/276a6f60-18d0-457f-dfa5-f2041fd26200/square100' 
      WHERE "name" = 'Starfleet (2409)' 
    `);
    await queryRunner.query(`
      UPDATE "sto_info_app"."character_faction" 
      SET "iconUrl" = 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/aed972bf-8e47-4b85-35a0-31dacdb66300/square100' 
      WHERE "name" = 'Romulan Republic' 
    `);
    await queryRunner.query(`
      UPDATE "sto_info_app"."character_faction" 
      SET "iconUrl" = 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/d3f36f5b-e84c-40bf-6897-29f174a1aa00/square100' 
      WHERE "name" = 'TOS Starfleet' 
    `);

    // Update recruit icons
    await queryRunner.query(`
      UPDATE "sto_info_app"."character_recruit_type" 
      SET "iconUrl" = 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/22af6120-b106-4c84-6c7b-8de08aa0b100/square40' 
      WHERE "name" = 'Klingon'
    `);
    await queryRunner.query(`
      UPDATE "sto_info_app"."character_recruit_type" 
      SET "iconUrl" = 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/40106e2c-b42a-4d63-0164-a432286b8e00/square40' 
      WHERE "name" = 'Gamma'
    `);
    await queryRunner.query(`
      UPDATE "sto_info_app"."character_recruit_type" 
      SET "iconUrl" = 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/96164c2e-a624-4c11-ce89-26f401e76700/square40' 
      WHERE "name" = 'Temporal'
    `);
    await queryRunner.query(`
      UPDATE "sto_info_app"."character_recruit_type" 
      SET "iconUrl" = 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/9641d7f7-c37b-4ab8-c5d9-4c09e2ee3300/square40' 
      WHERE "name" = 'Delta'
    `);

    // Update faction alliance icons
    await queryRunner.query(`
      UPDATE "sto_info_app"."character_general_faction" 
      SET "iconUrl" = 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/ec44375e-a4a2-4738-1465-1a93343ef500/square40' 
      WHERE "name" = 'Federation'
    `);
    await queryRunner.query(`
      UPDATE "sto_info_app"."character_general_faction" 
      SET "iconUrl" = 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/83c806b4-8ab0-4c56-b136-25d18ce36500/square40' 
      WHERE "name" = 'Klingon'
    `);
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_recruit_type" DROP COLUMN "iconUrl"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_general_faction" DROP COLUMN "iconUrl"`,
    );
  }
}
