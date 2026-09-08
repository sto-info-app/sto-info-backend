import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCharacterAdmiraltyTables1790899200000 implements MigrationInterface {
  name = 'CreateCharacterAdmiraltyTables1790899200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "sto_info_app"."character_admiralty_campaign" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" varchar(255) NOT NULL,
      "description" text, "iconUrl" varchar(512), "accentColor" varchar(9),
      "sortOrder" integer NOT NULL DEFAULT 0, "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_character_admiralty_campaign" PRIMARY KEY ("id"),
      CONSTRAINT "UX_character_admiralty_campaign_name" UNIQUE ("name"))`);
    await queryRunner.query(`CREATE TABLE "sto_info_app"."character_admiralty_progress" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(), "characterId" uuid NOT NULL, "campaignId" uuid NOT NULL,
      "currentTier" integer NOT NULL DEFAULT 0, "tourOfDutyStep" integer NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
      CONSTRAINT "PK_character_admiralty_progress" PRIMARY KEY ("id"),
      CONSTRAINT "UX_character_admiralty_progress_character_campaign" UNIQUE ("characterId", "campaignId"),
      CONSTRAINT "CK_character_admiralty_progress_tier" CHECK ("currentTier" BETWEEN 0 AND 10),
      CONSTRAINT "CK_character_admiralty_progress_tour" CHECK ("tourOfDutyStep" BETWEEN 0 AND 10),
      CONSTRAINT "FK_character_admiralty_progress_character" FOREIGN KEY ("characterId") REFERENCES "sto_info_app"."character"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "FK_character_admiralty_progress_campaign" FOREIGN KEY ("campaignId") REFERENCES "sto_info_app"."character_admiralty_campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_character_admiralty_progress_characterId" ON "sto_info_app"."character_admiralty_progress" ("characterId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_character_admiralty_progress_campaignId" ON "sto_info_app"."character_admiralty_progress" ("campaignId")`,
    );
    await queryRunner.query(`INSERT INTO "sto_info_app"."character_admiralty_campaign" ("name", "description", "accentColor", "sortOrder") VALUES
      ('United Federation of Planets', 'Tour reward: 2 Specialization Points.', '#4b84c4', 10),
      ('Klingon Empire', 'Tour reward: 40,000 Fleet Dilithium Vouchers.', '#b33a3a', 20),
      ('Romulan Republic', 'Tour reward: 4 Romulan Republic Universal Tech Upgrades.', '#3f9c68', 30),
      ('Ferengi Trade Alliance', 'Tour reward: 30,000 Dilithium Ore bonus pool.', '#c7952e', 40)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_character_admiralty_progress_campaignId"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_character_admiralty_progress_characterId"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."character_admiralty_progress"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."character_admiralty_campaign"`,
    );
  }
}
