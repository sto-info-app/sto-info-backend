import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCharacterReputationTables1784160000000 implements MigrationInterface {
  name = 'CreateCharacterReputationTables1784160000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- character_reputation table ---
    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."character_reputation" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(255) NOT NULL,
        "description" text,
        "iconUrl" character varying(512),
        "accentColor" character varying(9),
        "releasedWith" character varying(255),
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_character_reputation" PRIMARY KEY ("id"),
        CONSTRAINT "UX_character_reputation_name" UNIQUE ("name")
      )
    `);

    // --- character_reputation_progress table ---
    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."character_reputation_progress" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "characterId" uuid NOT NULL,
        "reputationId" uuid NOT NULL,
        "currentTier" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_character_reputation_progress" PRIMARY KEY ("id"),
        CONSTRAINT "UX_character_reputation_progress_character_reputation" UNIQUE ("characterId", "reputationId"),
        CONSTRAINT "CK_character_reputation_progress_tier" CHECK ("currentTier" >= 0 AND "currentTier" <= 6),
        CONSTRAINT "FK_character_reputation_progress_character" FOREIGN KEY ("characterId")
          REFERENCES "sto_info_app"."character"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_character_reputation_progress_reputation" FOREIGN KEY ("reputationId")
          REFERENCES "sto_info_app"."character_reputation"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_character_reputation_progress_characterId"
      ON "sto_info_app"."character_reputation_progress" ("characterId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_character_reputation_progress_reputationId"
      ON "sto_info_app"."character_reputation_progress" ("reputationId")
    `);

    // --- Seed: Reputations (13), ordered by in-game release ---
    // Accent colours and mark icons mirror the STO wiki Reputation System cards.
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."character_reputation"
        ("name", "description", "iconUrl", "accentColor", "releasedWith", "sortOrder")
      VALUES
        ('Task Force Omega',              'Focused on combating the Borg threat in the Beta Quadrant.',                                          '/assets/reputations/omega.png',       '#1f6321', 'Season Seven: New Romulus',      10),
        ('New Romulus',                   'Assists the Romulan Republic with the resettlement of New Romulus.',                                  '/assets/reputations/new-romulus.png', '#296361', 'Season Seven: New Romulus',      20),
        ('Nukara Strikeforce',            'Dedicated to stopping Tholian incursions on Nukara Prime and beyond.',                                '/assets/reputations/nukara.png',      '#ada227', 'Legacy of Romulus',              30),
        ('Dyson Joint Command',           'A joint task force exploring the Solanae Dyson Sphere and countering the Voth.',                      '/assets/reputations/dyson.png',       '#743c7d', 'Season Eight: The Sphere',       40),
        ('8472 Counter-Command',          'Coordinates the defence against Species 8472 (the Undine) in fluidic space.',                         '/assets/reputations/undine.png',      '#b76e07', 'Season Nine: A New Accord',      50),
        ('Delta Alliance',                'An alliance of Delta Quadrant powers united against the Vaadwaur.',                                   '/assets/reputations/delta.png',       '#992c13', 'Delta Rising',                   60),
        ('Iconian Resistance',            'The combined effort to resist the Iconian invasion of the Alpha and Beta Quadrants.',                '/assets/reputations/iconian.png',     '#620c75', 'Season Ten: The Iconian War',    70),
        ('Terran Task Force',             'Defends the Prime Universe against invasions by the Terran Empire.',                                  '/assets/reputations/terran.png',      '#ad8905', 'Season Eleven: New Dawn',        80),
        ('Temporal Defense Initiative',   'Protects the timeline from temporal incursions and the Temporal Cold War.',                           '/assets/reputations/temporal.png',    '#067982', 'Agents of Yesterday',            90),
        ('Lukari Restoration Initiative', 'Supports the Lukari as they reclaim their heritage and explore the galaxy.',                          '/assets/reputations/lukari.png',      '#5d4784', 'Season Twelve: Reckoning',       100),
        ('Competitive Wargames',          'Sharpens combat readiness through competitive training exercises.',                                   '/assets/reputations/competitive.png', '#0c6396', 'Season Thirteen: Escalation',    110),
        ('Gamma Task Force',              'Joint operations with the Dominion against the Hur''q threat in the Gamma Quadrant.',                '/assets/reputations/gamma.png',       '#7d037f', 'Victory is Life',                120),
        ('Discovery Legends',             'Works alongside the crew of the U.S.S. Discovery to safeguard the galaxy.',                           '/assets/reputations/discovery.png',   '#c69f3b', 'Rise of Discovery',              130)
    `);
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_character_reputation_progress_reputationId"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_character_reputation_progress_characterId"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."character_reputation_progress"`,
    );
    await queryRunner.query(`DROP TABLE "sto_info_app"."character_reputation"`);
  }
}
