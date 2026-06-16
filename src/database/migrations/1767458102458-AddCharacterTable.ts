import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCharacterTable1767458102458 implements MigrationInterface {
  name = 'AddCharacterTable1767458102458';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."character" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "accountId" uuid NOT NULL,
        "name" character varying(255) NOT NULL,
        "nameNormalized" character varying(255) NOT NULL,
        "handle" character varying(511) NOT NULL,
        "generalFaction" character varying(50) NOT NULL,
        "faction" character varying(50) NOT NULL,
        "sex" character varying(20) NOT NULL,
        "class" character varying(20) NOT NULL,
        "recruitType" character varying(100),
        "species" character varying(100) NOT NULL,
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
      ALTER TABLE "sto_info_app"."character" 
      ADD CONSTRAINT "FK_character_account" 
      FOREIGN KEY ("accountId") 
      REFERENCES "sto_info_app"."account"("id") 
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" DROP CONSTRAINT "FK_character_account"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_character_account_name_normalized"`,
    );
    await queryRunner.query(`DROP TABLE "sto_info_app"."character"`);
  }
}
