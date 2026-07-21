import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCharacterRdTables1784419200000 implements MigrationInterface {
  name = 'CreateCharacterRdTables1784419200000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- character_rd_school table ---
    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."character_rd_school" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(255) NOT NULL,
        "description" text,
        "iconUrl" character varying(512),
        "accentColor" character varying(9),
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_character_rd_school" PRIMARY KEY ("id"),
        CONSTRAINT "UX_character_rd_school_name" UNIQUE ("name")
      )
    `);

    // --- character_rd_progress table ---
    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."character_rd_progress" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "characterId" uuid NOT NULL,
        "schoolId" uuid NOT NULL,
        "currentLevel" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_character_rd_progress" PRIMARY KEY ("id"),
        CONSTRAINT "UX_character_rd_progress_character_school" UNIQUE ("characterId", "schoolId"),
        CONSTRAINT "CK_character_rd_progress_level" CHECK ("currentLevel" >= 0 AND "currentLevel" <= 20),
        CONSTRAINT "FK_character_rd_progress_character" FOREIGN KEY ("characterId")
          REFERENCES "sto_info_app"."character"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_character_rd_progress_school" FOREIGN KEY ("schoolId")
          REFERENCES "sto_info_app"."character_rd_school"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_character_rd_progress_characterId"
      ON "sto_info_app"."character_rd_progress" ("characterId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_character_rd_progress_schoolId"
      ON "sto_info_app"."character_rd_progress" ("schoolId")
    `);

    // --- Seed: R&D schools (8 levelled fabrication schools) ---
    // Each school levels 0-20; accent colours group them by discipline.
    // Icons mirror the STO wiki R&D school icons (bundled under /assets/rd).
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."character_rd_school"
        ("name", "description", "iconUrl", "accentColor", "sortOrder")
      VALUES
        ('Beams',          'Beam arrays, dual beam banks and other directed-energy space weapons.',        '/assets/rd/beams.png',          '#c0392b', 10),
        ('Cannons',        'Single, dual and turret cannons for sustained energy firepower.',              '/assets/rd/cannons.png',        '#e67e22', 20),
        ('Projectiles',    'Torpedoes and mines for kinetic and exotic strikes.',                          '/assets/rd/projectiles.png',    '#d4a017', 30),
        ('Ground Weapons', 'Personal ground weapons for away-team combat.',                                '/assets/rd/ground-weapons.png', '#16a085', 40),
        ('Kits',           'Kit frames and kit modules that grant ground abilities.',                      '/assets/rd/kits.png',           '#27ae60', 50),
        ('Shields',        'Deflector shield arrays that boost ship survivability.',                       '/assets/rd/shields.png',        '#2980b9', 60),
        ('Engineering',    'Consoles, armour, warp and singularity cores, and impulse engines.',           '/assets/rd/engineering.png',    '#7f8c8d', 70),
        ('Science',        'Deflectors and science consoles that enhance science systems.',                '/assets/rd/science.png',        '#8e44ad', 80)
    `);
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_character_rd_progress_schoolId"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_character_rd_progress_characterId"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."character_rd_progress"`,
    );
    await queryRunner.query(`DROP TABLE "sto_info_app"."character_rd_school"`);
  }
}
