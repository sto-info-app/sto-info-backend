import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIconUrlToFaction1767564095554 implements MigrationInterface {
  name = 'AddIconUrlToFaction1767564095554';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_faction" ADD "iconUrl" character varying(511)`,
    );

    // Seed faction icon URLs exactly as provided
    const factionIconMapping = [
      {
        name: 'Starfleet (2409)',
        url: 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/468b8117-7cc6-493c-cb0b-57f37b418100/public',
      },
      {
        name: 'TOS Starfleet',
        url: 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/a8c4fd77-c84d-4269-f767-fe05e419ed00/public',
      },
      {
        name: 'Discovery Starfleet',
        url: 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/090200f1-d896-4b6b-8dad-efec110af100/public',
      },
      {
        name: 'Klingon Defense Force',
        url: 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/dc7ef061-5e24-4455-8c24-2de1e8495d00/public',
      },
      {
        name: 'Romulan Republic',
        url: 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/320482a9-ad24-4975-969f-80a7b652ac00/public',
      },
      {
        name: 'Dominion',
        url: 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/72e5062c-ff40-4187-5166-3c4bbc2fe800/public',
      },
    ];

    for (const mapping of factionIconMapping) {
      await queryRunner.query(
        `UPDATE "sto_info_app"."character_faction" SET "iconUrl" = $1 WHERE "name" = $2`,
        [mapping.url, mapping.name],
      );
    }
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_faction" DROP COLUMN "iconUrl"`,
    );
  }
}
