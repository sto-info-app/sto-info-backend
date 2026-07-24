import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCharacterSpecializationTables1785024000000 implements MigrationInterface {
  name = 'CreateCharacterSpecializationTables1785024000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- character_specialization table ---
    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."character_specialization" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(255) NOT NULL,
        "description" text,
        "iconUrl" character varying(512),
        "accentColor" character varying(9),
        "type" character varying(16) NOT NULL,
        "maxPoints" integer NOT NULL DEFAULT 30,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_character_specialization" PRIMARY KEY ("id"),
        CONSTRAINT "UX_character_specialization_name" UNIQUE ("name"),
        CONSTRAINT "CK_character_specialization_type" CHECK ("type" IN ('primary', 'secondary')),
        CONSTRAINT "CK_character_specialization_max_points" CHECK (("type" = 'primary' AND "maxPoints" > 0 AND "maxPoints" <= 30) OR ("type" = 'secondary' AND "maxPoints" > 0 AND "maxPoints" <= 15))
      )
    `);

    // --- character_specialization_progress table ---
    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."character_specialization_progress" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "characterId" uuid NOT NULL,
        "specializationId" uuid NOT NULL,
        "pointsSpent" integer NOT NULL DEFAULT 0,
        "slot" character varying(16),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_character_specialization_progress" PRIMARY KEY ("id"),
        CONSTRAINT "UX_character_specialization_progress_character_specialization" UNIQUE ("characterId", "specializationId"),
        CONSTRAINT "CK_character_specialization_progress_points" CHECK ("pointsSpent" >= 0 AND "pointsSpent" <= 30),
        CONSTRAINT "CK_character_specialization_progress_slot" CHECK ("slot" IS NULL OR "slot" IN ('primary', 'secondary')),
        CONSTRAINT "FK_character_specialization_progress_character" FOREIGN KEY ("characterId")
          REFERENCES "sto_info_app"."character"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_character_specialization_progress_specialization" FOREIGN KEY ("specializationId")
          REFERENCES "sto_info_app"."character_specialization"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_character_specialization_progress_characterId"
      ON "sto_info_app"."character_specialization_progress" ("characterId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_character_specialization_progress_specializationId"
      ON "sto_info_app"."character_specialization_progress" ("specializationId")
    `);

    // A captain has at most one active Primary and one active Secondary
    // specialization; every other tracked specialization has a NULL slot.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UX_character_specialization_progress_character_slot"
      ON "sto_info_app"."character_specialization_progress" ("characterId", "slot")
      WHERE "slot" IS NOT NULL
    `);

    // --- Seed: captain specializations ---
    // Primary specializations offer 30 purchasable abilities and can be slotted
    // as Primary or Secondary; secondary-only specializations offer 15 and can
    // only be slotted as Secondary. 5 x 30 + 3 x 15 = 195 points in total.
    // Icons mirror the STO wiki specialization icons (bundled under
    // /assets/specializations).
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."character_specialization"
        ("name", "description", "iconUrl", "accentColor", "type", "maxPoints", "sortOrder")
      VALUES
        ('Command Officer',    'Leadership and coordination bonuses that improve the effectiveness of your team, in space and on the ground.', '/assets/specializations/command.png',            '#d4a017', 'primary',   30, 10),
        ('Intelligence Officer','Exposing enemy weaknesses and staying undetected, while countering foes who try the same.',                    '/assets/specializations/intelligence.png',       '#16a085', 'primary',   30, 20),
        ('Miracle Worker',     'Creative engineering solutions that push equipment past its documented limitations.',                          '/assets/specializations/miracle-worker.png',     '#e67e22', 'primary',   30, 30),
        ('Pilot',              'Pushing the upper limits of starship manoeuvrability with evasive flying and attack patterns.',                '/assets/specializations/pilot.png',              '#2980b9', 'primary',   30, 40),
        ('Temporal Operative', 'Manipulating the fabric of reality to turn probability and causality to your advantage.',                      '/assets/specializations/temporal-operative.png', '#8e44ad', 'primary',   30, 50),
        ('Commando',           'Ground assault training that makes the most of your personal weaponry and equipment.',                         '/assets/specializations/commando.png',           '#c0392b', 'secondary', 15, 60),
        ('Constable',          'Law-enforcement tactics centred on singling out and pursuing your Antagonist.',                                '/assets/specializations/constable.png',          '#0f7b8a', 'secondary', 15, 70),
        ('Strategist',         'Battlefield plans that adapt to the changing conditions of multi-ship combat.',                                '/assets/specializations/strategist.png',         '#7f8c8d', 'secondary', 15, 80)
    `);
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_character_specialization_progress_character_slot"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_character_specialization_progress_specializationId"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_character_specialization_progress_characterId"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."character_specialization_progress"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."character_specialization"`,
    );
  }
}
